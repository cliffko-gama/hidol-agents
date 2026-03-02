/**
 * Agent C — 內容撰寫（Content Writer）
 */

import type { Moment } from "../types/moment.js";
import type {
  AgentCInput,
  AgentCOutput,
  AgentBOutput,
  EditorialGuidelines,
  Topic,
} from "../types/agents.js";
import { AGENT_C_SYSTEM_PROMPT } from "../prompts/agent-c.js";
import { callAgent, extractJSON } from "../lib/call-agent.js";
import { QUALITY_MODEL } from "../lib/client.js";

export async function runAgentC(input: AgentCInput): Promise<AgentCOutput> {
  const isRevision = input.attempt_number > 1;
  console.log(
    `[Agent C] ${isRevision ? `第 ${input.attempt_number} 次修改` : "開始撰寫"}「${input.topic.title}」...`
  );

  // 建構「允許的來源清單」——明確列出 URL，方便 Agent C 直接複製使用
  const allowedUrls = new Set(input.research.web_trends.map((t) => t.url));
  const allowedSourcesList = input.research.web_trends
    .map((t, i) => `${i + 1}. 來源名稱: ${t.source}\n   URL: ${t.url}\n   標題: ${t.title}\n   摘要: ${t.summary}`)
    .join("\n\n");

  // 當 web_trends 為空時，顯示明確警告（避免 Agent C 捏造 URL）
  const allowedSourcesBlock = allowedUrls.size > 0
    ? `## ⚠️ 允許引用的外部來源（只能用這些，不能自己編）

以下是 research 階段找到的所有來源。你的 referenced_sources 只能從這些 URL 中選用。
提及媒體時，使用下方列出的「來源名稱」。引用數據時，只能引用下方「摘要」中出現的數據。

${allowedSourcesList}

社群洞察（可用來補充觀點，但無 URL）：
${input.research.social_insights.map((s) => `- [${s.platform}] ${s.trend_description}`).join("\n")}`
    : `## ⚠️ 本次研究無可引用的外部來源

**Agent B 本次未找到任何外部文章。referenced_sources 必須為空陣列 []。**

你可以用「社群上有人觀察到...」「Dcard 上有粉絲分享...」等方式描述社群趨勢，
但**絕對不可以引用任何 URL**，包括虛構的或你認為合理的 URL。

社群洞察（可用來補充觀點，但無 URL）：
${input.research.social_insights.map((s) => `- [${s.platform}] ${s.trend_description}`).join("\n")}`;

  // 建構「結構化 Moment 區塊」——每個 Moment 有獨立標籤，防止 Agent C 張冠李戴
  // 限制每個 Moment 的文字長度，避免單一請求超過 30k TPM 上限
  const TEXT_LIMIT = 250;
  const momentSections = input.moments
    .map((m) => {
      // 只取第一個媒體素材（減少 token）
      const mediaInfo =
        m.media.length > 0
          ? `  • [media_index: 0] 類型: ${m.media[0].type}` +
            (m.media[0].alt_text ? `，描述: ${m.media[0].alt_text.slice(0, 60)}` : "") +
            (m.media[0].url ? `，URL: ${m.media[0].url}` : "")
          : "  • （此 Moment 無媒體素材）";
      const text = m.text_content.length > TEXT_LIMIT
        ? m.text_content.slice(0, TEXT_LIMIT) + "…（略）"
        : m.text_content;
      return (
        `### [${m.id}] ${m.user_display_name} 的 Moment\n` +
        `- **Moment ID**: \`${m.id}\`\n` +
        `- **互動數據**: 👍 ${m.engagement.likes} 讚\n` +
        `- **原文**:\n` +
        `  > ${text.replace(/\n/g, "\n  > ")}\n` +
        `- **媒體**: ${mediaInfo}`
      );
    })
    .join("\n\n");

  // 建構 moment_trend_signals 區塊（Agent B 萃取的話題性信號）
  const signals = input.research.moment_trend_signals;
  const trendSignalsBlock = signals
    ? `## 🎯 話題性信號（Agent B 分析結果，請用來決定 Theme Spine）

**核心話題因子（trending_factor）**：
${signals.trending_factor}

**關鍵字**：${signals.keywords.join("、")}

**粉絲行為模式**：
${signals.fan_behaviors.map((b) => `- ${b}`).join("\n")}

**情感主題**：
${signals.emotional_themes.map((t) => `- ${t}`).join("\n")}

> ⚠️ 請以 trending_factor 和 emotional_themes 為核心，
> 選定你的 Theme Spine，並在 intro 的前 2 句就點出它。

`
    : "";

  const userMessage = `
${isRevision ? "## ⚠️ 修改模式\n\n這是第 " + input.attempt_number + " 次撰寫。請根據以下審稿意見進行修改：\n\n" + input.revision_feedback + "\n\n---\n" : ""}
${input.lessons_context ? input.lessons_context + "\n---\n" : ""}
${trendSignalsBlock}
## 主題資訊
- 標題: ${input.topic.title}
- 描述: ${input.topic.description}
- 建議的敘事角度: ${input.topic.suggested_narrative}

## 品牌調性指南
- 語氣: ${input.editorial_guidelines.tone}
- 目標讀者: ${input.editorial_guidelines.target_audience}
- Do's: ${input.editorial_guidelines.style_dos.join(" / ")}
- Don'ts: ${input.editorial_guidelines.style_donts.join(" / ")}
${
  input.editorial_guidelines.example_articles?.length
    ? `
## 📖 優質文章範例（請模仿這些文章的語氣、節奏和 Theme Spine 運用方式）

${input.editorial_guidelines.example_articles
  .map((article, i) => `### 範例 ${i + 1}\n\n${article}`)
  .join("\n\n---\n\n")}

---
`
    : ""
}
## Moment 素材（共 ${input.moments.length} 個）
⚠️ **重要：每個 Moment 有獨立的 ID 和用戶，引用時 moment_id 必須填寫對應區塊的 ID，不可將不同 Moment 的文字混用。**

${momentSections}

## 趨勢研究結果
${input.research.context_summary}

建議切入角度：
${input.research.suggested_angles.map((a, i) => `${i + 1}. ${a}`).join("\n")}

${allowedSourcesBlock}

---

請撰寫 Feature Story 並輸出 JSON 格式。
記住：referenced_sources 中的每個 URL 都必須完全來自上方「允許引用的外部來源」清單。若無來源，referenced_sources 必須為 []。
`;

  // JSON retry: 如果解析失敗，自動重試最多 1 次
  const MAX_JSON_RETRIES = 1;
  let result: AgentCOutput | null = null;
  let lastError: Error | null = null;

  for (let retry = 0; retry <= MAX_JSON_RETRIES; retry++) {
    try {
      const response = await callAgent({
        model: QUALITY_MODEL,
        systemPrompt: AGENT_C_SYSTEM_PROMPT,
        userMessage,
        maxTokens: 16000,
      });

      result = extractJSON<AgentCOutput>(response);
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (retry < MAX_JSON_RETRIES) {
        console.log(
          `[Agent C] ⚠️ JSON 解析失敗，自動重試 (${retry + 1}/${MAX_JSON_RETRIES})...`
        );
        console.log(`[Agent C] 錯誤: ${lastError.message.slice(0, 150)}`);
      }
    }
  }

  if (!result) {
    throw lastError ?? new Error("Agent C failed to produce valid JSON");
  }

  // ── 後處理：過濾掉不在 allowedUrls 中的 URL（防止 Agent C 捏造來源）──
  const originalSources = result.feature_story.referenced_sources ?? [];
  result.feature_story.referenced_sources = originalSources.filter((url) => allowedUrls.has(url));
  const removedCount = originalSources.length - result.feature_story.referenced_sources.length;
  if (removedCount > 0) {
    console.warn(`[Agent C] ⚠️ 過濾掉 ${removedCount} 個不允許的 URL（防止捏造來源）`);
  }

  console.log(
    `[Agent C] 撰寫完成: 「${result.feature_story.title}」(${result.feature_story.sections.length} sections, ~${result.feature_story.estimated_read_time} 分鐘)`
  );

  return result;
}
