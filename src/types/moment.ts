/**
 * hidol Feature Story AI Pipeline — Base Data Types
 *
 * Moment 是 hidol 的核心用戶內容單位。
 * 用戶透過拍照、影片、文字記錄當下的感受。
 */

// ============================================================
// Media & Engagement
// ============================================================

export type MediaType = "photo" | "video" | "text";

export interface Media {
  /** 媒體唯一識別碼 */
  id: string;
  /** 媒體類型 */
  type: "image" | "video";
  /** 媒體存取 URL */
  url: string;
  /** 縮圖 URL（用於預覽） */
  thumbnail_url?: string;
  /** 圖片寬度 (px) */
  width?: number;
  /** 圖片高度 (px) */
  height?: number;
  /** 影片長度（秒） */
  duration_seconds?: number;
  /** AI 生成的圖片描述（用於無法直接處理圖片的場景） */
  alt_text?: string;
}

export interface Engagement {
  likes: number;
  comments: number;
  shares: number;
}

// ============================================================
// Moment（核心資料單位）
// ============================================================

export interface Moment {
  /** Moment 唯一識別碼 */
  id: string;
  /** 發佈者 ID */
  user_id: string;
  /** 發佈者顯示名稱 */
  user_display_name: string;
  /** Moment 主要類型 */
  type: MediaType;
  /** 文字內容（用戶撰寫的描述或感受） */
  text_content: string;
  /** 附加的媒體檔案 */
  media: Media[];
  /** 用戶標記的 hashtag（不含 # 符號） */
  hashtags: string[];
  /** 地理位置資訊 */
  location?: {
    name: string;
    latitude?: number;
    longitude?: number;
  };
  /** 發布時間 (ISO 8601) */
  created_at: string;
  /** 互動數據 */
  engagement: Engagement;
  /** 原始 Moment 的 deep link（連回 hidol app） */
  deep_link?: string;
}
