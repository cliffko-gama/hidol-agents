/**
 * Story History — 跨 run 的發佈歷史管理
 *
 * 功能：
 * 1. 持久化保存所有已發佈的 story metadata（跨 run 累積，存於 output/story-history.json）
 * 2. 提供冷卻機制查詢：最近 N 天內發佈過的主題標題
 *    → 傳給 Agent A2，避免短期內重複選題
 * 3. 超過冷卻期的主題自動解鎖，允許重訪同一題材
 */

import type { PublishedStoryMeta } from "../types/agents.js";
import fs from "fs";
import path from "path";

const STORY_HISTORY_FILENAME = "story-history.json";

export interface StoryHistory {
  /** 所有已發佈的 story（跨所有 run 累積） */
  stories: PublishedStoryMeta[];
  /** 累計執行次數（每次 run 結束後 +1） */
  total_runs: number;
  /** 最後更新時間 (ISO 8601) */
  last_updated: string;
}

/**
 * 從 outputDir 載入歷史記錄。
 * 若檔案不存在，回傳空歷史（首次執行）。
 */
export function loadStoryHistory(outputDir: string): StoryHistory {
  const filePath = path.join(outputDir, STORY_HISTORY_FILENAME);
  if (!fs.existsSync(filePath)) {
    return { stories: [], total_runs: 0, last_updated: new Date().toISOString() };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as StoryHistory;
  } catch {
    console.warn(`[StoryHistory] ⚠️ 無法解析 ${STORY_HISTORY_FILENAME}，使用空歷史`);
    return { stories: [], total_runs: 0, last_updated: new Date().toISOString() };
  }
}

/**
 * 將歷史記錄寫回 outputDir。
 */
export function saveStoryHistory(outputDir: string, history: StoryHistory): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, STORY_HISTORY_FILENAME);
  history.last_updated = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), "utf-8");
}

/**
 * 將本次新發佈的 stories 合併進歷史，並遞增 total_runs。
 * 以 story_id 去重，避免同一篇重複記錄。
 */
export function appendPublishedStories(
  history: StoryHistory,
  newStories: PublishedStoryMeta[]
): StoryHistory {
  const existingIds = new Set(history.stories.map((s) => s.story_id));
  const toAdd = newStories.filter((s) => !existingIds.has(s.story_id));
  return {
    stories: [...history.stories, ...toAdd],
    total_runs: history.total_runs + 1,
    last_updated: history.last_updated,
  };
}

/**
 * 取得「冷卻期內」已發佈的主題標題，用於傳給 Agent A2 做去重。
 *
 * @param cooldownDays 冷卻天數（例如 60）。
 *   - 最近 N 天內發佈的主題 → 列入禁止重複清單
 *   - 超過 N 天的主題 → 不再限制，允許重訪同一題材
 */
export function getRecentStoryTitles(
  history: StoryHistory,
  cooldownDays: number
): string[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cooldownDays);
  return history.stories
    .filter((s) => new Date(s.published_at) >= cutoff)
    .map((s) => s.title);
}
