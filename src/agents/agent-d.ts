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
${input.research.research_failed ? `
> ⚠️ **研究階段失敗（Agent B 未能執行）**
> 本篇文章在無外部研究資料的條件下撰寫。
> **請將「來源合規」維度的評分標準放寬**：
> - referenced_sources 應為空陣列 []，這是正確的，不應扣分。
> - 文章若完全從 Moment 素材出發撰寫，符合要求，視同通過來源合規。
` : ""}
### 允許的 URL 清單（referenced_sources 只能使用這些）
${input.research.web_trends.length > 0
    ? input.research.web_trends.map((t, i) => `${i + 1}. [${t.source}] ${t.url}\n   標題: ${t.title}\n   摘要: ${t.summary}`).join("\n\n")
    : "_（本次研究無可引用的外部 URL）_"
}

### 社群洞察（無 URL，不應出現在 referenced_sources）
${input.research.social_insights.length > 0
    ? input.research.social_insights.map((s) => `- [${s.platform}] ${s.trend_description}`).join("\n")
    : "_（無社群洞察）_"
}

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

  // JSON retry: 如果解析失敗，自動重試最多 3 次
  const MAX_JSON_RETRIES = 3;
  let result: AgentDOutput | null = null;
  let lastError: Error | null = null;

  for (let retry = 0; retry <= MAX_JSON_RETRIES; retry++) {
    try {
      // 第 2 次起在 userMessage 尾端追加格式提醒，引導 LLM 輸出純 JSON
      const retryHint = retry > 0
        ? `\n\n⚠️ 注意：你上一次的輸出無法解析為 JSON。請確保輸出「純 JSON 物件」，不要包含 Markdown 程式碼區塊（\`\`\`）、前置說明文字或尾端評論。`
        : "";
      const response = await callAgent({
        model: QUALITY_MODEL,
        systemPrompt: AGENT_D_SYSTEM_PROMPT,
        userMessage: userMessage + retryHint,
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
