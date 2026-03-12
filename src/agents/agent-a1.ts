/**
 * Agent A1 — Moment 篩選（Content Filter）
 */

import type { Moment } from "../types/moment.js";
import type { AgentA1Input, AgentA1Output } from "../types/agents.js";
import { AGENT_A1_SYSTEM_PROMPT } from "../prompts/agent-a1.js";
import { callAgent, extractJSON } from "../lib/call-agent.js";
import { PROVIDER_FAST_MODEL, type Provider } from "../lib/client.js";

/** Agent A1 LLM 只輸出 ID 列表，避免輸出巨大的 Moment 物件 */
interface AgentA1LLMOutput {
  filtered_moment_ids: string[];
  rejection_log: AgentA1Output["rejection_log"];
  stats: AgentA1Output["stats"];
}

export async function runAgentA1(input: AgentA1Input, provider: Provider = "anthropic"): Promise<AgentA1Output> {
  console.log(`[Agent A1] 開始篩選 ${input.moments.length} 則 Moment...`);

  // 傳給 LLM 的是「輕量摘要」，不含完整媒體物件（避免 input/output token 爆炸）
  const momentSummaries = input.moments.map((m) => ({
    id: m.id,
    user_display_name: m.user_display_name,
    type: m.type,
    text_content: m.text_content,
    has_media: m.media.length > 0,
    media_count: m.media.length,
    hashtags: m.hashtags,
    created_at: m.created_at,
    engagement: m.engagement,
    engagement_total:
      m.engagement.likes + m.engagement.comments + m.engagement.shares,
  }));

  const userMessage = `
以下是需要篩選的 Moment 資料（輕量摘要格式，不含媒體 URL）：

篩選設定：
- 最少文字字數: ${input.filter_config.min_text_length}
- 最少互動數 (likes + comments + shares): ${input.filter_config.min_engagement}
${input.filter_config.since ? `- 時間範圍: ${input.filter_config.since} 之後` : ""}
${input.filter_config.excluded_hashtags?.length ? `- 排除的 hashtag: ${input.filter_config.excluded_hashtags.join(", ")}` : ""}

Moment 資料（共 ${momentSummaries.length} 則）：
${JSON.stringify(momentSummaries, null, 2)}

請根據篩選原則和設定，輸出篩選結果的 JSON。
記住：filtered_moment_ids 只需列出通過的 Moment ID（字串），不需要輸出完整物件。
`;

  const response = await callAgent({
    model: PROVIDER_FAST_MODEL[provider],
    systemPrompt: AGENT_A1_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 16384,
    provider,
    // 篩選是簡單判斷任務，不需要深度思考；避免 Gemini thinking 佔用 output 預算
    thinkingBudget: 0,
  });

  // 解析 LLM 輸出（只含 ID）
  const llmResult = extractJSON<AgentA1LLMOutput>(response);

  // 重建完整的 AgentA1Output（用 ID 從原始資料中查找完整 Moment）
  const momentById = new Map(input.moments.map((m) => [m.id, m]));
  const filteredIds = new Set(llmResult.filtered_moment_ids ?? []);
  const filteredMoments = [...filteredIds]
    .map((id) => momentById.get(id))
    .filter((m): m is Moment => m !== undefined);

  const result: AgentA1Output = {
    filtered_moments: filteredMoments,
    rejection_log: llmResult.rejection_log ?? [],
    stats: {
      total_input: input.moments.length,
      total_passed: filteredMoments.length,
      total_rejected: input.moments.length - filteredMoments.length,
    },
  };

  console.log(
    `[Agent A1] 篩選完成: ${result.stats.total_passed}/${result.stats.total_input} 通過`
  );

  return result;
}
