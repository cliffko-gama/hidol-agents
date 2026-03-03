/**
 * Pipeline Checkpoint — 斷點續傳
 *
 * 將每個主題的處理進度寫入 output/pipeline-checkpoint.json。
 * 下次 re-run 時，已完成的主題可直接跳過或復用 Agent B 的研究結果，
 * 節省 API 呼叫次數和時間。
 *
 * Checkpoint key：主題標題的正規化字串（小寫、空白轉 dash、截 60 字元）。
 * 重置方式：刪除 output/pipeline-checkpoint.json。
 */

import fs from "fs";
import path from "path";
import type { AgentBOutput, PublishedStoryMeta, FeatureStory } from "../types/agents.js";

export interface CheckpointTopic {
  fingerprint: string;
  title: string;
  updated_at: string;
  /** Agent B 研究結果（已快取）*/
  b_result?: AgentBOutput;
  /** Agent C/D 最終通過的文章 */
  story?: FeatureStory;
  /** Agent E 發佈後的 meta（存在代表該主題已完成發佈）*/
  published_meta?: PublishedStoryMeta;
}

export interface PipelineCheckpoint {
  version: "1";
  updated_at: string;
  topics: CheckpointTopic[];
}

const CHECKPOINT_FILE = "pipeline-checkpoint.json";

/** 主題標題正規化為 checkpoint key */
function topicFingerprint(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "-")
    .replace(/[^\w\-]/g, "")
    .slice(0, 60);
}

/** 載入 checkpoint，不存在或格式錯誤時回傳空結構 */
export function loadCheckpoint(outputDir: string): PipelineCheckpoint {
  const filePath = path.join(outputDir, CHECKPOINT_FILE);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as PipelineCheckpoint;
      if (data.version === "1" && Array.isArray(data.topics)) {
        return data;
      }
    }
  } catch {
    // 損毀的 checkpoint 視為空白
  }
  return { version: "1", updated_at: new Date().toISOString(), topics: [] };
}

/** 儲存 checkpoint */
export function saveCheckpoint(outputDir: string, checkpoint: PipelineCheckpoint): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  checkpoint.updated_at = new Date().toISOString();
  const filePath = path.join(outputDir, CHECKPOINT_FILE);
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), "utf-8");
}

/** 取得特定主題的 checkpoint 條目（找不到回傳 undefined） */
export function getTopicCheckpoint(
  checkpoint: PipelineCheckpoint,
  title: string
): CheckpointTopic | undefined {
  const fp = topicFingerprint(title);
  return checkpoint.topics.find((t) => t.fingerprint === fp);
}

/** 新增或更新特定主題的 checkpoint 條目 */
export function upsertTopicCheckpoint(
  checkpoint: PipelineCheckpoint,
  title: string,
  update: Partial<Omit<CheckpointTopic, "fingerprint" | "title">>
): void {
  const fp = topicFingerprint(title);
  const idx = checkpoint.topics.findIndex((t) => t.fingerprint === fp);
  const now = new Date().toISOString();
  if (idx >= 0) {
    checkpoint.topics[idx] = {
      ...checkpoint.topics[idx],
      ...update,
      updated_at: now,
    };
  } else {
    checkpoint.topics.push({
      fingerprint: fp,
      title,
      updated_at: now,
      ...update,
    });
  }
}
