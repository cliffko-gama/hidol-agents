/**
 * Agent A2 — 主題分析（Topic Clustering）
 */

import type { AgentA2Input, AgentA2Output } from "../types/agents.js";
import { AGENT_A2_SYSTEM_PROMPT } from "../prompts/agent-a2.js";
import { callAgent, extractJSON } from "../lib/call-agent.js";
import { QUALITY_MODEL } from "../lib/client.js";

export async function runAgentA2(input: AgentA2Input): Promise<AgentA2Output> {
  console.log(
    `[Agent A2] 開始分析 ${input.filtered_moments.length} 則 Moment 的主題...`
  );

  const userMessage = `
以下是已篩選過的 Moment 資料，請從中發現可以組成 Feature Story 的主題。

設定：
- 最多產出 ${input.max_topics ?? 3} 個主題
${input.existing_topic_titles?.length ? `- 已發佈過的主題（避免重複）: ${input.existing_topic_titles.join(", ")}` : ""}

Moment 資料：
${JSON.stringify(input.filtered_moments, null, 2)}

請輸出主題分析結果的 JSON。
`;

  const response = await callAgent({
    model: QUALITY_MODEL,
    systemPrompt: AGENT_A2_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 8192,
  });

  const result = extractJSON<AgentA2Output>(response);

  console.log(
    `[Agent A2] 分析完成: 發現 ${result.topics.length} 個主題`
  );
  for (const topic of result.topics) {
    console.log(
      `  - [${topic.richness}] ${topic.title} (${topic.moment_ids.length} 則 Moment)`
    );
  }

  return result;
}
