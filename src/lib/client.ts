/**
 * Shared Anthropic client instance
 */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

/** Default model for all agents */
export const DEFAULT_MODEL = "claude-sonnet-4-5";

/** Cost-effective model for simpler tasks (filtering, publishing) */
export const FAST_MODEL = "claude-haiku-4-5";

/** High-quality model for creative and complex tasks */
export const QUALITY_MODEL = "claude-sonnet-4-5";
