/**
 * Orchestrator — Pipeline 總控
 *
 * 協調所有子 Agent 依序完成 Feature Story 的產出。
 */

import type { Moment } from "./types/moment.js";
import type {
  AgentA1Output,
  AgentA2Output,
  AgentBOutput,
  AgentCOutput,
  AgentDOutput,
  AgentEOutput,
  EditorialGuidelines,
  FeatureStory,
  Topic,
  SiteConfig,
  PublishedStoryMeta,
} from "./types/agents.js";
import type { PipelineConfig, PipelineResult, PipelineError } from "./types/pipeline.js";

import type { ExtractionInput } from "./types/lessons.js";

import { runAgentA1 } from "./agents/agent-a1.js";
import { runAgentA2 } from "./agents/agent-a2.js";
import { runAgentB } from "./agents/agent-b.js";
import { runAgentC } from "./agents/agent-c.js";
import { runAgentD } from "./agents/agent-d.js";
import { runAgentE } from "./agents/agent-e.js";
import {
  loadLessons,
  extractObservations,
  mergeLessons,
  saveLessons,
  formatLessonsForPrompt,
  buildScoreTrend,
} from "./lib/lessons.js";
import fs from "fs";
import path from "path";

/** 儲存中間產物到指定目錄 */
function saveArtifact(outputDir: string, filename: string, data: unknown) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[Save] ${filePath}`);
}

export async function runPipeline(
  moments: Moment[],
  config: PipelineConfig,
  outputDir?: string
): Promise<PipelineResult> {
  // 每次執行建立專屬的 artifacts 資料夾
  const artifactsDir = outputDir
    ? path.join(outputDir, config.run_id)
    : undefined;
  const startedAt = new Date().toISOString();
  const errors: PipelineError[] = [];
  const publishedStories: PublishedStoryMeta[] = [];
  const revisionCounts: Record<string, number> = {};

  // 經驗累積：載入歷史經驗 + 初始化收集器
  const lessonsFile = outputDir ? loadLessons(outputDir) : null;
  const lessonsPromptSection = lessonsFile
    ? formatLessonsForPrompt(lessonsFile.lessons)
    : "";
  const dResultsCollector: ExtractionInput["dResults"] = [];
  const autoFixCounts: Record<string, number> = {};
  const jsonRetryCounts: ExtractionInput["jsonRetryCounts"] = [];

  console.log("\n========================================");
  console.log("  hidol Feature Story Pipeline 啟動");
  console.log("========================================\n");
  console.log(`Run ID: ${config.run_id}`);
  console.log(`輸入 Moment 數: ${moments.length}`);
  if (lessonsFile && lessonsFile.lessons.length > 0) {
    console.log(`歷史經驗: ${lessonsFile.lessons.length} 條 (累計 ${lessonsFile.total_runs} 次 run)`);
  }
  console.log("");

  // ============================================================
  // Stage 1: Agent A1 — 篩選 Moment
  // ============================================================
  console.log("--- Stage 1: Moment 篩選 ---\n");

  let a1Result: AgentA1Output;
  try {
    a1Result = await runAgentA1({
      moments,
      filter_config: config.filter,
    });
  } catch (err) {
    const error: PipelineError = {
      stage: "filtering",
      agent: "A1",
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
      retryable: true,
    };
    errors.push(error);
    console.error(`[ERROR] Agent A1 失敗: ${error.message}`);
    return buildResult("failed", startedAt, moments.length, 0, 0, 0, publishedStories, revisionCounts, errors);
  }

  if (artifactsDir) saveArtifact(artifactsDir, "01-agent-a1-filter.json", a1Result);

  if (a1Result.filtered_moments.length === 0) {
    console.log("[終止] 篩選後沒有 Moment，素材不足。");
    return buildResult("failed", startedAt, moments.length, 0, 0, 0, publishedStories, revisionCounts, errors);
  }

  // ============================================================
  // Stage 2: Agent A2 — 主題分析
  // ============================================================
  console.log("\n--- Stage 2: 主題分析 ---\n");

  let a2Result: AgentA2Output;
  try {
    a2Result = await runAgentA2({
      filtered_moments: a1Result.filtered_moments,
      existing_topic_titles: config.clustering.existing_topic_titles,
      max_topics: config.clustering.max_topics,
    });
  } catch (err) {
    const error: PipelineError = {
      stage: "clustering",
      agent: "A2",
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
      retryable: true,
    };
    errors.push(error);
    console.error(`[ERROR] Agent A2 失敗: ${error.message}`);
    return buildResult("failed", startedAt, moments.length, a1Result.filtered_moments.length, 0, 0, publishedStories, revisionCounts, errors);
  }

  if (artifactsDir) saveArtifact(artifactsDir, "02-agent-a2-topics.json", a2Result);

  if (a2Result.topics.length === 0) {
    console.log("[終止] 無法形成任何主題。");
    return buildResult("failed", startedAt, moments.length, a1Result.filtered_moments.length, 0, 0, publishedStories, revisionCounts, errors);
  }

  // ============================================================
  // Stage 3-6: 對每個主題執行 Research → Write → Review → Publish
  // ============================================================
  for (let i = 0; i < a2Result.topics.length; i++) {
    const topic = a2Result.topics[i];
    console.log(`\n========================================`);
    console.log(`  主題 ${i + 1}/${a2Result.topics.length}: ${topic.title}`);
    console.log(`========================================\n`);

    // 取得該主題的 Moment
    const topicMoments = a1Result.filtered_moments.filter((m) =>
      topic.moment_ids.includes(m.id)
    );

    // --- Agent B: 趨勢研究 ---
    console.log("--- Stage 3: 趨勢研究 ---\n");

    // 計算 moments 摘要，提供給 Agent B 判斷素材豐富度以決定搜尋深度
    const avgTextLength =
      topicMoments.length > 0
        ? Math.round(
            topicMoments.reduce((sum, m) => sum + (m.text_content?.length ?? 0), 0) /
              topicMoments.length
          )
        : 0;
    const sampleTexts = topicMoments
      .slice(0, 5)
      .map((m) => m.text_content ?? "")
      .filter((t) => t.length > 0);

    let bResult: AgentBOutput;
    try {
      bResult = await runAgentB({
        topic,
        moments_summary: {
          count: topicMoments.length,
          avg_text_length: avgTextLength,
          sample_texts: sampleTexts,
        },
        research_config: {
          max_search_rounds: config.research.max_search_rounds,
          languages: config.research.languages,
        },
      });
    } catch (err) {
      console.error(`[ERROR] Agent B 失敗，使用空的研究結果繼續...`);
      errors.push({
        stage: "researching",
        agent: "B",
        message: err instanceof Error ? err.message : String(err),
        topic_id: topic.topic_id,
        timestamp: new Date().toISOString(),
        retryable: true,
      });
      bResult = {
        web_trends: [],
        social_insights: [],
        suggested_angles: ["直接從 Moment 用戶的觀點出發撰寫"],
        context_summary: "（研究階段失敗，請僅使用 Moment 素材撰寫）",
      };
    }

    if (artifactsDir) saveArtifact(artifactsDir, `03-topic-${i + 1}-agent-b-research.json`, bResult);

    // --- Agent C + D: 撰寫 + 審核 feedback loop ---
    console.log("\n--- Stage 4-5: 撰寫 + 審核 ---\n");

    let story: FeatureStory | null = null;
    let revisions = 0;
    let lastReviewFeedback: string | undefined;

    for (let attempt = 1; attempt <= config.quality.max_revisions + 1; attempt++) {
      // Agent C: 撰寫
      let cResult: AgentCOutput;
      try {
        cResult = await runAgentC({
          topic,
          moments: topicMoments,
          research: bResult,
          editorial_guidelines: config.quality.editorial_guidelines,
          revision_feedback: lastReviewFeedback,
          attempt_number: attempt,
          lessons_context: lessonsPromptSection,
        });
      } catch (err) {
        console.error(`[ERROR] Agent C 撰寫失敗 (attempt ${attempt})`);
        errors.push({
          stage: "writing",
          agent: "C",
          message: err instanceof Error ? err.message : String(err),
          topic_id: topic.topic_id,
          timestamp: new Date().toISOString(),
          retryable: true,
        });
        break;
      }

      // Auto-fix: 確保 referenced_moment_ids 包含所有實際引用的 Moment
      const beforeFixCount = cResult.feature_story.referenced_moment_ids.length;
      autoFixReferencedMomentIds(cResult.feature_story, topicMoments);
      const fixedCount = cResult.feature_story.referenced_moment_ids.length - beforeFixCount;
      if (fixedCount > 0) {
        autoFixCounts[topic.topic_id] = (autoFixCounts[topic.topic_id] || 0) + fixedCount;
      }

      if (artifactsDir) saveArtifact(artifactsDir, `04-topic-${i + 1}-agent-c-story-v${attempt}.json`, cResult);

      // Agent D: 審核
      let dResult: AgentDOutput;
      try {
        dResult = await runAgentD({
          feature_story: cResult.feature_story,
          original_moments: topicMoments,
          research: bResult,
          editorial_guidelines: config.quality.editorial_guidelines,
          lessons_context: lessonsPromptSection,
        });
      } catch (err) {
        console.error(`[ERROR] Agent D 審核失敗，直接使用當前版本`);
        errors.push({
          stage: "reviewing",
          agent: "D",
          message: err instanceof Error ? err.message : String(err),
          topic_id: topic.topic_id,
          timestamp: new Date().toISOString(),
          retryable: true,
        });
        story = cResult.feature_story;
        break;
      }

      // 收集 Agent D 結果（用於經驗提取）
      dResultsCollector.push({
        topic_id: topic.topic_id,
        attempt,
        result: dResult,
      });

      if (artifactsDir) saveArtifact(artifactsDir, `05-topic-${i + 1}-agent-d-review-v${attempt}.json`, dResult);

      if (dResult.status === "approved") {
        story = cResult.feature_story;
        revisions = attempt - 1;
        break;
      }

      // needs_revision
      if (attempt <= config.quality.max_revisions) {
        console.log(`[Orchestrator] 需要修改，進入第 ${attempt + 1} 次撰寫...`);

        // 自動在 revision feedback 尾部附上正確的 URL 清單
        // 讓 Agent C 不用猜，直接對照修正
        const correctUrlList = bResult.web_trends
          .map((t) => `- ${t.source}: ${t.url}`)
          .join("\n");

        const baseInstructions = dResult.revision_instructions ?? "請改善整體品質";
        lastReviewFeedback =
          `${baseInstructions}\n\n---\n\n` +
          `## 📋 正確的外部來源 URL 清單（Orchestrator 自動附加）\n\n` +
          `你的 referenced_sources 只能從以下 URL 中選用：\n\n${correctUrlList}\n\n` +
          `⚠️ 不要使用任何不在此清單中的 URL。`;
      } else {
        console.log(`[Orchestrator] 達到最大修改次數 (${config.quality.max_revisions})，使用當前版本`);
        story = cResult.feature_story;
        revisions = attempt - 1;
      }
    }

    if (!story) {
      console.log(`[SKIP] 主題「${topic.title}」未能產出有效的 Feature Story`);
      continue;
    }

    revisionCounts[topic.topic_id] = revisions;

    // Auto-fix: 過濾 referenced_sources，移除不在 research 中的 URL（防止編造來源被發佈）
    autoFilterReferencedSources(story, bResult);

    // --- Agent E: 發佈 ---
    console.log("\n--- Stage 6: 發佈 ---\n");
    try {
      const eResult = await runAgentE({
        feature_story: story,
        moments: topicMoments,
        site_config: config.publish.site_config,
        existing_stories: [...(config.publish.existing_stories ?? []), ...publishedStories],
      });

      publishedStories.push(eResult.story_meta);

      if (artifactsDir) saveArtifact(artifactsDir, `06-topic-${i + 1}-agent-e-publish.json`, eResult);

      // 寫入檔案到 hidol-fansite
      for (const file of eResult.generated_files) {
        console.log(`[Output] ${file.action}: ${file.path}`);
      }
    } catch (err) {
      console.error(`[ERROR] Agent E 發佈失敗: ${err instanceof Error ? err.message : String(err)}`);
      errors.push({
        stage: "publishing",
        agent: "E",
        message: err instanceof Error ? err.message : String(err),
        topic_id: topic.topic_id,
        timestamp: new Date().toISOString(),
        retryable: true,
      });
    }
  }

  // ============================================================
  // 經驗累積：提取觀察、合併、儲存
  // ============================================================
  if (outputDir && lessonsFile) {
    console.log("\n--- 經驗累積 ---\n");

    // 從 errors 中提取 JSON 相關的重試記錄
    const jsonRetries = errors
      .filter((e) => e.message.includes("JSON") || e.message.includes("parse"))
      .map((e) => ({
        agent: e.agent as "C" | "D",
        topic_id: e.topic_id || "unknown",
      }));

    const observations = extractObservations({
      dResults: dResultsCollector,
      autoFixCounts,
      jsonRetryCounts: [...jsonRetryCounts, ...jsonRetries],
      errors: errors.map((e) => ({
        agent: e.agent,
        message: e.message,
        topic_id: e.topic_id,
      })),
    });

    // 計算本次 run 的分數摘要
    const scoreTrend = buildScoreTrend(
      dResultsCollector,
      config.run_id,
      revisionCounts
    );

    const updatedLessons = mergeLessons(
      lessonsFile,
      observations,
      config.run_id,
      scoreTrend
    );

    saveLessons(outputDir, updatedLessons);

    console.log(
      `[Lessons] 本次提取 ${observations.length} 條觀察，` +
        `累計 ${updatedLessons.lessons.length} 條經驗`
    );

    // 儲存本次 run 的 lessons snapshot 到 artifacts
    if (artifactsDir) {
      saveArtifact(artifactsDir, "07-lessons-snapshot.json", {
        observations_this_run: observations,
        score_trend: scoreTrend,
        total_lessons: updatedLessons.lessons.length,
      });
    }
  }

  // ============================================================
  // 完成
  // ============================================================
  const status =
    publishedStories.length === a2Result.topics.length
      ? "success"
      : publishedStories.length > 0
        ? "partial_success"
        : "failed";

  return buildResult(
    status,
    startedAt,
    moments.length,
    a1Result.filtered_moments.length,
    a2Result.topics.length,
    publishedStories.length,
    publishedStories,
    revisionCounts,
    errors
  );
}

/**
 * 自動修正 referenced_moment_ids：
 * 掃描 cover、sections media、sections content，
 * 將實際被引用但遺漏的 moment_id 補齊。
 */
function autoFixReferencedMomentIds(
  story: FeatureStory,
  availableMoments: Moment[]
): void {
  const validIds = new Set(availableMoments.map((m) => m.id));
  const foundIds = new Set<string>();

  // 1. 封面 cover
  if (story.cover?.moment_id && validIds.has(story.cover.moment_id)) {
    foundIds.add(story.cover.moment_id);
  }

  // 2. 各 section 的 media placement
  for (const section of story.sections) {
    if (section.media) {
      for (const media of section.media) {
        if (media.moment_id && validIds.has(media.moment_id)) {
          foundIds.add(media.moment_id);
        }
      }
    }
  }

  // 3. 掃描 section content 中是否提及 moment_id 或 user_display_name
  for (const section of story.sections) {
    for (const moment of availableMoments) {
      // 直接出現 moment_id（如 "m-001"）
      if (section.content.includes(moment.id)) {
        foundIds.add(moment.id);
      }
      // 出現用戶名稱（表示引用了該 Moment 的內容）
      if (
        moment.user_display_name &&
        section.content.includes(moment.user_display_name)
      ) {
        foundIds.add(moment.id);
      }
    }
  }

  // 4. 合併到 referenced_moment_ids
  const existing = new Set(story.referenced_moment_ids);
  const added: string[] = [];
  for (const id of foundIds) {
    if (!existing.has(id)) {
      story.referenced_moment_ids.push(id);
      added.push(id);
    }
  }

  if (added.length > 0) {
    console.log(
      `[Auto-fix] referenced_moment_ids 補齊: +${added.join(", ")} ` +
        `(原有 ${existing.size}，現有 ${story.referenced_moment_ids.length})`
    );
  }
}

/**
 * 自動過濾 referenced_sources：
 * 移除任何不在 bResult.web_trends[].url 中的 URL，
 * 防止 Agent C 編造的來源被發佈到網站上。
 */
function autoFilterReferencedSources(
  story: FeatureStory,
  research: AgentBOutput
): void {
  const validUrls = new Set(research.web_trends.map((t) => t.url));
  const before = story.referenced_sources.length;
  story.referenced_sources = story.referenced_sources.filter((url) =>
    validUrls.has(url)
  );
  const removed = before - story.referenced_sources.length;
  if (removed > 0) {
    console.log(
      `[Auto-fix] referenced_sources 過濾: 移除 ${removed} 個不在 research 的 URL ` +
        `(${before} → ${story.referenced_sources.length})`
    );
  }
}

function buildResult(
  status: "success" | "partial_success" | "failed",
  startedAt: string,
  totalMoments: number,
  afterFilter: number,
  topicsIdentified: number,
  storiesPublished: number,
  publishedStories: PublishedStoryMeta[],
  revisionCounts: Record<string, number>,
  errors: PipelineError[]
): PipelineResult {
  return {
    run_id: "",
    status,
    published_stories: publishedStories,
    stats: {
      total_moments_input: totalMoments,
      moments_after_filter: afterFilter,
      topics_identified: topicsIdentified,
      stories_published: storiesPublished,
      revision_counts: revisionCounts,
    },
    errors,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  };
}
