/**
 * hidol Feature Story Pipeline — Main Entry Point
 *
 * 使用模擬資料執行 end-to-end pipeline。
 */

import { MOCK_MOMENTS } from "./fixtures/mock-moments.js";
import { HIDOL_EDITORIAL_GUIDELINES } from "./prompts/editorial-guidelines.js";
import { runPipeline } from "./orchestrator.js";
import type { PipelineConfig } from "./types/pipeline.js";
import fs from "fs";
import path from "path";

async function main() {
  const runId = `run-${Date.now()}`;

  const config: PipelineConfig = {
    run_id: runId,

    filter: {
      min_text_length: 10,
      min_engagement: 20,
      excluded_hashtags: ["特賣", "限時"],
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

  console.log("🚀 hidol Feature Story Pipeline POC\n");
  console.log(`使用 ${MOCK_MOMENTS.length} 則模擬 Moment 資料`);

  const outputDir = path.resolve("output");
  const result = await runPipeline(MOCK_MOMENTS, config, outputDir);

  // Print result summary
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
      console.log(`  - ${story.title} (${story.url})`);
    }
  }

  if (result.errors.length > 0) {
    console.log(`\n錯誤 (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`  - [${err.agent}] ${err.message}`);
    }
  }

  // Save full result to file
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
