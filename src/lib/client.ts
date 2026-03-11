/**
 * AI Provider Clients
 *
 * 支援雙軌 Provider：Anthropic (Claude) 與 Google (Gemini)
 * 每個 agent 可獨立設定使用哪個 provider。
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Provider 型別 ──────────────────────────────────────────────
export type Provider = "anthropic" | "gemini";

// ── Anthropic Client ───────────────────────────────────────────
let _anthropicClient: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_anthropicClient) {
    _anthropicClient = new Anthropic();
  }
  return _anthropicClient;
}

// ── Gemini Client ──────────────────────────────────────────────
let _geminiClient: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  if (!_geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[Gemini] GEMINI_API_KEY 未設定。請在 .env 或 CI/CD 變數中加入 GEMINI_API_KEY。"
      );
    }
    _geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return _geminiClient;
}

// ── Anthropic 模型常數 ─────────────────────────────────────────
/** 成本優先（篩選、發佈等簡單任務） */
export const FAST_MODEL = "claude-haiku-4-5";
/** 品質優先（研究、撰寫、審核等複雜任務） */
export const QUALITY_MODEL = "claude-sonnet-4-5";
/** 預設模型 */
export const DEFAULT_MODEL = "claude-sonnet-4-5";

// ── Gemini 模型常數 ────────────────────────────────────────────
/** Gemini 成本優先（對應 Haiku 的定位） */
export const GEMINI_FAST_MODEL = "gemini-2.0-flash";
/** Gemini 品質優先（對應 Sonnet 的定位） */
export const GEMINI_QUALITY_MODEL = "gemini-2.5-pro";

// ── Provider 對應的預設模型 ────────────────────────────────────
export const PROVIDER_FAST_MODEL: Record<Provider, string> = {
  anthropic: FAST_MODEL,
  gemini: GEMINI_FAST_MODEL,
};

export const PROVIDER_QUALITY_MODEL: Record<Provider, string> = {
  anthropic: QUALITY_MODEL,
  gemini: GEMINI_QUALITY_MODEL,
};
