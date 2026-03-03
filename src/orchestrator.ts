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

/** Rate limit 緩衝：在 API 呼叫之間等待，避免超過 30k TPM 上限 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
import {
  loadCheckpoint,
  saveCheckpoint,
  getTopicCheckpoint,
  upsertTopicCheckpoint,
} from "./lib/checkpoint.js";
import {
  loadStoryHistory,
  saveStoryHistory,
  appendPublishedStories,
  getRecentStoryTitles,
} from "./lib/story-history.js";
import fs from "fs";
import path from "path";

/** 同一主題在此天數內發佈過 → Agent A2 不會重複選題；超過後自動解鎖 */
const DEDUP_COOLDOWN_DAYS = 60;

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

  // 斷點續傳：載入上次未完成的進度
  const checkpoint = outputDir ? loadCheckpoint(outputDir) : null;
  const cachedTopics = checkpoint?.topics.filter((t) => t.published_meta).map((t) => t.title) ?? [];
  if (cachedTopics.length > 0) {
    console.log(`[Checkpoint] 發現 ${cachedTopics.length} 個已發佈主題，可跳過：${cachedTopics.join("、")}`);
  }

  // 跨 run 去重：載入發佈歷史，取出冷卻期內的主題標題
  const storyHistory = outputDir ? loadStoryHistory(outputDir) : null;
  const recentTitles = storyHistory
    ? getRecentStoryTitles(storyHistory, DEDUP_COOLDOWN_DAYS)
    : [];
  if (recentTitles.length > 0) {
    console.log(
      `[StoryHistory] 最近 ${DEDUP_COOLDOWN_DAYS} 天內已發佈 ${recentTitles.length} 個主題（Agent A2 將避開）：${recentTitles.join("、")}`
    );
  } else if (storyHistory) {
    console.log(`[StoryHistory] 歷史記錄：累計 ${storyHistory.stories.length} 篇（無冷卻中主題）`);
  }

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
      // 合併：冷卻期內的歷史主題 + config 手動指定的禁止清單
      existing_topic_titles: [
        ...recentTitles,
        ...(config.clustering.existing_topic_titles ?? []),
      ],
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

    // --- Checkpoint: 檢查此主題是否已完整發佈 ---
    const topicCheckpoint = checkpoint ? getTopicCheckpoint(checkpoint, topic.title) : undefined;
    if (topicCheckpoint?.published_meta) {
      console.log(`[Checkpoint] ✅ 主題「${topic.title}」已發佈，跳過所有階段`);
      publishedStories.push(topicCheckpoint.published_meta);
      continue;
    }

    // --- Agent B: 趨勢研究 ---
    console.log("--- Stage 3: 趨勢研究 ---\n");

    let bResult: AgentBOutput;

    // 優先從 checkpoint 復用 Agent B 的研究結果
    if (topicCheckpoint?.b_result) {
      console.log(`[Checkpoint] ♻️  復用上次的研究結果，跳過 Agent B`);
      bResult = topicCheckpoint.b_result;
    } else {
      console.log("[Rate Limit] 等待 5 秒（429/529 由 withRetry 動態退避處理）...");
      await sleep(5_000);

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

      // 互動最高的前 5 則 Moment（有 likes 優先，否則取前 5）
      const topMomentsForB = [...topicMoments]
        .sort((a, b) => (b.engagement?.likes ?? 0) - (a.engagement?.likes ?? 0))
        .slice(0, 5)
        .map((m) => ({
          text: (m.text_content ?? "").slice(0, 150),  // 限長避免超 token
          engagement_likes: m.engagement?.likes ?? 0,
          has_media: (m.media?.length ?? 0) > 0,
        }));

      try {
        bResult = await runAgentB({
          topic,
          moments_summary: {
            count: topicMoments.length,
            avg_text_length: avgTextLength,
            sample_texts: sampleTexts,
            top_moments: topMomentsForB,
          },
          research_config: {
            max_search_rounds: config.research.max_search_rounds,
            languages: config.research.languages,
          },
        });

        // Agent B 成功 → 存入 checkpoint，下次 re-run 可跳過
        if (checkpoint && outputDir) {
          upsertTopicCheckpoint(checkpoint, topic.title, { b_result: bResult });
          saveCheckpoint(outputDir, checkpoint);
          console.log(`[Checkpoint] 💾 Agent B 結果已快取`);
        }
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
          research_failed: true,
        };
      }
    }

    if (artifactsDir) saveArtifact(artifactsDir, `03-topic-${i + 1}-agent-b-research.json`, bResult);

    // --- Agent C + D: 撰寫 + 審核 feedback loop ---
    console.log("\n--- Stage 4-5: 撰寫 + 審核 ---\n");
    console.log("[Rate Limit] 等待 15 秒（429/529 由 withRetry 動態退避處理）...");
    await sleep(15_000);

    // 只傳 top 5 Moments（按 likes 排序），減少 Agent C 的 input tokens
    const top5Moments = [...topicMoments]
      .sort((a, b) => (b.engagement?.likes ?? 0) - (a.engagement?.likes ?? 0))
      .slice(0, 5);
    console.log(`[Moments] 使用前 ${top5Moments.length} 則高互動 Moment（共 ${topicMoments.length} 則）`);

    let story: FeatureStory | null = null;
    let revisions = 0;
    let lastReviewFeedback: string | undefined;

    for (let attempt = 1; attempt <= config.quality.max_revisions + 1; attempt++) {
      // Agent C: 撰寫
      let cResult: AgentCOutput;
      try {
        cResult = await runAgentC({
          topic,
          moments: top5Moments,
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

      // Theme Spine 前置驗證：檢查 intro 是否包含核心關鍵字
      const themeSpineWarning = checkThemeSpine(cResult.feature_story, topic, bResult);
      if (themeSpineWarning) {
        console.warn(`[Theme Spine] ⚠️ ${themeSpineWarning}`);
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

        // 若 Theme Spine 驗證有警告，在 revision feedback 前置提示
        const themeSpineHint = themeSpineWarning
          ? `## ⚠️ Theme Spine 警告（Orchestrator 自動附加）\n\n${themeSpineWarning}\n\n請確保 intro 前兩句就點出文章的核心 Theme Spine。\n\n---\n\n`
          : "";

        lastReviewFeedback =
          `${themeSpineHint}${baseInstructions}\n\n---\n\n` +
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
        // 歷史全量 + config 手動清單 + 本次 run 已發佈（讓 Agent E 知道整個 site 現有文章）
        existing_stories: [
          ...(storyHistory?.stories ?? []),
          ...(config.publish.existing_stories ?? []),
          ...publishedStories,
        ],
      });

      publishedStories.push(eResult.story_meta);

      if (artifactsDir) saveArtifact(artifactsDir, `06-topic-${i + 1}-agent-e-publish.json`, eResult);

      // 寫入檔案到 hidol-fansite
      for (const file of eResult.generated_files) {
        console.log(`[Output] ${file.action}: ${file.path}`);
      }

      // 發佈成功 → 儲存 checkpoint，下次 re-run 可完整跳過此主題
      if (checkpoint && outputDir) {
        upsertTopicCheckpoint(checkpoint, topic.title, {
          story,
          published_meta: eResult.story_meta,
        });
        saveCheckpoint(outputDir, checkpoint);
        console.log(`[Checkpoint] 💾 主題「${topic.title}」已標記為發佈完成`);
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
  // 跨 run 去重：將本次發佈的 story 存入歷史記錄
  // ============================================================
  if (outputDir && storyHistory && publishedStories.length > 0) {
    const updatedHistory = appendPublishedStories(storyHistory, publishedStories);
    saveStoryHistory(outputDir, updatedHistory);
    console.log(
      `\n[StoryHistory] 💾 新增 ${publishedStories.length} 篇至歷史記錄` +
      `（累計 ${updatedHistory.stories.length} 篇，共 ${updatedHistory.total_runs} 次 run）`
    );
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

/**
 * Theme Spine 前置驗證：
 * 掃描 intro 段落的前兩句，確認包含至少一個核心關鍵字。
 * 若缺失，回傳警告文字；否則回傳 null。
 */
function checkThemeSpine(
  story: FeatureStory,
  topic: Topic,
  research: AgentBOutput
): string | null {
  const introSection = story.sections.find((s) => s.type === "intro");
  if (!introSection) return null;

  // 取 intro 前兩句（以句號、問號、感嘆號或換行切割）
  const firstTwoSentences = introSection.content
    .split(/[。！？!?\n]/)
    .filter((s) => s.trim().length > 0)
    .slice(0, 2)
    .join("。");

  if (!firstTwoSentences) return null;

  // 收集候選關鍵字：topic 標題詞 + Agent B 的關鍵字
  const topicKeywords = topic.title
    .split(/[\s　、，,\/\-]+/)
    .filter((w) => w.length >= 2);
  const researchKeywords = research.moment_trend_signals?.keywords ?? [];
  const allKeywords = [...new Set([...topicKeywords, ...researchKeywords])];

  // 找是否有關鍵字出現在前兩句
  const found = allKeywords.filter((kw) =>
    firstTwoSentences.includes(kw)
  );

  if (found.length === 0 && allKeywords.length > 0) {
    return (
      `intro 前兩句未包含任何核心關鍵字。` +
      `\n  候選關鍵字: ${allKeywords.slice(0, 8).join("、")}` +
      `\n  intro 前兩句: 「${firstTwoSentences.slice(0, 80)}」`
    );
  }

  return null;
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
