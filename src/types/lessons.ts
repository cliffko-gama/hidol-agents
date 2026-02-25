/**
 * hidol Feature Story AI Pipeline — Lessons Types
 *
 * 定義經驗累積系統的型別。
 * lessons.json 跨 run 持久化，讓 Agent C/D 從歷史錯誤中學習。
 */

import type { AgentDOutput } from "./agents.js";

// ============================================================
// Lesson Category
// ============================================================

/** 經驗教訓的分類 */
export type LessonCategory =
  | "url_fabrication"       // Agent C 編造了不存在的 URL
  | "data_fabrication"      // Agent C 編造了不存在的統計數據
  | "source_name_mismatch"  // 媒體名稱與 research 不符
  | "moment_id_missing"     // referenced_moment_ids 遺漏（被 autoFix 補齊）
  | "json_parse_failure"    // Agent C/D 回傳無法解析的 JSON
  | "brand_tone_violation"  // 品牌調性不合格
  | "content_structure"     // 內容結構問題
  | "moment_attribution"    // 素材歸屬問題
  | "readability"           // 可讀性問題
  | "revision_pattern";     // 反覆修改的模式（如同一問題連續出現）

// ============================================================
// Lesson
// ============================================================

/** Agent D 的五個檢查維度 key */
export type AgentDCheckDimension =
  | "factual_accuracy"
  | "brand_tone"
  | "content_structure"
  | "moment_attribution"
  | "readability";

/** 單一經驗教訓 */
export interface Lesson {
  /** 唯一 ID (格式: lesson-{timestamp}-{index}) */
  id: string;
  /** 分類 */
  category: LessonCategory;
  /** 摘要描述（1-2 句，人類可讀，也用於注入 prompt） */
  summary: string;
  /** 觀察到的頻率（跨所有 run 的累計次數） */
  occurrence_count: number;
  /** 首次觀察到的 run_id */
  first_seen_run_id: string;
  /** 最近一次觀察到的 run_id */
  last_seen_run_id: string;
  /** 首次觀察的時間 (ISO 8601) */
  first_seen_at: string;
  /** 最近一次觀察的時間 (ISO 8601) */
  last_seen_at: string;
  /** 連續多少次 run 沒有再出現（用於老化判斷） */
  consecutive_absent_runs: number;
  /**
   * 相關性權重 (0-1)。
   * 由 recalculateWeights() 計算：
   *   weight = frequency_factor * recency_factor + severity_bonus
   * 用於排序和篩選注入 prompt 的 top lessons。
   */
  weight: number;
  /** 相關的 Agent D 檢查維度（如果有的話） */
  check_dimension?: AgentDCheckDimension;
  /** 具體的 issues 樣本（最多保留 3 個，用於 prompt 中的例子） */
  sample_issues: string[];
}

// ============================================================
// Lessons File（持久化結構）
// ============================================================

/** lessons.json 的根結構 */
export interface LessonsFile {
  /** Schema 版本（方便未來遷移） */
  version: "1.0";
  /** 最後更新時間 (ISO 8601) */
  updated_at: string;
  /** 已完成的 run 總數（用於計算頻率因子） */
  total_runs: number;
  /** 所有經驗教訓 */
  lessons: Lesson[];
  /** 最近 N 次 run 的 Agent D 平均分摘要（用於追蹤改善趨勢） */
  score_trends: ScoreTrendEntry[];
}

/** 每次 run 的分數摘要 */
export interface ScoreTrendEntry {
  run_id: string;
  timestamp: string;
  /** 該 run 所有主題的 Agent D 平均 overall_score */
  avg_overall_score: number;
  /** 各維度的平均分 */
  avg_dimension_scores: Record<string, number>;
  /** 該 run 的總修改次數 */
  total_revisions: number;
}

// ============================================================
// Lesson Observation（暫存型別，orchestrator 收集用）
// ============================================================

/**
 * 從 pipeline 的單次 C→D cycle 中提取的原始觀察事件。
 * 由 orchestrator 收集，在 run 結束後傳給 mergeLessons()。
 */
export interface LessonObservation {
  category: LessonCategory;
  summary: string;
  /** 原始 issue 文字（來自 Agent D 的 issues[]） */
  raw_issue?: string;
  /** 相關的檢查維度 */
  check_dimension?: AgentDCheckDimension;
  /** 相關的 topic_id */
  topic_id?: string;
}

// ============================================================
// Extraction Input（extractObservations 的輸入）
// ============================================================

/** extractObservations 的輸入參數 */
export interface ExtractionInput {
  /** 所有 Agent D 審核結果（可能每個 topic 有多次） */
  dResults: Array<{
    topic_id: string;
    attempt: number;
    result: AgentDOutput;
  }>;
  /** 每個 topic 被 auto-fix 的 moment_id 數量 */
  autoFixCounts: Record<string, number>;
  /** JSON 解析重試記錄 */
  jsonRetryCounts: Array<{
    agent: "C" | "D";
    topic_id: string;
  }>;
  /** Pipeline 錯誤 */
  errors: Array<{
    agent: string;
    message: string;
    topic_id?: string;
  }>;
}
