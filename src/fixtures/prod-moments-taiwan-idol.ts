/**
 * 台灣偶像 — 生產環境 Moment 資料
 *
 * 從 hidol 後端匯出的真實 Moment，轉換為 Pipeline 所需的 Moment 型別。
 * 原始資料：hidol-prod-moments-summary-台灣偶像.json
 */

import type { Moment } from "../types/moment.js";
import rawData from "./prod-moments-taiwan-idol.json" assert { type: "json" };

interface ProdMoment {
  id: string;
  open_id: string;
  hidol_id: string;
  public_status: number;
  title: string;
  description: string;
  location_name: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  main_attachment: string;
  attachments: string;
  hashtag_ids: string;
  created_time: number;
  topic_id: string;
}

interface RawAttachment {
  id: string;
  type: "image" | "video" | null;
  image: string | null;
  video: string | null;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  gif: string | null;
}

function transformMoment(raw: ProdMoment): Moment {
  // 解析 main_attachment（JSON 字串）
  let attachment: RawAttachment | null = null;
  try {
    attachment = JSON.parse(raw.main_attachment) as RawAttachment;
  } catch {
    // 略過無效 attachment
  }

  // 媒體類型
  const mediaType = attachment?.type === "video" ? "video" : attachment?.type === "image" ? "image" : null;

  // 媒體陣列
  const media = attachment && mediaType
    ? [{
        id: attachment.id,
        type: mediaType as "image" | "video",
        url: attachment.image ?? attachment.video ?? "",
        thumbnail_url: attachment.thumbnail || undefined,
        width: attachment.width ?? undefined,
        height: attachment.height ?? undefined,
        duration_seconds: attachment.duration ? attachment.duration / 1000 : undefined,
      }]
    : [];

  // 文字內容：合併 title + description，去除重複
  const textContent = raw.title && raw.description && raw.title !== raw.description
    ? `${raw.title}\n${raw.description}`
    : raw.description || raw.title || "";

  // 用戶顯示名稱：用 open_id 後 8 碼當作識別
  const userDisplayName = `粉絲_${raw.open_id.slice(-8)}`;

  // Moment 類型
  const momentType = mediaType === "video" ? "video" : mediaType === "image" ? "photo" : "text";

  return {
    id: raw.id,
    user_id: raw.open_id,
    user_display_name: userDisplayName,
    type: momentType,
    text_content: textContent,
    media,
    hashtags: [],  // hashtag_ids 為內部 ID，無法解析成文字標籤
    location: raw.location_name
      ? {
          name: raw.location_name,
          latitude: raw.location_lat ?? undefined,
          longitude: raw.location_lng ?? undefined,
        }
      : undefined,
    created_at: new Date(raw.created_time).toISOString(),
    engagement: { likes: 0, comments: 0, shares: 0 },  // 原始資料無互動數據
    deep_link: `hidol://moment/${raw.id}`,
  };
}

export const TAIWAN_IDOL_MOMENTS: Moment[] = (rawData as ProdMoment[])
  .filter((m) => m.public_status === 1)      // 只取公開的
  .filter((m) => m.description?.trim())       // 過濾空內容
  .map(transformMoment);

console.log(`[Fixture] 台灣偶像 Moments：共 ${TAIWAN_IDOL_MOMENTS.length} 則`);
