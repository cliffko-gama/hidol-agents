/**
 * Agent D — 品質審核（Quality Reviewer）
 */

import type {
  AgentDInput,
  AgentDOutput,
  FeatureStory,
  AgentBOutput,
  EditorialGuidelines,
} from "../types/agents.js";
import type { Moment } from "../types/moment.js";
import { AGENT_D_SYSTEM_PROMPT } from "../prompts/agent-d.js";
import { callAgent, extractJSON } from "../lib/call-agent.js";
import { QUALITY_MODEL } from "../lib/client.js";

export async function runAgentD(input: AgentDInput): Promise<AgentDOutput> {
  console.log(
    `[Agent D] 開始審核「${input.feature_story.title}」...`
  );

  const userMessage = `
## 待審 Feature Story

${JSON.stringify(input.feature_story, null, 2)}

## 原始 Moment 資料（用於事實核對）

${JSON.stringify(input.original_moments, null, 2)}

## 研究資料來源（用於來源合規檢查）

### 允許的 URL 清單（referenced_sources 只能使用這些）
${input.research.web_trends.map((t, i) => `${i + 1}. [${t.source}] ${t.url}\n   標題: ${t.title}\n   摘要: ${t.summary}`).join("\n\n")}

### 社群洞察（無 URL，不應出現在 referenced_sources）
${input.research.social_insights.map((s) => `- [${s.platform}] ${s.trend_description}`).join("\n")}

## 品牌調性指南

- 語氣: ${input.editorial_guidelines.tone}
- 目標讀者: ${input.editorial_guidelines.target_audience}
- Do's: ${input.editorial_guidelines.style_dos.join(" / ")}
- Don'ts: ${input.editorial_guidelines.style_donts.join(" / ")}
${
  input.editorial_guidelines.example_articles?.length
    ? `
## 📖 品質基準範例（以這些文章的水準作為評分參考）

> 評分時，請思考「這篇待審文章與範例相比，差距在哪？」

${input.editorial_guidelines.example_articles
  // Agent D 只取第一篇範例避免超 token
  .slice(0, 1)
  .map((article, i) => `### 範例 ${i + 1}\n\n${article}`)
  .join("\n\n---\n\n")}

---
`
    : ""
}
${input.lessons_context ? input.lessons_context + "\n---\n" : ""}

請進行五維度審核並輸出結果 JSON。
`;

  // JSON retry: 如果解析失敗，自動重試最多 1 次
  const MAX_JSON_RETRIES = 1;
  let result: AgentDOutput | null = null;
  let lastError: Error | null = null;

  for (let retry = 0; retry <= MAX_JSON_RETRIES; retry++) {
    try {
      const response = await callAgent({
        model: QUALITY_MODEL,
        systemPrompt: AGENT_D_SYSTEM_PROMPT,
        userMessage,
        maxTokens: 12000,
      });

      result = extractJSON<AgentDOutput>(response);
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (retry < MAX_JSON_RETRIES) {
        console.log(
          `[Agent D] ⚠️ JSON 解析失敗，自動重試 (${retry + 1}/${MAX_JSON_RETRIES})...`
        );
        console.log(`[Agent D] 錯誤: ${lastError.message.slice(0, 150)}`);
      }
    }
  }

  if (!result) {
    throw lastError ?? new Error("Agent D failed to produce valid JSON");
  }

  const statusEmoji = result.status === "approved" ? "✅" : "🔄";
  console.log(
    `[Agent D] 審核完成: ${statusEmoji} ${result.status} (${result.overall_score}/10)`
  );

  if (result.status === "needs_revision" && result.revision_instructions) {
    console.log(`[Agent D] 修改意見: ${result.revision_instructions.slice(0, 100)}...`);
  }

  return result;
}
