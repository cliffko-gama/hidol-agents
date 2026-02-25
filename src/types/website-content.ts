/**
 * hidol Feature Story — Website Content Model
 *
 * 定義 Agent E 產出的 JSON 格式。
 * hidol-fansite 前端會讀取這些 JSON 來渲染專題頁面和專欄中心。
 *
 * 檔案結構（在 hidol-fansite 中）：
 *   /data/
 *     stories.json          ← 專欄中心索引（StoryIndex）
 *     stories/
 *       {story-id}.json     ← 個別專題頁面資料（StoryPageData）
 */

// ============================================================
// 專欄中心索引（stories.json）
// ============================================================

export interface StoryIndex {
  /** 最後更新時間 (ISO 8601) */
  last_updated: string;
  /** 所有專題的摘要列表 */
  stories: StoryCard[];
}

export interface StoryCard {
  /** 專題 ID（也是檔名，如 "summer-fest-2025"） */
  id: string;
  /** 標題 */
  title: string;
  /** 副標題 */
  subtitle: string;
  /** 封面圖 URL */
  cover_image_url: string;
  /** 封面圖 alt text */
  cover_image_alt: string;
  /** 摘要（用於卡片預覽，50-80 字） */
  excerpt: string;
  /** 標籤 */
  tags: string[];
  /** 發佈日期 (ISO 8601) */
  published_at: string;
  /** 預估閱讀時間（分鐘） */
  read_time: number;
  /** 引用的 Moment 數量 */
  moment_count: number;
  /** 專題頁面相對路徑 */
  url: string;
}

// ============================================================
// 個別專題頁面資料（stories/{id}.json）
// ============================================================

export interface StoryPageData {
  /** 專題 ID */
  id: string;
  /** SEO & Meta */
  meta: StoryMeta;
  /** 頁面頭部 */
  header: StoryHeader;
  /** 文章內容段落 */
  sections: ContentSection[];
  /** 頁尾資訊 */
  footer: StoryFooter;
}

export interface StoryMeta {
  title: string;
  description: string;
  /** Open Graph 圖片 URL */
  og_image: string;
  /** 關鍵字（用於 SEO） */
  keywords: string[];
  /** Canonical URL */
  canonical_url: string;
  published_at: string;
  updated_at?: string;
}

export interface StoryHeader {
  title: string;
  subtitle: string;
  /** 封面圖 */
  cover: {
    url: string;
    alt: string;
    /** 圖片來源標記（引用自哪個用戶的 Moment） */
    credit: string;
  };
  published_at: string;
  read_time: number;
  tags: string[];
}

// ============================================================
// 內容段落（Section Types）
// ============================================================

export type ContentSection =
  | TextSection
  | MomentHighlightSection
  | MomentGallerySection
  | QuoteSection
  | TrendInsightSection
  | DividerSection;

interface BaseSectionFields {
  /** 段落唯一 ID（用於錨點導航） */
  section_id: string;
}

/** 純文字段落 */
export interface TextSection extends BaseSectionFields {
  type: "text";
  heading?: string;
  /** Markdown 格式的內文 */
  body: string;
}

/** 單一 Moment 重點呈現 */
export interface MomentHighlightSection extends BaseSectionFields {
  type: "moment_highlight";
  heading?: string;
  /** Moment 相關資訊 */
  moment: {
    user_name: string;
    text: string;
    media_url: string;
    media_type: "image" | "video";
    caption: string;
    /** 連回 hidol app 的 deep link */
    deep_link?: string;
  };
  /** 編輯附加的評論/串場文字 */
  editorial_note?: string;
}

/** Moment 圖片集 */
export interface MomentGallerySection extends BaseSectionFields {
  type: "moment_gallery";
  heading?: string;
  items: Array<{
    media_url: string;
    media_type: "image" | "video";
    caption: string;
    user_name: string;
  }>;
  /** 圖集的說明文字 */
  description?: string;
}

/** 引言/金句 */
export interface QuoteSection extends BaseSectionFields {
  type: "quote";
  text: string;
  /** 引言來源（用戶名或外部來源） */
  attribution?: string;
}

/** 趨勢洞察區塊 */
export interface TrendInsightSection extends BaseSectionFields {
  type: "trend_insight";
  heading: string;
  body: string;
  /** 引用的外部來源 */
  sources: Array<{
    title: string;
    url: string;
  }>;
}

/** 分隔線 */
export interface DividerSection extends BaseSectionFields {
  type: "divider";
}

// ============================================================
// 頁尾
// ============================================================

export interface StoryFooter {
  /** 引用的所有 Moment 來源 */
  moment_credits: Array<{
    user_name: string;
    moment_count: number;
  }>;
  /** 引用的所有外部來源 */
  external_sources: Array<{
    title: string;
    url: string;
  }>;
  /** 相關專題推薦（來自 stories.json 的其他專題） */
  related_stories: Array<{
    id: string;
    title: string;
    cover_image_url: string;
    url: string;
  }>;
}
