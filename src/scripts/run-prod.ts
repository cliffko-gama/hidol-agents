/**
 * hidol Feature Story Pipeline — 生產資料入口
 *
 * 讀取 hidol 生產環境的 Moment 資料（JSON 格式），
 * 轉換為 pipeline 內部格式後執行完整 pipeline。
 *
 * 用法:
 *   npx tsx src/scripts/run-prod.ts <moments-json-path>
 *   npx tsx src/scripts/run-prod.ts ../../hidol-prod-moments-summary-台灣偶像.json
 */

import fs from "fs";
import path from "path";
import type { Moment, Media } from "../types/moment.js";
import { HIDOL_EDITORIAL_GUIDELINES } from "../prompts/editorial-guidelines.js";
import { runPipeline } from "../orchestrator.js";
import type { PipelineConfig } from "../types/pipeline.js";

// ============================================================
// 生產資料型別（hidol DB export 格式）
// ============================================================

interface ProdAttachment {
  id: string;
  gif: string | null;
  link: string | null;
  type: "image" | "video";
  image: string | null;
  video: string | null;
  width: number;
  height: number;
  duration: number;
  thumbnail: string;
}

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
  location_place_id: string | null;
  emotion_type: string | null;
  emotion_strength: string | null;
  main_attachment: string;
  attachments: string;
  hashtag_ids: string;
  datetime: string | null;
  sort: string;
  created_time: number; // Unix ms
  updated_time: number;
  topic_id: string;
  moment_count: number;
}

// ============================================================
// 用戶顯示名稱映射（open_id 後 6 碼 → 粉絲暱稱）
// ============================================================

function buildUserDisplayName(openId: string): string {
  // 使用 open_id 末 6 碼作為識別，格式為「粉絲_XXXXXX」
  const suffix = openId.slice(-6);
  return `粉絲_${suffix}`;
}

// ============================================================
// 核心轉換器：ProdMoment → Moment
// ============================================================

function convertProdMoment(prod: ProdMoment): Moment {
  // --- text_content: 合併 title + description ---
  const titleStr = (prod.title ?? "").trim();
  const descStr = (prod.description ?? "").trim();
  let textContent = "";
  if (titleStr && descStr) {
    // 避免完全重複的情況（有些 title 和 description 幾乎一樣）
    textContent =
      titleStr.startsWith(descStr.slice(0, 10)) && descStr.length > 0
        ? descStr
        : `${titleStr}\n${descStr}`;
  } else {
    textContent = titleStr || descStr;
  }

  // --- media: 解析 main_attachment ---
  const media: Media[] = [];
  if (prod.main_attachment) {
    try {
      const att: ProdAttachment = JSON.parse(prod.main_attachment);
      if (att.type === "image" && att.image) {
        media.push({
          id: att.id,
          type: "image",
          // 使用相對路徑（Agent E 會保留此 URL 作為 src）
          url: att.image,
          thumbnail_url: att.thumbnail || undefined,
          width: att.width || undefined,
          height: att.height || undefined,
          // 用 text_content 前 50 字作為 alt_text，方便 Agent C 理解圖片語境
          alt_text: textContent.slice(0, 50) || undefined,
        });
      } else if (att.type === "video" && att.video) {
        media.push({
          id: att.id,
          type: "video",
          url: att.video,
          thumbnail_url: att.thumbnail || att.image || undefined,
          width: att.width || undefined,
          height: att.height || undefined,
          duration_seconds: att.duration || undefined,
          alt_text: textContent.slice(0, 50) || undefined,
        });
      }
    } catch {
      // main_attachment 解析失敗，跳過媒體
    }
  }

  // --- 解析額外附件 ---
  if (prod.attachments && prod.attachments !== "[]") {
    try {
      const extras: ProdAttachment[] = JSON.parse(prod.attachments);
      for (const att of extras) {
        if (att.type === "image" && att.image) {
          media.push({
            id: att.id,
            type: "image",
            url: att.image,
            thumbnail_url: att.thumbnail || undefined,
            width: att.width || undefined,
            height: att.height || undefined,
          });
        }
      }
    } catch {
      // 解析失敗，跳過
    }
  }

  // --- 時間轉換 ---
  const createdAt = new Date(prod.created_time).toISOString();

  // --- 地點 ---
  const location =
    prod.location_name
      ? {
          name: prod.location_name,
          latitude: prod.location_lat ?? undefined,
          longitude: prod.location_lng ?? undefined,
        }
      : undefined;

  // --- 判斷 type ---
  const momentType: "photo" | "video" | "text" =
    media.length > 0
      ? media[0].type === "video"
        ? "video"
        : "photo"
      : "text";

  return {
    id: prod.id,
    user_id: prod.open_id,
    user_display_name: buildUserDisplayName(prod.open_id),
    type: momentType,
    text_content: textContent,
    media,
    hashtags: [], // hashtag_ids 只有 ID 無法取得 hashtag 名稱
    location,
    created_at: createdAt,
    engagement: {
      likes: 0,
      comments: 0,
      shares: 0,
    },
  };
}

// ============================================================
// Main
// ============================================================

async function main() {
  // --- 讀取命令列參數 ---
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("用法: npx tsx src/scripts/run-prod.ts <moments-json-path>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`找不到檔案: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`📂 載入生產資料: ${resolvedPath}`);
  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const prodMoments: ProdMoment[] = JSON.parse(raw);
  console.log(`   原始記錄數: ${prodMoments.length}`);

  // --- 過濾 public_status = 1（公開）---
  const publicMoments = prodMoments.filter((m) => m.public_status === 1);
  console.log(`   公開 Moment 數: ${publicMoments.length}`);

  // --- 格式轉換 ---
  const moments: Moment[] = publicMoments.map(convertProdMoment);

  // --- 顯示轉換摘要 ---
  const userCounts = new Map<string, number>();
  for (const m of moments) {
    userCounts.set(m.user_display_name, (userCounts.get(m.user_display_name) ?? 0) + 1);
  }
  console.log(`   轉換後用戶數: ${userCounts.size}`);
  for (const [name, count] of [...userCounts.entries()].slice(0, 5)) {
    console.log(`     ${name}: ${count} 則`);
  }

  // --- Pipeline 設定（生產資料版）---
  const runId = `run-${Date.now()}`;
  const config: PipelineConfig = {
    run_id: runId,

    filter: {
      // 生產資料無 engagement 數據，設為 0
      min_text_length: 5,
      min_engagement: 0,
      excluded_hashtags: [],
    },

    clustering: {
      max_topics: 2,
    },

    research: {
      max_search_rounds: 2,
      languages: ["zh-TW", "en"],
    },

    quality: {
      editorial_guidelines: HIDOL_EDITORIAL_GUIDELINES,
      max_revisions: 3,
      min_approval_score: 7,
    },

    publish: {
      site_config: {
        site_root: "../hidol-fansite",
        story_url_prefix: "#/story/",
        template_style: "default",
      },
      existing_stories: [],
      require_human_review: false,
    },
  };

  console.log("\n🚀 hidol Feature Story Pipeline（生產資料模式）\n");

  const outputDir = path.resolve("output");
  const result = await runPipeline(moments, config, outputDir);

  // --- 結果摘要 ---
  console.log("\n========================================");
  console.log("  Pipeline 執行結果");
  console.log("========================================\n");
  console.log(`狀態: ${result.status}`);
  console.log(`輸入 Moment: ${result.stats.total_moments_input}`);
  console.log(`篩選後 Moment: ${result.stats.moments_after_filter}`);
  console.log(`發現主題: ${result.stats.topics_identified}`);
  console.log(`成功發佈: ${result.stats.stories_published}`);

  if (result.published_stories.length > 0) {
    console.log("\n發佈的專題:");
    for (const story of result.published_stories) {
      console.log(`  - ${story.title}`);
      console.log(`    URL: ${story.url}`);
    }
  }

  if (result.errors.length > 0) {
    console.log(`\n錯誤 (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`  - [${err.agent}] ${err.message.slice(0, 100)}`);
    }
  }

  // --- 儲存完整結果 ---
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, `${runId}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n完整結果已儲存至: ${outputPath}`);
}

main().catch((err) => {
  console.error("Pipeline 執行失敗:", err);
  process.exit(1);
});
