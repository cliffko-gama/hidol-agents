/**
 * hidol Feature Story AI Pipeline — Orchestrator Types
 *
 * 定義 pipeline 的設定、狀態、執行結果。
 * Orchestrator 透過這些型別追蹤整個流程的進度。
 */

import type { Moment } from "./moment";
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
} from "./agents";

// ============================================================
// Pipeline 設定
// ============================================================

export interface PipelineConfig {
  /** Pipeline 的唯一執行 ID */
  run_id: string;

  /** Agent A1 篩選設定 */
  filter: {
    min_text_length: number;
    min_engagement: number;
    since?: string;
    excluded_hashtags?: string[];
  };

  /** Agent A2 主題分析設定 */
  clustering: {
    max_topics: number;
    existing_topic_titles?: string[];
  };

  /** Agent B 研究設定 */
  research: {
    max_search_rounds: number;
    languages: ("zh-TW" | "zh-CN" | "en" | "ja" | "ko")[];
  };

  /** Agent C/D 品質設定 */
  quality: {
    editorial_guidelines: EditorialGuidelines;
    /** Agent D → Agent C 最多重試幾次 */
    max_revisions: number;
    /** Agent D 評分低於此分數才要求修改 */
    min_approval_score: number;
  };

  /** Agent E 發佈設定 */
  publish: {
    site_config: SiteConfig;
    existing_stories?: PublishedStoryMeta[];
    /** 是否需要人工審核（true = Agent D 通過後暫停，等人工確認） */
    require_human_review: boolean;
  };
}

// ============================================================
// Pipeline 狀態
// ============================================================

export type PipelineStage =
  | "initialized"
  | "filtering"          // Agent A1 執行中
  | "clustering"         // Agent A2 執行中
  | "researching"        // Agent B 執行中
  | "writing"            // Agent C 執行中
  | "reviewing"          // Agent D 執行中
  | "revising"           // Agent C 根據 feedback 修改中
  | "pending_human_review" // 等待人工審核
  | "publishing"         // Agent E 執行中
  | "completed"          // 全部完成
  | "failed";            // 執行失敗

export interface PipelineState {
  /** 對應的 Pipeline Config run_id */
  run_id: string;
  /** 當前階段 */
  stage: PipelineStage;
  /** 當前正在處理的 Topic index（一個 pipeline run 可能產出多篇專題） */
  current_topic_index: number;
  /** 當前 Topic 的 revision 次數 */
  current_revision_count: number;
  /** 各階段的中間結果 */
  intermediate_results: {
    a1?: AgentA1Output;
    a2?: AgentA2Output;
    /** 每個 Topic 一個 AgentBOutput */
    b?: Map<string, AgentBOutput>;
    /** 每個 Topic 的當前 story draft */
    c?: Map<string, FeatureStory>;
    /** 每個 Topic 的最新 review */
    d?: Map<string, AgentDOutput>;
    /** 每個 Topic 的發佈結果 */
    e?: Map<string, AgentEOutput>;
  };
  /** 錯誤記錄 */
  errors: PipelineError[];
  /** 開始時間 (ISO 8601) */
  started_at: string;
  /** 最後更新時間 (ISO 8601) */
  updated_at: string;
}

export interface PipelineError {
  stage: PipelineStage;
  agent: "A1" | "A2" | "B" | "C" | "D" | "E" | "orchestrator";
  message: string;
  /** 與錯誤相關的 Topic ID（如果有的話） */
  topic_id?: string;
  timestamp: string;
  /** 是否可以重試 */
  retryable: boolean;
}

// ============================================================
// Pipeline 最終結果
// ============================================================

export interface PipelineResult {
  run_id: string;
  /** 整體執行狀態 */
  status: "success" | "partial_success" | "failed";
  /** 成功產出的專題列表 */
  published_stories: PublishedStoryMeta[];
  /** 執行過程中的統計 */
  stats: {
    /** 輸入的 Moment 總數 */
    total_moments_input: number;
    /** 通過篩選的 Moment 數 */
    moments_after_filter: number;
    /** 分析出的主題數 */
    topics_identified: number;
    /** 成功發佈的專題數 */
    stories_published: number;
    /** 各專題的 revision 次數 */
    revision_counts: Record<string, number>;
  };
  /** 累積的所有錯誤 */
  errors: PipelineError[];
  started_at: string;
  completed_at: string;
}

// ============================================================
// Human Review（人工審核介面）
// ============================================================

export interface HumanReviewRequest {
  run_id: string;
  topic: Topic;
  feature_story: FeatureStory;
  /** Agent D 的審核結果（供人工參考） */
  ai_review: AgentDOutput;
  /** 使用的 Moment 原始資料（供人工比對） */
  source_moments: Moment[];
}

export interface HumanReviewResponse {
  /** 人工審核結果 */
  decision: "approve" | "reject" | "revise";
  /** 修改意見（如果 decision === "revise"） */
  feedback?: string;
  /** 審核者 ID */
  reviewer_id: string;
  reviewed_at: string;
}
