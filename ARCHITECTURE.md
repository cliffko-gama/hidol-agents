# hidol Feature Story AI Pipeline — 架構說明文件

> 本文件適用對象：部署工程師、前後端工程師、設計師、產品團隊。
> 說明系統的整體架構、各模組職責、資料流程，以及進入正式環境前需要各角色協助確認的問題清單。

---

## 目錄

1. [系統概述](#1-系統概述)
2. [Agent 架構全貌](#2-agent-架構全貌)
3. [各 Agent 職責說明](#3-各 agent-職責說明)
4. [支援模組說明](#4-支援模組說明)
5. [資料流程圖](#5-資料流程圖)
6. [部署架構（現況）](#6-部署架構現況)
7. [輸入輸出格式說明](#7-輸入輸出格式說明)
8. [待確認問題清單](#8-待確認問題清單)

---

## 1. 系統概述

hidol Feature Story AI Pipeline 是一套多 Agent 的 AI 內容生成系統。

**它的工作是：**
把 hidol App 上用戶發佈的 Moment（粉絲的追星紀錄、現場感受、手作應援等）自動組合成一篇高品質的 Feature Story 專題文章，供前端展示。

**一次完整的 Pipeline 執行，會完成：**

1. 從 Moment 素材中挑選值得寫的主題
2. 對每個主題做外部趨勢研究
3. 撰寫文章 → 自動審核 → 修改（循環直到通過）
4. 將通過審核的文章轉換成網站所需的 JSON 資料格式

**關鍵技術選型：**
- 語言：TypeScript / Node.js 22（ESM）
- AI 模型：Anthropic Claude（claude-sonnet-4-5 負責核心任務，claude-haiku-4-5 負責輕量任務）
- CI/CD：GitHub Actions（每週一台灣時間 09:00 自動執行 + 支援手動觸發）
- 費用計算基準：$3 / 1M input tokens，$15 / 1M output tokens（claude-sonnet-4-5 定價）

---

## 2. Agent 架構全貌

系統由 5 個專職 Agent（A1、A2、B、C、D、E）組成，依序協作：

```
Moments 輸入
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                     Orchestrator（總控）                  │
│                                                           │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐ │
│  │ Agent A1 │──▶│ Agent A2 │──▶│ 對每個 Topic 執行：  │ │
│  │ Moment   │   │ 主題分析 │   │                      │ │
│  │ 篩選     │   │ & 分群   │   │  Agent B → 趨勢研究  │ │
│  └──────────┘   └──────────┘   │       ↓              │ │
│                                 │  Agent C → 撰寫文章  │ │
│                                 │       ↓              │ │
│                                 │  Agent D → 品質審核  │ │
│                                 │   ↙通過  ↘需修改    │ │
│                                 │  Agent E  回 Agent C │ │
│                                 │  格式轉換  (最多 3次) │ │
│                                 └──────────────────────┘ │
└─────────────────────────────────────────────────────────┘
    │
    ▼
docs/ 目錄（網站 JSON 資料）
```

**Agent 角色一覽：**

| Agent | 模型 | 角色 | 輸入 | 輸出 |
|-------|------|------|------|------|
| A1 | Haiku | Moment 篩選員 | 全部 Moments | 通過篩選的 Moments + 拒絕記錄 |
| A2 | Sonnet | 主題策展人 | 篩選後的 Moments | 1–2 個有故事性的主題 |
| B | Sonnet | 趨勢研究員（可上網） | 主題資訊 + Moment 摘要 | 網路趨勢文章 + 社群洞察 |
| C | Sonnet | 特約編輯（撰稿） | 主題 + Moments + 研究結果 | Feature Story JSON |
| D | Sonnet | 品質審核官 | Feature Story + 原始 Moments | 通過 / 需修改（含意見）|
| E | Haiku | 發佈排版師 | 通過的 Feature Story | 網站 JSON 檔案清單 |

---

## 3. 各 Agent 職責說明

### Agent A1 — Moment 篩選

**職責：** 從原始 Moments 中移除不適合作為素材的內容。

篩選條件（可設定）：
- 文字長度低於門檻（`min_text_length`）
- 互動數太低（`min_engagement`）
- 包含特定排除 hashtag（如廣告、抽獎活動）
- 時間範圍外（`since` 參數）
- 判定為重複或不相關的內容

---

### Agent A2 — 主題分析

**職責：** 從篩選後的 Moments 中，找出有故事性的主題群，每個主題要有足夠素材支撐一篇文章。

判斷標準：
- 至少 3 則 Moments 聚集在同一活動/情境
- 有讀者共鳴潛力（Z 世代粉絲文化相關）
- 有敘事可能性（起承轉合的潛力）

輸出：最多 N 個主題（可設定），每個主題含推薦素材 Moment 清單與搜尋關鍵字。

---

### Agent B — 趨勢研究

**職責：** 對每個主題做外部研究，補充文章的脈絡深度。

執行方式：使用 Anthropic 內建的網路搜尋工具（`web_search_20250305`），自主決定搜尋幾輪、搜尋什麼關鍵字。

輸出：
- 找到的相關新聞 / 文章 URL 清單（附摘要）
- 各平台（Threads、IG、Dcard）的社群觀察
- 建議的文章切入角度
- 從 Moments 自身萃取的「話題性信號」（trending_factor、keywords、fan_behaviors）

若搜尋失敗，會標記 `research_failed: true`，Agent D 對「來源合規」維度會自動放寬評分。

---

### Agent C — 內容撰寫

**職責：** 以 hidol 的品牌語氣（Z 世代學長姐視角），把 Moments 素材和趨勢研究組合成一篇完整的 Feature Story。

寫作流程（內建在 system prompt 中）：
1. 先讀完所有素材，選定「Theme Spine」（貫穿全文的核心情感/觀點）
2. 決定文章骨架（section 結構）
3. 撰寫各段落（有 9 個風格維度的 Style Compass 規範）
4. 選擇媒體素材（封面圖、各段配圖）

特殊機制：
- **稀薄素材模式**：Moments 少於 6 則時，自動注入深挖策略（動態注入，不佔系統 prompt）
- **修改模式**：Agent D 退回時，自動注入完整修改指引（動態注入）
- **URL 後處理**：所有引用的外部 URL 會比對 Agent B 提供的清單，防止 AI 捏造來源

---

### Agent D — 品質審核

**職責：** 從 5 個維度評審 Agent C 的文章，決定通過或退回修改。

評審維度：
1. 事實準確性（引用的 Moment 內容是否正確）
2. 品牌調性（是否符合 hidol 語氣）
3. 內容結構（段落邏輯是否合理）
4. 素材歸屬（Moment 來源是否正確引用）
5. 可讀性（語句是否通順）

整體分數 7 分以上（10 分制）才會 approved，低於此分數 + 未達最大修改次數 → 退回 Agent C 修改（最多 3 輪）。

---

### Agent E — 發佈排版

**職責：** 把通過審核的 Feature Story 轉換成前端網站所需的 JSON 格式。

輸出包含：
- 各篇文章的 JSON 檔案（放入 `docs/stories/` 目錄）
- 更新後的文章索引 JSON（`docs/index.json` 或類似）
- 每篇文章的 `PublishedStoryMeta`（story_id、title、url、cover_image_url、tags、published_at）

---

## 4. 支援模組說明

### Orchestrator（`src/orchestrator.ts`）
Pipeline 的總控制器。負責：
- 依序啟動各 Agent、傳遞資料
- 管理 Agent C ↔ D 的修改迴圈
- 執行各種後處理（URL 過濾、moment_id 自動補全、Theme Spine 驗證）

### Checkpointing（`src/lib/checkpoint.ts`）
斷點續傳機制。儲存於 `output/pipeline-checkpoint.json`。

若 Pipeline 中途失敗，下次執行會自動跳過已完成的主題（Agent B 結果會被快取，已發佈的主題直接跳過），不需重新花費 API 費用從頭執行。

### Lessons（`src/lib/lessons.ts`）
跨 run 的經驗累積機制。儲存於 `output/lessons.json`。

每次執行後，系統會從 Agent D 的審核結果、錯誤記錄、retry 情況中提取觀察，合併成「經驗知識庫」，下次撰寫時注入給 Agent C/D 作為參考。

### Story History（`src/lib/story-history.ts`）
跨 run 的發佈記錄。儲存於 `output/story-history.json`。

每次發佈後自動記錄，未來可作為主題去重的資料來源（現已實作，去重功能暫停使用，待文章數量足夠後可開啟）。

### Token Tracker（`src/lib/token-tracker.ts`）
API 成本追蹤。每次執行結束後輸出各 Agent 的 token 用量與 USD 費用明細。

### Notify（`src/lib/notify.ts`）
執行結果通知：
- **GitHub Actions Job Summary**：每次執行自動寫入 Actions 頁面摘要
- **Slack Webhook**：僅在有錯誤時發送告警（需設定 `SLACK_WEBHOOK_URL` 環境變數）

### withRetry（`src/lib/call-agent.ts`）
API 重試機制：
- HTTP 529（模型過載）：退避 5s → 15s → 45s
- HTTP 429（Rate Limit）：退避 30s → 60s → 120s
- JSON 解析失敗：自動重試最多 3 次，並在重試時附上格式修正提示

---

## 5. 資料流程圖

```
【輸入】
 hidol API / JSON 檔案
 Moment 資料（包含文字、媒體 URL、用戶 ID、互動數）
        │
        ▼
【Agent A1】篩選（移除低品質 / 廣告 / 過短內容）
        │
        ▼
【Agent A2】主題分析（將 Moments 分群為 1–2 個有故事性的主題）
        │
        ├─────── 對每個主題 ───────┐
        │                          │
        ▼                          │
【Agent B】網路趨勢研究            │
 ・搜尋相關新聞/文章              │
 ・社群洞察（Threads/Dcard/IG）   │
 ・話題性信號分析                  │
        │                          │
        ▼                          │
【Agent C】撰寫 Feature Story      │
 ・確定 Theme Spine               │
 ・撰寫各段落                     │
 ・選擇媒體素材                   │
        │                          │
        ▼                          │
【Agent D】品質審核（5 維度）      │
   ┌── 通過（≥7分）               │
   │        └─▶ 繼續              │
   └── 退回（< 7分）              │
        └─▶ 回到 Agent C 修改     │
            （最多 3 輪）          │
        │                          │
        ▼                          │
【Agent E】格式轉換                │
 ・生成 docs/stories/*.json       │
 ・更新 docs/index.json           │
        │                          │
        └──────────────────────────┘
        │
        ▼
【GitHub Actions】
 commit & push docs/ 目錄
        │
        ▼
【前端】
 讀取 docs/ JSON 資料並顯示
```

---

## 6. 部署架構（現況）

```
GitHub Repository (hidol-agents)
├── src/                   # Pipeline 原始碼
├── docs/                  # 【輸出】Agent E 生成的網站資料
│   ├── index.json         # 文章索引
│   └── stories/           # 各篇文章的 JSON
├── output/                # 【執行時產物，不進 git】
│   ├── pipeline-checkpoint.json  # 斷點續傳
│   ├── lessons.json              # 累積經驗
│   ├── story-history.json        # 發佈歷史
│   └── run-{timestamp}/         # 每次執行的中間產物
└── .github/workflows/
    └── run-pipeline.yml   # CI/CD 排程

GitHub Secrets（需設定）：
  ANTHROPIC_API_KEY  ← Anthropic API 金鑰（必要）
  SLACK_WEBHOOK_URL  ← Slack 告警（選用）

觸發方式：
  排程：每週一 09:00（台灣時間）
  手動：GitHub Actions 頁面手動觸發，可選 mock 或 production 資料
```

**現況限制：**

- `output/` 目錄中的 `lessons.json`、`story-history.json`、`checkpoint.json` 在 GitHub Actions 執行環境中是暫時的，每次執行後會消失（目前每次執行都是全新開始，不保留跨 run 的歷史資料）
- 生產資料（Moments JSON）需要手動上傳 `moments-input.json` 到 repo 根目錄，不夠自動化

---

## 7. 輸入輸出格式說明

### 輸入：Moment 資料結構

```typescript
interface Moment {
  id: string;                  // 唯一識別碼
  user_id: string;             // 用戶 ID（hidol open_id）
  user_display_name: string;   // 顯示名稱（目前匿名化為「粉絲_XXXXXX」）
  type: "photo" | "video" | "text";
  text_content: string;        // 用戶撰寫的文字
  media: Array<{
    id: string;
    type: "image" | "video";
    url: string;               // 媒體檔案的 CDN URL
    thumbnail_url?: string;
    width?: number;
    height?: number;
    duration_seconds?: number;
    alt_text?: string;
  }>;
  hashtags: string[];
  location?: { name: string; latitude?: number; longitude?: number; };
  created_at: string;          // ISO 8601
  engagement: { likes: number; comments: number; shares: number; };
  deep_link?: string;          // 連回 hidol app 的深度連結
}
```

### 輸出：Feature Story 結構

```typescript
interface FeatureStory {
  title: string;          // 10–25 字的文章標題
  subtitle: string;       // 15–30 字的副標題
  cover: {
    moment_id: string;    // 封面圖來源的 Moment ID
    media_index: number;  // 使用該 Moment 的第幾個媒體
    caption: string;      // 封面圖說
  };
  sections: Array<{
    type: "intro" | "moment_highlight" | "trend_context" | "analysis" | "conclusion";
    heading?: string;
    content: string;      // Markdown 格式
    media?: Array<{
      moment_id: string;
      media_index: number;
      caption: string;
      placement: "inline" | "full-width" | "side-by-side";
    }>;
  }>;
  tags: string[];
  estimated_read_time: number;      // 預估閱讀分鐘數
  referenced_moment_ids: string[];  // 文章中引用的所有 Moment ID
  referenced_sources: string[];     // 文章中引用的外部 URL
}
```

### 輸出：發佈 Metadata（用於索引頁）

```typescript
interface PublishedStoryMeta {
  story_id: string;
  title: string;
  published_at: string;       // ISO 8601
  url: string;                // 前端路由 URL（例：#/story/story-id）
  cover_image_url: string;    // 封面圖 URL
  tags: string[];
}
```

---

## 8. 待確認問題清單

> 以下問題需要在正式部署前與各角色確認。

---

### 🔧 部署工程師

**CI/CD 與環境**

1. **`output/` 目錄的持久化**
   目前 `lessons.json`、`story-history.json`、`checkpoint.json` 在 GitHub Actions runner 上是暫時的，每次執行後消失，跨 run 歷史無法保留。
   → 需要確認：是否改用外部儲存（S3、GCS、或 GitHub Actions cache/artifact）？或是將 `output/` 目錄 commit 進 repo？

2. **生產資料的輸入機制**
   目前 production 模式需要手動將 `moments-input.json` 放到 repo 根目錄，再手動觸發 Actions。
   → 需要確認：理想的資料餵入方式是？（hidol API 直接呼叫？定期 export + 自動上傳？repository_dispatch？）

3. **`docs/` 的發佈目的地**
   目前 GitHub Actions 會 commit & push `docs/` 目錄到 main branch。
   → 需要確認：這份 JSON 資料最終如何被前端消費？是 GitHub Pages 直接 serve？還是需要 CDN 或另一套部署流程？

4. **API Key 管理**
   目前 `ANTHROPIC_API_KEY` 存放在 GitHub Secrets，只在 Actions 執行時注入為環境變數。
   → 需要確認：是否有 Key 輪換機制？是否需要設定 spending limit？

5. **Slack 告警**
   需要設定 `SLACK_WEBHOOK_URL` GitHub Secret，才能在執行失敗時收到 Slack 通知。
   → 需要確認：告警要發送到哪個 Slack 頻道？Webhook URL 由誰建立？

6. **排程頻率**
   目前設定每週一 09:00（台灣時間）自動執行一次。
   → 需要確認：正式上線後的更新頻率需求為何？

---

### 🖥 後端工程師

**資料串接**

7. **Moments 資料的 API 串接**
   目前 pipeline 吃的是 hidol DB export 的 JSON 格式（`ProdMoment`）。
   → 需要確認：是否要改為直接呼叫 hidol API endpoint 取得 Moments？認證方式？資料範圍（時間區間、哪些 topic_id？）

8. **用戶顯示名稱的處理**
   目前生產模式下，所有用戶一律匿名化為「粉絲_XXXXXX」（open_id 末 6 碼），文章中不會出現真實用戶名稱。
   → 需要確認：這是期望的隱私保護行為嗎？如果文章中需要顯示用戶名稱，需要提供 `user_display_name` 欄位（目前是空值）。

9. **Moment 深度連結（deep_link）**
   `Moment.deep_link` 目前在生產資料中為空。文章若需要連回 hidol App 的原始 Moment，需要後端提供此欄位。
   → 需要確認：hidol App 是否有 Moment 的 deep link scheme？格式為何？

10. **媒體檔案的 URL 穩定性**
    文章中引用的圖片/影片 URL 直接來自 hidol 的媒體 CDN。
    → 需要確認：這些 CDN URL 是否長期有效（是否有過期機制）？是否需要代理或重新上傳？

11. **Pipeline 觸發方式**
    目前由 GitHub Actions 排程觸發。
    → 需要確認：是否需要 webhook 機制，讓 hidol 後端在有大量新 Moments 時主動觸發 pipeline？

---

### 💻 前端工程師

**JSON Schema 與顯示**

12. **`docs/` 目錄結構的約定**
    Agent E 負責生成 JSON 檔案，目前 schema 是由 AI 依 prompt 決定的，尚未有正式規格文件。
    → 需要確認：前端期望的 JSON 目錄結構是？（例：`docs/index.json` + `docs/stories/{id}.json`？）以便調整 Agent E 的輸出規格。

13. **路由格式**
    目前設定 `story_url_prefix: "#/story/"`，表示前端使用 Hash Router。
    → 需要確認：前端路由方式是否確認？URL 格式需要調整嗎？

14. **Section type 的前端對應**
    文章由以下 section types 組成，前端需要對每種 type 設計對應的顯示元件：
    - `intro`：開場引言（無 heading）
    - `moment_highlight`：重點 Moment 呈現（含媒體）
    - `trend_context`：趨勢脈絡（外部資料引用）
    - `analysis`：編輯觀點分析
    - `conclusion`：結語（含互動問題）

15. **媒體排版（placement）**
    每個 section 的媒體有三種排版方式：`inline`、`full-width`、`side-by-side`。
    → 需要確認：前端是否支援這三種排版？哪個 breakpoint 下如何退化？

16. **內容格式**
    Section 的 `content` 欄位使用 Markdown 格式（含粗體、引用區塊 `>`、換行等）。
    → 需要確認：前端是否有 Markdown renderer？或需要 pipeline 輸出 HTML？

17. **封面圖 fallback**
    若某篇文章的封面 Moment 沒有媒體，`cover_image_url` 可能為空。
    → 需要確認：前端需要 placeholder 設計嗎？

---

### 🎨 設計師

**視覺設計**

18. **Section 的視覺規格**
    不同 section type 需要不同的視覺處理。目前 AI 會決定每篇文章的 section 組合和順序，但固定的 section types 讓設計師可以提前設計元件。
    → 需要確認：每種 section type 的設計規格（標題樣式、內容排版、媒體位置）。

19. **Moment 引用的視覺呈現**
    文章中會直接引用用戶的 Moment 原文（含 emoji、口語化用詞）。
    → 需要確認：引用區塊的設計（是否有特別的卡片樣式、用戶標識等）？

20. **文章列表頁（索引頁）**
    `PublishedStoryMeta` 提供：標題、封面圖 URL、tags、發佈時間、文章 URL。
    → 需要確認：列表頁每張 card 需要哪些資訊？tag 是否可點擊篩選？

21. **閱讀時間顯示**
    每篇文章有 `estimated_read_time`（以分鐘計算）。
    → 需要確認：是否需要在文章頁顯示「預計閱讀 X 分鐘」？放在哪個位置？

22. **Tag 設計**
    每篇文章有 2–5 個 tag（由 AI 生成，例：FEniX、見面會、手作應援）。
    → 需要確認：tag 的樣式？是否需要標準化 tag 清單（避免 AI 生成的 tag 過於分散）？

---

*本文件最後更新：2026-03-03*
*Pipeline 版本：v0.1（production readiness 強化已完成，正在進入正式環境前準備）*
