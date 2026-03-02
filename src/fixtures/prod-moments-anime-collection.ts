/**
 * 動漫蒐藏 — 生產環境 Moment 資料（去識別化版）
 *
 * 從 hidol 後端匯出的真實 Moment，轉換為 Pipeline 所需的 Moment 型別。
 * 原始資料：hidol-prod-moments_summary-動漫收藏.json
 *
 * 去識別化處理：
 *   - open_id / hidol_id 已替換為匿名代號（uid_anime_001 ~ uid_anime_007）
 *   - 文字內容、圖片路徑保持原樣（不含個人可識別資訊）
 *
 * 使用者匿名對照表（僅供 維護參考，不含真實 ID）：
 *   uid_anime_001 → ギヴン 等日文系動漫蒐藏者
 *   uid_anime_002 → 吉伊卡哇 (Chiikawa) 粉絲
 *   uid_anime_003 → 排球少年 (Haikyu!!) 周邊收集者
 *   uid_anime_004 → 初音等二手物品販售者
 *   uid_anime_005 → 台北國際動漫節現場購物紀錄
 *   uid_anime_006 → 咒術迴戰 / 進擊的巨人 收藏者
 *   uid_anime_007 → 動漫卡片收藏者
 */

import type { Moment } from "../types/moment.js";
import rawData from "./prod-moments-anime-collection.json" assert { type: "json" };

interface ProdMoment {
  id: string;
  open_id: string;
  hidol_id: string;
  public_status: number;
  title: string | null;
  description: string | null;
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

// 匿名使用者顯示名稱映射（閱讀友好版）
const USER_LABELS: Record<string, string> = {
  uid_anime_001: "動漫蒐藏家_01",
  uid_anime_002: "吉伊卡哇粉_02",
  uid_anime_003: "排球少年粉_03",
  uid_anime_004: "二手交流者_04",
  uid_anime_005: "動漫節戰利品_05",
  uid_anime_006: "咒術收藏家_06",
  uid_anime_007: "卡片蒐藏者_07",
};

function transformMoment(raw: ProdMoment): Moment {
  // 解析 main_attachment（JSON 字串）
  let attachment: RawAttachment | null = null;
  try {
    attachment = JSON.parse(raw.main_attachment) as RawAttachment;
  } catch {
    // 略過無效 attachment
  }

  // 媒體類型
  const mediaType =
    attachment?.type === "video"
      ? "video"
      : attachment?.type === "image"
        ? "image"
        : null;

  // 媒體陣列
  const media =
    attachment && mediaType
      ? [
          {
            id: attachment.id,
            type: mediaType as "image" | "video",
            url: attachment.image ?? attachment.video ?? "",
            thumbnail_url: attachment.thumbnail || undefined,
            width: attachment.width ?? undefined,
            height: attachment.height ?? undefined,
            duration_seconds: attachment.duration
              ? attachment.duration / 1000
              : undefined,
          },
        ]
      : [];

  // 文字內容：合併 title + description，去除重複
  const title = raw.title?.trim() ?? "";
  const desc = raw.description?.trim() ?? "";
  const textContent =
    title && desc && title !== desc
      ? `${title}\n${desc}`
      : desc || title || "";

  // 使用者顯示名稱（使用友好匿名標籤）
  const userDisplayName = USER_LABELS[raw.open_id] ?? `粉絲_${raw.open_id.slice(-3)}`;

  // Moment 類型
  const momentType =
    mediaType === "video"
      ? "video"
      : mediaType === "image"
        ? "photo"
        : "text";

  return {
    id: raw.id,
    user_id: raw.open_id,
    user_display_name: userDisplayName,
    type: momentType,
    text_content: textContent,
    media,
    hashtags: [], // hashtag_ids 為內部 ID，無法解析成文字標籤
    location: raw.location_name
      ? {
          name: raw.location_name,
          latitude: raw.location_lat ?? undefined,
          longitude: raw.location_lng ?? undefined,
        }
      : undefined,
    created_at: new Date(raw.created_time).toISOString(),
    engagement: { likes: 0, comments: 0, shares: 0 }, // 原始資料無互動數據
    deep_link: `hidol://moment/${raw.id}`,
  };
}

export const ANIME_COLLECTION_MOMENTS: Moment[] = (rawData as ProdMoment[])
  .filter((m) => m.public_status === 1) // 只取公開的
  .filter((m) => (m.description?.trim() || m.title?.trim())) // 過濾空內容
  .map(transformMoment);

console.log(`[Fixture] 動漫蒐藏 Moments：共 ${ANIME_COLLECTION_MOMENTS.length} 則`);
