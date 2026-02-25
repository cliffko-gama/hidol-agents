/**
 * Lessons Module — 經驗累積系統
 *
 * 負責 lessons.json 的讀寫、經驗提取、合併、老化與注入。
 */

import fs from "fs";
import path from "path";
import type {
  LessonsFile,
  Lesson,
  LessonObservation,
  LessonCategory,
  ScoreTrendEntry,
  ExtractionInput,
  AgentDCheckDimension,
} from "../types/lessons.js";
import type { AgentDOutput } from "../types/agents.js";

// ============================================================
// Constants
// ============================================================

/** 最多持久化的 lesson 數量 */
const MAX_TOTAL_LESSONS = 30;

/** 注入 prompt 時的預設 lesson 數量上限 */
const DEFAULT_PROMPT_MAX_COUNT = 7;

/** 連續幾次 run 未出現就可能被修剪 */
const PRUNE_ABSENT_THRESHOLD = 5;

/** 低於此頻率比例且超過 absent 門檻的 lesson 會被移除 */
const PRUNE_FREQUENCY_THRESHOLD = 0.2;

/** 分數趨勢最多保留幾次 run */
const MAX_TREND_ENTRIES = 10;

// ============================================================
// 1. loadLessons — 讀取 lessons.json
// ============================================================

export function loadLessons(outputDir: string): LessonsFile {
  const filePath = path.join(outputDir, "lessons.json");
  if (!fs.existsSync(filePath)) {
    // 首次執行：回傳空結構
    return {
      version: "1.0",
      updated_at: new Date().toISOString(),
      total_runs: 0,
      lessons: [],
      score_trends: [],
    };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as LessonsFile;
  } catch (err) {
    console.warn(
      `[Lessons] ⚠️ 讀取 lessons.json 失敗，使用空結構: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      version: "1.0",
      updated_at: new Date().toISOString(),
      total_runs: 0,
      lessons: [],
      score_trends: [],
    };
  }
}

// ============================================================
// 2. extractObservations — 從本次 run 提取觀察
// ============================================================

export function extractObservations(
  input: ExtractionInput
): LessonObservation[] {
  const observations: LessonObservation[] = [];

  // --- 2a. 從 Agent D 的 factual_accuracy issues 提取 ---
  for (const d of input.dResults) {
    const fa = d.result.checks.factual_accuracy;
    for (const issue of fa.issues) {
      if (matchesUrlFabrication(issue)) {
        observations.push({
          category: "url_fabrication",
          summary:
            "Agent C 編造了不在 research 資料中的 URL。必須嚴格只使用 research.web_trends[].url 提供的連結。",
          raw_issue: issue,
          check_dimension: "factual_accuracy",
          topic_id: d.topic_id,
        });
      }
      if (matchesDataFabrication(issue)) {
        observations.push({
          category: "data_fabrication",
          summary:
            "Agent C 引用了無法在 research 資料中追溯的統計數據。所有數字必須來自 research.web_trends[].summary。",
          raw_issue: issue,
          check_dimension: "factual_accuracy",
          topic_id: d.topic_id,
        });
      }
      if (matchesSourceNameMismatch(issue)) {
        observations.push({
          category: "source_name_mismatch",
          summary:
            "Agent C 使用了與 research.web_trends[].source 不符的媒體名稱。必須使用 research 中提供的確切媒體名。",
          raw_issue: issue,
          check_dimension: "factual_accuracy",
          topic_id: d.topic_id,
        });
      }
    }
  }

  // --- 2b. 品牌調性問題 ---
  for (const d of input.dResults) {
    const bt = d.result.checks.brand_tone;
    if (!bt.pass || bt.score < 7) {
      for (const issue of bt.issues) {
        if (isNegativeIssue(issue)) {
          observations.push({
            category: "brand_tone_violation",
            summary: truncate(`品牌調性問題：${issue}`, 120),
            raw_issue: issue,
            check_dimension: "brand_tone",
            topic_id: d.topic_id,
          });
        }
      }
    }
  }

  // --- 2c. 其他維度失敗 ---
  const dimensionMap: Array<[string, LessonCategory]> = [
    ["content_structure", "content_structure"],
    ["moment_attribution", "moment_attribution"],
    ["readability", "readability"],
  ];

  for (const d of input.dResults) {
    for (const [dim, cat] of dimensionMap) {
      const check =
        d.result.checks[dim as keyof typeof d.result.checks];
      if (check && (!check.pass || check.score < 7)) {
        for (const issue of check.issues) {
          if (isNegativeIssue(issue)) {
            observations.push({
              category: cat,
              summary: truncate(issue, 120),
              raw_issue: issue,
              check_dimension: dim as AgentDCheckDimension,
              topic_id: d.topic_id,
            });
          }
        }
      }
    }
  }

  // --- 2d. Auto-fix moment_ids ---
  for (const [topicId, count] of Object.entries(input.autoFixCounts)) {
    if (count > 0) {
      observations.push({
        category: "moment_id_missing",
        summary: `Agent C 遺漏了 ${count} 個 referenced_moment_ids，需要 orchestrator 自動補齊。撰寫時請確認所有引用的 Moment 都列入 referenced_moment_ids。`,
        topic_id: topicId,
      });
    }
  }

  // --- 2e. JSON parse failures ---
  for (const entry of input.jsonRetryCounts) {
    observations.push({
      category: "json_parse_failure",
      summary: `Agent ${entry.agent} 回傳的 JSON 格式錯誤，需要重試。請確保輸出是嚴格的 JSON 格式，不要在字串中使用未跳脫的特殊字元。`,
      topic_id: entry.topic_id,
    });
  }

  // --- 2f. 修改模式偵測：同一問題跨修改輪次反覆出現 ---
  const topicIssueHistory = new Map<string, Map<string, number>>();
  for (const d of input.dResults) {
    if (!topicIssueHistory.has(d.topic_id)) {
      topicIssueHistory.set(d.topic_id, new Map());
    }
    const hist = topicIssueHistory.get(d.topic_id)!;
    for (const issue of getAllIssues(d.result)) {
      if (isNegativeIssue(issue)) {
        const key = normalizeIssueKey(issue);
        hist.set(key, (hist.get(key) || 0) + 1);
      }
    }
  }
  for (const [topicId, hist] of topicIssueHistory) {
    for (const [issueKey, count] of hist) {
      if (count >= 2) {
        observations.push({
          category: "revision_pattern",
          summary: `同一問題在修改後仍然存在（出現 ${count} 次）：${issueKey}`,
          topic_id: topicId,
        });
      }
    }
  }

  return deduplicateObservations(observations);
}

// ============================================================
// 3. mergeLessons — 合併、老化、修剪
// ============================================================

export function mergeLessons(
  existing: LessonsFile,
  observations: LessonObservation[],
  runId: string,
  scoreTrend: ScoreTrendEntry
): LessonsFile {
  const now = new Date().toISOString();
  const updatedLessons = [...existing.lessons];
  const observedKeys = new Set<string>();

  // --- Step 1: 合併觀察到既有 lessons ---
  for (const obs of observations) {
    const matchKey = buildMatchKey(obs.category, obs.summary);
    observedKeys.add(matchKey);

    const existingLesson = updatedLessons.find(
      (l) => buildMatchKey(l.category, l.summary) === matchKey
    );

    if (existingLesson) {
      // 更新已存在的 lesson
      existingLesson.occurrence_count += 1;
      existingLesson.last_seen_run_id = runId;
      existingLesson.last_seen_at = now;
      existingLesson.consecutive_absent_runs = 0;
      // 最多保留 3 個 sample issues
      if (
        obs.raw_issue &&
        existingLesson.sample_issues.length < 3 &&
        !existingLesson.sample_issues.includes(obs.raw_issue)
      ) {
        existingLesson.sample_issues.push(obs.raw_issue);
      }
    } else {
      // 建立新 lesson
      updatedLessons.push({
        id: `lesson-${Date.now()}-${updatedLessons.length}`,
        category: obs.category,
        summary: obs.summary,
        occurrence_count: 1,
        first_seen_run_id: runId,
        last_seen_run_id: runId,
        first_seen_at: now,
        last_seen_at: now,
        consecutive_absent_runs: 0,
        weight: 0, // 下面會重新計算
        check_dimension: obs.check_dimension,
        sample_issues: obs.raw_issue ? [obs.raw_issue] : [],
      });
    }
  }

  // --- Step 2: 老化——未在本次觀察到的 lesson +1 absent ---
  for (const lesson of updatedLessons) {
    const key = buildMatchKey(lesson.category, lesson.summary);
    if (!observedKeys.has(key)) {
      lesson.consecutive_absent_runs += 1;
    }
  }

  // --- Step 3: 重新計算權重 ---
  const totalRuns = existing.total_runs + 1;
  for (const lesson of updatedLessons) {
    lesson.weight = calculateWeight(lesson, totalRuns);
  }

  // --- Step 4: 修剪——移除過期且低頻的 lesson ---
  const prunedLessons = updatedLessons.filter((l) => {
    if (l.consecutive_absent_runs >= PRUNE_ABSENT_THRESHOLD) {
      const frequencyRatio = l.occurrence_count / totalRuns;
      if (frequencyRatio < PRUNE_FREQUENCY_THRESHOLD) {
        console.log(
          `[Lessons] 移除過期經驗: "${l.summary.slice(0, 50)}..." ` +
            `(absent ${l.consecutive_absent_runs} runs, freq ${(frequencyRatio * 100).toFixed(0)}%)`
        );
        return false;
      }
    }
    return true;
  });

  // --- Step 5: 總數上限（保留最高權重） ---
  prunedLessons.sort((a, b) => b.weight - a.weight);
  const finalLessons = prunedLessons.slice(0, MAX_TOTAL_LESSONS);

  // --- Step 6: 更新分數趨勢（保留最近 N 次） ---
  const updatedTrends = [...existing.score_trends, scoreTrend];
  if (updatedTrends.length > MAX_TREND_ENTRIES) {
    updatedTrends.splice(0, updatedTrends.length - MAX_TREND_ENTRIES);
  }

  return {
    version: "1.0",
    updated_at: now,
    total_runs: totalRuns,
    lessons: finalLessons,
    score_trends: updatedTrends,
  };
}

// ============================================================
// 4. saveLessons — 寫入 lessons.json
// ============================================================

export function saveLessons(
  outputDir: string,
  data: LessonsFile
): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, "lessons.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(
    `[Lessons] 儲存經驗至: ${filePath} (${data.lessons.length} 條, 累計 ${data.total_runs} 次 run)`
  );
}

// ============================================================
// 5. formatLessonsForPrompt — 格式化為 Markdown 注入 prompt
// ============================================================

const CATEGORY_LABELS: Record<LessonCategory, string> = {
  url_fabrication: "來源 URL 編造",
  data_fabrication: "統計數據編造",
  source_name_mismatch: "媒體名稱不符",
  moment_id_missing: "Moment ID 遺漏",
  json_parse_failure: "JSON 格式錯誤",
  brand_tone_violation: "品牌調性偏差",
  content_structure: "內容結構問題",
  moment_attribution: "素材歸屬問題",
  readability: "可讀性問題",
  revision_pattern: "反覆出現的問題",
};

export function formatLessonsForPrompt(
  lessons: Lesson[],
  maxCount: number = DEFAULT_PROMPT_MAX_COUNT
): string {
  if (lessons.length === 0) return "";

  // 按權重排序，取 top N
  const topLessons = [...lessons]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxCount);

  // 按分類分組
  const grouped = new Map<LessonCategory, Lesson[]>();
  for (const l of topLessons) {
    if (!grouped.has(l.category)) {
      grouped.set(l.category, []);
    }
    grouped.get(l.category)!.push(l);
  }

  let md = "## 📚 歷史經驗\n\n";
  md += "以下是過去 pipeline 執行中反覆出現的問題，請特別注意避免：\n\n";

  for (const [category, items] of grouped) {
    const label = CATEGORY_LABELS[category] || category;
    md += `### ${label}\n`;
    for (const item of items) {
      const freq =
        item.occurrence_count > 1
          ? ` (已出現 ${item.occurrence_count} 次)`
          : "";
      md += `- ${item.summary}${freq}\n`;
    }
    md += "\n";
  }

  return md;
}

// ============================================================
// 6. buildScoreTrend — 計算本次 run 的分數摘要
// ============================================================

export function buildScoreTrend(
  dResults: ExtractionInput["dResults"],
  runId: string,
  revisionCounts: Record<string, number>
): ScoreTrendEntry {
  if (dResults.length === 0) {
    return {
      run_id: runId,
      timestamp: new Date().toISOString(),
      avg_overall_score: 0,
      avg_dimension_scores: {},
      total_revisions: 0,
    };
  }

  // 只取每個 topic 的最後一次審核（最終結果）
  const lastPerTopic = new Map<
    string,
    ExtractionInput["dResults"][number]
  >();
  for (const d of dResults) {
    const existing = lastPerTopic.get(d.topic_id);
    if (!existing || d.attempt > existing.attempt) {
      lastPerTopic.set(d.topic_id, d);
    }
  }

  const finalResults = Array.from(lastPerTopic.values());
  const avgOverall =
    finalResults.reduce((sum, d) => sum + d.result.overall_score, 0) /
    finalResults.length;

  const dims = [
    "factual_accuracy",
    "brand_tone",
    "content_structure",
    "moment_attribution",
    "readability",
  ] as const;

  const avgDimScores: Record<string, number> = {};
  for (const dim of dims) {
    avgDimScores[dim] =
      Math.round(
        (finalResults.reduce(
          (sum, d) => sum + d.result.checks[dim].score,
          0
        ) /
          finalResults.length) *
          10
      ) / 10;
  }

  const totalRevisions = Object.values(revisionCounts).reduce(
    (sum, c) => sum + c,
    0
  );

  return {
    run_id: runId,
    timestamp: new Date().toISOString(),
    avg_overall_score: Math.round(avgOverall * 10) / 10,
    avg_dimension_scores: avgDimScores,
    total_revisions: totalRevisions,
  };
}

// ============================================================
// Internal Helpers
// ============================================================

/** 權重計算：頻率(log-scaled) × 近期度(線性衰減) + 嚴重度加成 */
function calculateWeight(lesson: Lesson, totalRuns: number): number {
  // Factor 1: 頻率（log-scaled，避免高頻 lesson 過度主導）
  const frequencyRatio = lesson.occurrence_count / Math.max(totalRuns, 1);
  const frequencyFactor = Math.min(
    1.0,
    Math.log2(1 + frequencyRatio * 10) / Math.log2(11)
  );

  // Factor 2: 近期度（每缺席一次 run 衰減 0.15，最低 0.1）
  const recencyFactor = Math.max(
    0.1,
    1.0 - lesson.consecutive_absent_runs * 0.15
  );

  // Factor 3: 嚴重度加成（一票否決類別加更多）
  const severityBonus: Record<string, number> = {
    url_fabrication: 0.3,
    data_fabrication: 0.3,
    source_name_mismatch: 0.2,
    json_parse_failure: 0.1,
    moment_id_missing: 0.1,
    brand_tone_violation: 0.1,
    content_structure: 0.05,
    moment_attribution: 0.05,
    readability: 0.0,
    revision_pattern: 0.15,
  };
  const bonus = severityBonus[lesson.category] || 0;

  return Math.min(1.0, frequencyFactor * recencyFactor + bonus);
}

/** 建立用於比對的 key（category + summary 前 60 字） */
function buildMatchKey(category: string, summary: string): string {
  return `${category}::${summary.slice(0, 60)}`;
}

/** 判斷是否為 URL 編造相關的 issue */
function matchesUrlFabrication(issue: string): boolean {
  return /URL.*(?:不在|找不到|不存在|不合規|不匹配|非來自)|referenced_sources.*不在|來源合規.*不通過/i.test(
    issue
  );
}

/** 判斷是否為數據編造相關的 issue */
function matchesDataFabrication(issue: string): boolean {
  return /數據.*(?:無法追溯|捏造|不存在|編造)|(?:捏造|編造).*數據|統計.*(?:無來源|不可查)/i.test(
    issue
  );
}

/** 判斷是否為來源名稱不符的 issue */
function matchesSourceNameMismatch(issue: string): boolean {
  return /媒體名稱.*(?:不一致|不符|沒有|不匹配)|來源名稱.*(?:錯誤|不對)/i.test(
    issue
  );
}

/** 過濾 Agent D 的正面評語，只保留負面問題 */
function isNegativeIssue(issue: string): boolean {
  const trimmed = issue.trim();

  // 明確正面的起始符號
  if (/^[✅👍✓✔🎉]/.test(trimmed)) return false;

  // 正面起頭的句式（開頭判斷，較精準）
  const positiveStartPatterns: RegExp[] = [
    /^整體.*(?:優秀|良好|不錯|正確|符合|達標)/,
    /^結構.*(?:合理|清晰|完整|良好)/,
    /^沒有.*(?:問題|錯誤|違規)/,
    /^用詞.*(?:準確|恰當|正確)/,
    /^引用.*(?:正確|合規|無誤)/,
    /^保留.*(?:不錯|良好|正確)/,
    /^敘事.*(?:流暢|自然|清晰)/,
    /^段落.*(?:合理|清楚|完整|順暢)/,
    /^文章.*(?:符合|達到|通過)/,
    /^Moment.*(?:充足|正確|合規|有效|完整)/,
    /^所有.*(?:有效|正確|通過|合規|正常)/,
    /^已正確(?:標注|引用|呈現|設定)/,
    /^(?:符合|達到|通過).*(?:標準|要求|規範)/,
    /^全部.*(?:正確|合規|通過|完整)/,
    /^均.*(?:正確|合規|符合)/,
    /^各.*(?:正確|合規|符合)/,
  ];

  for (const p of positiveStartPatterns) {
    if (p.test(trimmed)) return false;
  }

  // 純正面陳述（不含否定詞時才觸發）
  // 先確認句子中沒有負面指示詞，再用正面關鍵詞判斷
  const hasNegativeIndicator =
    /(?:不|未|沒有|缺少|遺漏|錯誤|不符|不一致|問題|失敗|偏差|編造|捏造|過多|過少|不足|低分|需要改|應修正)/.test(
      trimmed
    );
  if (!hasNegativeIndicator) {
    const positiveOnlyKeywords =
      /曝光量充足|所有.*有效|都.*正確|均.*合規|全部.*通過|已涵蓋|完整呈現|正確標注|符合標準/;
    if (positiveOnlyKeywords.test(trimmed)) return false;
  }

  return true;
}

/** 蒐集 Agent D 所有維度的 issues */
function getAllIssues(d: AgentDOutput): string[] {
  return [
    ...d.checks.factual_accuracy.issues,
    ...d.checks.brand_tone.issues,
    ...d.checks.content_structure.issues,
    ...d.checks.moment_attribution.issues,
    ...d.checks.readability.issues,
  ];
}

/** 正規化 issue 文字用於比對（去除動態數值） */
function normalizeIssueKey(issue: string): string {
  return issue
    .replace(/https?:\/\/\S+/g, "<URL>")
    .replace(/m-\d+/g, "<MOMENT_ID>")
    .replace(/第\s*\d+\s*個?/g, "第N個")
    .replace(/\d+(\.\d+)?%/g, "N%")
    .slice(0, 80);
}

/** 截斷字串 */
function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 3) + "...";
}

/** 去重觀察（同 category + summary 前 60 字） */
function deduplicateObservations(
  obs: LessonObservation[]
): LessonObservation[] {
  const seen = new Map<string, LessonObservation>();
  for (const o of obs) {
    const key = buildMatchKey(o.category, o.summary);
    if (!seen.has(key)) {
      seen.set(key, o);
    }
  }
  return Array.from(seen.values());
}
