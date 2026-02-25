/**
 * Agent E — 發佈排版（Publisher）
 */

import type { AgentEInput, AgentEOutput } from "../types/agents.js";
import { AGENT_E_SYSTEM_PROMPT } from "../prompts/agent-e.js";
import { callAgent, extractJSON } from "../lib/call-agent.js";
import { FAST_MODEL } from "../lib/client.js";

export async function runAgentE(input: AgentEInput): Promise<AgentEOutput> {
  console.log(`[Agent E] 開始生成網站資料...`);

  const userMessage = `
## 已通過審核的 Feature Story

${JSON.stringify(input.feature_story, null, 2)}

## 對應的 Moment 資料（需要媒體 URL）

${JSON.stringify(input.moments, null, 2)}

## 網站設定

- 網站根目錄: ${input.site_config.site_root}
- Story URL 前綴: ${input.site_config.story_url_prefix}
- 模板風格: ${input.site_config.template_style}

## 已發佈的專題

${input.existing_stories?.length ? JSON.stringify(input.existing_stories, null, 2) : "（目前沒有已發佈的專題）"}

## 當前時間

${new Date().toISOString()}

---

請將 Feature Story 轉換成網站 JSON 資料並輸出結果。
`;

  const response = await callAgent({
    model: FAST_MODEL,
    systemPrompt: AGENT_E_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 16000,
  });

  const result = extractJSON<AgentEOutput>(response);

  console.log(
    `[Agent E] 生成完成: ${result.generated_files.length} 個檔案`
  );
  for (const file of result.generated_files) {
    console.log(`  - [${file.action}] ${file.path}`);
  }

  return result;
}
