/**
 * Agent B — 趨勢研究（Trend Research）
 *
 * 兩段式研究策略：
 *   Phase 1：從 Moment 自身萃取「話題性信號」（關鍵字、粉絲行為、情感主題）
 *   Phase 2：以信號驅動外部社群搜尋，找到能豐富文章的外部脈絡
 *
 * 工具：web_search_20250305（Anthropic 內建，server-side 執行）
 */

import type { AgentBInput, AgentBOutput } from "../types/agents.js";
import { AGENT_B_SYSTEM_PROMPT } from "../prompts/agent-b.js";
import { callAgentAgentic, extractJSON } from "../lib/call-agent.js";
import { QUALITY_MODEL } from "../lib/client.js";

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
};

export async function runAgentB(input: AgentBInput): Promise<AgentBOutput> {
  const momentCount = input.moments_summary?.count ?? input.topic.moment_ids.length;
  const isContentThin = input.topic.richness === "low" || momentCount < 5;
  const baseRounds = input.research_config?.max_search_rounds ?? 3;
  // 素材稀薄時多搜幾輪；但最多 5 輪，避免超 token
  const maxSearchRounds = Math.min(isContentThin ? baseRounds + 2 : baseRounds, 5);

  console.log(
    `[Agent B] 研究主題「${input.topic.title}」` +
    ` (richness=${input.topic.richness}, moments=${momentCount}, maxRounds=${maxSearchRounds})`
  );

  // ── Phase 1 提示：Moment 話題信號區塊 ───────────────────────
  const topMomentsSection = input.moments_summary?.top_moments?.length
    ? `
互動最高的 Moment（依 likes 排序）：
${input.moments_summary.top_moments.map((m, i) =>
  `[${i + 1}] ${m.engagement_likes} 讚 | ${m.has_media ? "有圖/影片" : "純文字"} | "${m.text.slice(0, 120)}${m.text.length > 120 ? "…" : ""}"`
).join("\n")}`.trim()
    : "";

  const sampleSection = input.moments_summary?.sample_texts?.length
    ? `
代表性 Moment 文字（最多 5 則）：
${input.moments_summary.sample_texts.map((t, i) => `[${i + 1}] ${t.slice(0, 100)}${t.length > 100 ? "…" : ""}`).join("\n")}`.trim()
    : "";

  const momentDataSection = [topMomentsSection, sampleSection].filter(Boolean).join("\n\n");

  // ── 搜尋策略提示 ───────────────────────────────────────────
  const thinContentNote = isContentThin
    ? `\n⚠️ 素材偏稀薄（${momentCount} 則 Moment）：請執行更深入的外部搜尋，讓 context_summary 即使 Moment 少也有充分脈絡。`
    : "";

  const userMessage = `
## 研究任務

主題：${input.topic.title}
描述：${input.topic.description}
關鍵字：${input.topic.keywords.join("、")}
建議敘事角度：${input.topic.suggested_narrative}
素材豐富度：${input.topic.richness}（${momentCount} 則 Moment）${thinContentNote}

---

## Phase 1：Moment 話題信號分析（在搜尋前先完成）

請先分析以下 Moment 素材，萃取「話題性信號」：

${momentDataSection || `（素材摘要：${input.topic.richness} 豐富度，${momentCount} 則）`}

分析重點：
1. **關鍵字**：Moment 中反覆出現的詞彙、地名、人名、活動名稱
2. **粉絲行為**：這批粉絲在做什麼？（排隊、手作應援、追星旅行、等待揭曉...）
3. **情感主題**：主要情緒是什麼？（期待、感動、共鳴、遺憾、成就感...）
4. **話題性因子**：為什麼這個主題值得寫成 Feature Story？它的 "共鳴點" 在哪？

---

## Phase 2：以信號驅動外部社群搜尋

使用 web_search 工具，依序執行以下搜尋（使用 Phase 1 萃取的關鍵字）：

1. **核心搜尋**：「${input.topic.keywords.slice(0, 2).join(" ")} 粉絲 2025」
2. **社群聲量**：「${input.topic.keywords[0]} Dcard」或「${input.topic.keywords[0]} PTT 討論」
3. **文化背景**：搜尋這類粉絲行為的更廣趨勢（例如：台灣偶像見面會文化、粉絲應援文化）
4. **延伸脈絡**：搜尋類似事件或現象，找到能讓文章有「普遍共鳴」的外部觀點

搜尋語言優先順序：${input.research_config?.languages?.join("、") ?? "繁體中文、英文"}

---

## 輸出指示

完成所有搜尋後，**直接輸出 JSON**，不要有任何前置說明或後記。

輸出格式：
\`\`\`json
{
  "moment_trend_signals": {
    "keywords": ["關鍵字1", "關鍵字2"],
    "fan_behaviors": ["具體行為描述1", "具體行為描述2"],
    "emotional_themes": ["情感主題1", "情感主題2"],
    "trending_factor": "一句話說明這個主題為什麼有共鳴"
  },
  "web_trends": [
    {
      "title": "文章標題",
      "source": "媒體名稱",
      "url": "真實搜尋到的 URL（禁止 example.com）",
      "summary": "50-100 字摘要",
      "published_at": "ISO 日期（若可知）",
      "relevance": "high 或 medium"
    }
  ],
  "social_insights": [
    {
      "platform": "平台名稱",
      "trend_description": "該平台上的具體討論描述",
      "sample_content": "代表性討論內容",
      "estimated_buzz": "viral / trending / moderate / niche"
    }
  ],
  "suggested_angles": [
    "切入角度1：說明理由",
    "切入角度2：說明理由"
  ],
  "context_summary": "300-500 字。整合 Moment 話題信號與外部社群脈絡，讓撰稿者能直接轉化為文章段落。必須具體描述：粉絲的真實行為與情感、外部趨勢驗證、值得深挖的觀點。"
}
\`\`\`

⚠️ URL 規則：web_trends 只放 web_search 搜尋到的真實 URL，找不到就保持空陣列 []。
`.trim();

  const response = await callAgentAgentic({
    model: QUALITY_MODEL,
    systemPrompt: AGENT_B_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 6000,  // 縮小 max_tokens 降低 rate limit 壓力
    tools: [WEB_SEARCH_TOOL],
    maxRounds: maxSearchRounds + 4,
  });

  const result = extractJSON<AgentBOutput>(response);

  // 過濾虛構 URL
  const originalCount = (result.web_trends ?? []).length;
  result.web_trends = (result.web_trends ?? []).filter(
    (t) => t.url && !t.url.includes("example.com") && t.url.startsWith("http")
  );
  const filtered = originalCount - result.web_trends.length;
  if (filtered > 0) {
    console.log(`[Agent B] ⚠️ 過濾掉 ${filtered} 個虛構 URL`);
  }

  // 確保必要欄位存在
  result.social_insights   = result.social_insights   ?? [];
  result.suggested_angles  = result.suggested_angles  ?? [];
  result.context_summary   = result.context_summary   ?? "";
  result.moment_trend_signals = result.moment_trend_signals ?? undefined;

  console.log(
    `[Agent B] ✅ 完成: ${result.web_trends.length} 篇趨勢文章, ` +
    `${result.social_insights.length} 則社群洞察, ` +
    `${result.moment_trend_signals?.keywords.length ?? 0} 個話題關鍵字`
  );

  return result;
}
