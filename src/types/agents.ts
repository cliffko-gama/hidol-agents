/**
 * hidol Feature Story AI Pipeline — Agent I/O Types
 *
 * 定義每個 Agent 的輸入與輸出介面。
 * Agent 之間的資料傳遞全部透過這些型別約束。
 */

import type { Moment, Media } from "./moment";

// ============================================================
// Agent A1 — Moment 篩選（Content Filter）
// ============================================================

export interface AgentA1Input {
  /** 原始 Moment 資料（可能來自 API 或模擬資料） */
  moments: Moment[];
  /** 篩選設定 */
  filter_config: {
    /** 最少文字字數（低於此值視為內容單薄） */
    min_text_length: number;
    /** 最少互動數（likes + comments + shares） */
    min_engagement: number;
    /** 時間範圍：只處理此日期之後的 Moment (ISO 8601) */
    since?: string;
    /** 排除的 hashtag（例如廣告、活動抽獎等） */
    excluded_hashtags?: string[];
  };
}

export interface RejectionRecord {
  moment_id: string;
  reason:
    | "low_quality"        // 內容品質不足
    | "too_short"          // 文字過短
    | "low_engagement"     // 互動數過低
    | "duplicate"          // 與其他 Moment 重複
    | "irrelevant"         // 與 hidol 社群無關
    | "inappropriate";     // 不當內容
  detail: string;
}

export interface AgentA1Output {
  /** 通過篩選的 Moment */
  filtered_moments: Moment[];
  /** 被過濾掉的記錄（用於 debug 和改善篩選邏輯） */
  rejection_log: RejectionRecord[];
  /** 篩選統計 */
  stats: {
    total_input: number;
    total_passed: number;
    total_rejected: number;
  };
}

// ============================================================
// Agent A2 — 主題分析（Topic Clustering）
// ============================================================

export interface AgentA2Input {
  /** 已篩選的 Moment */
  filtered_moments: Moment[];
  /** 已發佈過的主題標題（避免重複選題） */
  existing_topic_titles?: string[];
  /** 偏好的主題數量（建議 1-5） */
  max_topics?: number;
}

/** 主題的素材豐富度評估 */
export type TopicRichness = "high" | "medium" | "low";

export interface Topic {
  /** 主題 ID（由 Agent 生成，例如 "topic-summer-fest-2025"） */
  topic_id: string;
  /** 主題標題（用於 Feature Story 的初始方向） */
  title: string;
  /** 主題描述（1-2 句話說明這個主題的角度） */
  description: string;
  /** 搜尋關鍵字（中英文，供 Agent B 使用） */
  keywords: string[];
  /** 歸屬此主題的所有 Moment ID */
  moment_ids: string[];
  /** 最具代表性的 Moment ID（3-5 則，用於封面和重點呈現） */
  primary_moment_ids: string[];
  /** 素材豐富度自評 */
  richness: TopicRichness;
  /** 建議的敘事角度 */
  suggested_narrative: string;
}

export interface AgentA2Output {
  /** 分析出的主題列表（依推薦優先度排序） */
  topics: Topic[];
  /** 未被歸入任何主題的 Moment ID（孤立的 Moment） */
  unclustered_moment_ids: string[];
}

// ============================================================
// Agent B — 趨勢研究（Trend Research）
// ============================================================

export interface AgentBInput {
  /** 要研究的主題 */
  topic: Topic;
  /**
   * 該主題的 Moment 摘要，包含結構化的互動與行為信號。
   * Agent B 利用這些信號萃取「話題性」因子，再驅動外部搜尋。
   */
  moments_summary?: {
    count: number;
    avg_text_length: number;
    /** 代表性文字（最多 5 則），用於理解語境 */
    sample_texts: string[];
    /** 互動最高的 Moment（最多 5 則），含結構化資訊 */
    top_moments?: Array<{
      text: string;
      engagement_likes: number;
      has_media: boolean;
    }>;
  };
  /** 研究深度控制 */
  research_config?: {
    max_search_rounds: number;
    languages: ("zh-TW" | "zh-CN" | "en" | "ja" | "ko")[];
    focus_platforms?: string[];
  };
}

export interface WebTrend {
  /** 文章/頁面標題 */
  title: string;
  /** 來源名稱（例如「ETtoday」「KKBOX」） */
  source: string;
  /** 原始 URL */
  url: string;
  /** 摘要（50-100 字） */
  summary: string;
  /** 發佈日期 (ISO 8601)，如果可以取得 */
  published_at?: string;
  /** 與主題的相關程度 */
  relevance: "high" | "medium";
}

export interface SocialInsight {
  /** 平台名稱 */
  platform: string;
  /** 趨勢描述 */
  trend_description: string;
  /** 代表性內容摘錄（如果有的話） */
  sample_content?: string;
  /** 估計的討論熱度 */
  estimated_buzz: "viral" | "trending" | "moderate" | "niche";
}

export interface AgentBOutput {
  /** 網路上找到的相關趨勢文章（只放真實搜尋到的 URL） */
  web_trends: WebTrend[];
  /** 社群平台的動態洞察 */
  social_insights: SocialInsight[];
  /** 建議的切入角度（結合 Moment 信號與外部研究） */
  suggested_angles: string[];
  /**
   * 綜合背景摘要（直接作為 Agent C 的 context）。
   * 整合「Moment 自身話題信號」與「外部社群脈絡」，
   * 300-500 字，讓撰稿者能直接轉化為有深度的段落。
   */
  context_summary: string;
  /**
   * 標記研究階段是否因錯誤而降級為空結果。
   * true 時代表 Agent B 失敗，以下欄位均為空，
   * Agent D 應對「來源合規」維度採取較寬鬆的評分標準。
   */
  research_failed?: boolean;
  /**
   * 從 Moment 自身萃取的話題性信號。
   * 用於解釋「為什麼這批 Moment 值得寫成 Feature Story」。
   */
  moment_trend_signals?: {
    /** 反覆出現的關鍵字或主題詞 */
    keywords: string[];
    /** 粉絲具體行為模式（例如：排隊、手作應援、等待揭曉） */
    fan_behaviors: string[];
    /** 情感主題（例如：期待落空又釋懷、感動到哭、成就感） */
    emotional_themes: string[];
    /** 話題性一句話分析：為什麼這個主題有共鳴？ */
    trending_factor: string;
  };
}

// ============================================================
// Agent C — 內容撰寫（Content Writer）
// ============================================================

export interface AgentCInput {
  /** 主題資訊 */
  topic: Topic;
  /** 該主題的 Moment 原始內容 */
  moments: Moment[];
  /** Agent B 的研究結果 */
  research: AgentBOutput;
  /** hidol 品牌調性指南 */
  editorial_guidelines: EditorialGuidelines;
  /**
   * Agent D 的修改意見（僅在 revision 時提供）。
   * 第一次撰寫時為 undefined。
   */
  revision_feedback?: string;
  /** 當前是第幾次撰寫（1 = 首次，2+ = 修改） */
  attempt_number: number;
  /** 歷史經驗摘要（由 orchestrator 注入，格式為 Markdown） */
  lessons_context?: string;
}

export interface EditorialGuidelines {
  /** 品牌語氣描述 */
  tone: string;
  /** 目標讀者描述 */
  target_audience: string;
  /** 寫作風格的 Do's */
  style_dos: string[];
  /** 寫作風格的 Don'ts */
  style_donts: string[];
  /** 參考範例文章（optional few-shot） */
  example_articles?: string[];
}

export type SectionType =
  | "intro"              // 開頭引言
  | "moment_highlight"   // Moment 精選呈現
  | "trend_context"      // 外部趨勢脈絡
  | "analysis"           // 觀點分析
  | "conclusion";        // 結語

export interface MediaPlacement {
  /** 引用的 Moment ID */
  moment_id: string;
  /** 使用該 Moment 的哪個媒體（index in Moment.media[]） */
  media_index: number;
  /** 圖片說明文字 */
  caption: string;
  /** 排版位置 */
  placement: "inline" | "full-width" | "side-by-side";
}

export interface StorySection {
  /** 段落類型 */
  type: SectionType;
  /** 段落標題（intro 和 conclusion 可以沒有） */
  heading?: string;
  /** 段落內容（Markdown 格式） */
  content: string;
  /** 該段落使用的媒體素材 */
  media?: MediaPlacement[];
}

export interface FeatureStory {
  /** 專題標題 */
  title: string;
  /** 副標題 */
  subtitle: string;
  /** 封面圖設定 */
  cover: {
    /** 封面使用的 Moment ID */
    moment_id: string;
    /** 封面使用該 Moment 的哪個媒體 */
    media_index: number;
    /** 封面圖說 */
    caption: string;
  };
  /** 文章段落 */
  sections: StorySection[];
  /** 標籤 */
  tags: string[];
  /** 預估閱讀時間（分鐘） */
  estimated_read_time: number;
  /** 引用的所有 Moment ID（用於快速索引） */
  referenced_moment_ids: string[];
  /** 引用的所有外部來源 URL */
  referenced_sources: string[];
}

export interface AgentCOutput {
  feature_story: FeatureStory;
}

// ============================================================
// Agent D — 品質審核（Quality Reviewer）
// ============================================================

export interface AgentDInput {
  /** 待審的 Feature Story */
  feature_story: FeatureStory;
  /** 原始 Moment（用於事實核對） */
  original_moments: Moment[];
  /** 原始研究資料（用於來源確認） */
  research: AgentBOutput;
  /** 品牌調性指南（用於調性檢查） */
  editorial_guidelines: EditorialGuidelines;
  /** 歷史經驗摘要（由 orchestrator 注入，格式為 Markdown） */
  lessons_context?: string;
}

export interface ReviewCheck {
  /** 是否通過 */
  pass: boolean;
  /** 分數 1-10 */
  score: number;
  /** 具體問題描述（如果沒通過） */
  issues: string[];
}

export type ReviewStatus = "approved" | "needs_revision";

export interface AgentDOutput {
  /** 審核結果 */
  status: ReviewStatus;
  /** 整體評分 (1-10) */
  overall_score: number;
  /** 各維度檢查結果 */
  checks: {
    /** 事實準確性：引用的 Moment 和外部資訊是否正確 */
    factual_accuracy: ReviewCheck;
    /** 品牌調性：是否符合 hidol 的語氣和風格 */
    brand_tone: ReviewCheck;
    /** 內容結構：段落是否合理、有邏輯 */
    content_structure: ReviewCheck;
    /** 素材歸屬：是否正確引用了 Moment 來源 */
    moment_attribution: ReviewCheck;
    /** 可讀性：語句是否通順、有無贅字 */
    readability: ReviewCheck;
  };
  /**
   * 修改指示（僅在 status === "needs_revision" 時提供）。
   * 這段文字會直接傳給 Agent C 作為 revision_feedback。
   * 應具體指出需要修改的地方和方向。
   */
  revision_instructions?: string;
}

// ============================================================
// Agent E — 發佈排版（Publisher）
// ============================================================

export interface AgentEInput {
  /** 已通過審核的 Feature Story */
  feature_story: FeatureStory;
  /** 對應的 Moment 原始資料（需要媒體 URL） */
  moments: Moment[];
  /** 網站設定 */
  site_config: SiteConfig;
  /** 已發佈的專題列表（用於更新索引頁） */
  existing_stories?: PublishedStoryMeta[];
}

export interface SiteConfig {
  /** 網站根目錄路徑 */
  site_root: string;
  /** Feature Story 頁面的 URL 前綴 */
  story_url_prefix: string;
  /** 使用的模板風格 */
  template_style: string;
}

export interface PublishedStoryMeta {
  /** 專題 ID */
  story_id: string;
  /** 標題 */
  title: string;
  /** 發佈日期 (ISO 8601) */
  published_at: string;
  /** 頁面 URL */
  url: string;
  /** 封面圖 URL */
  cover_image_url: string;
  /** 標籤 */
  tags: string[];
}

export interface GeneratedFile {
  /** 檔案相對路徑（相對於 site_root） */
  path: string;
  /** 檔案內容 */
  content: string;
  /** 操作類型 */
  action: "create" | "update";
}

export interface AgentEOutput {
  /** 生成的檔案列表 */
  generated_files: GeneratedFile[];
  /** 新專題的 metadata（加入索引頁用） */
  story_meta: PublishedStoryMeta;
}
