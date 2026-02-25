/**
 * Agent B — 趨勢研究（Trend Research）
 *
 * 使用 Anthropic 內建的 web_search_20250305 工具進行真實網路搜尋。
 * 當主題的 Moment 素材稀薄時，會增加搜尋深度以補充外部脈絡。
 */

import type { AgentBInput, AgentBOutput } from "../types/agents.js";
import { AGENT_B_SYSTEM_PROMPT } from "../prompts/agent-b.js";
import { callAgentAgentic, extractJSON } from "../lib/call-agent.js";
import { QUALITY_MODEL } from "../lib/client.js";

/**
 * Anthropic 內建的 web search 工具。
 * 實際搜尋由 Anthropic 伺服器端執行，client 只需掛載此工具並處理 tool_use 迴圈。
 */
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
};

export async function runAgentB(input: AgentBInput): Promise<AgentBOutput> {
  const momentCount = input.moments_summary?.count ?? input.topic.moment_ids.length;
  const isContentThin = input.topic.richness === "low" || momentCount < 6;
  const baseRounds = input.research_config?.max_search_rounds ?? 3;
  const maxSearchRounds = isContentThin ? baseRounds + 3 : baseRounds;

  console.log(
    `[Agent B] 研究主題「${input.topic.title}」` +
    ` (richness=${input.topic.richness}, moments=${momentCount}, maxRounds=${maxSearchRounds})`
  );

  // 組裝 moments 摘要段落（提供給 LLM 判斷素材豐富度）
  const momentsSummarySection = input.moments_summary
    ? `
素材豐富度評估：
- Moment 數量: ${input.moments_summary.count} 則
- 平均文字長度: ${input.moments_summary.avg_text_length} 字
- 主題豐富度自評: ${input.topic.richness}
${isContentThin ? "⚠️ 素材偏稀薄，請加強外部搜尋以補充背景脈絡，讓後續撰稿有足夠資料。" : ""}

現有 Moment 代表性文字（供了解素材語境，最多 5 則）：
${input.moments_summary.sample_texts.map((t, i) => `[${i + 1}] ${t.slice(0, 120)}${t.length > 120 ? "…" : ""}`).join("\n")}
`.trim()
    : `素材豐富度：${input.topic.richness}（Moment 數量：${momentCount} 則）`;

  const userMessage = `
請針對以下主題進行趨勢研究，使用 web_search 工具搜尋相關資訊。

主題資訊：
- 標題: ${input.topic.title}
- 描述: ${input.topic.description}
- 關鍵字: ${input.topic.keywords.join(", ")}
- 建議敘事角度: ${input.topic.suggested_narrative}

${momentsSummarySection}

研究設定：
- 搜尋語言優先順序: ${input.research_config?.languages?.join(", ") ?? "zh-TW, en"}
- 優先關注平台: ${input.research_config?.focus_platforms?.join(", ") ?? "Dcard, PTT, Instagram, X/Twitter, YouTube"}
${isContentThin ? `
⚠️ 素材稀薄模式（Moment 少於 6 則或豐富度為 low）：
請執行 **更深入** 的搜尋，補充後續撰稿所需的外部脈絡：
1. 搜尋此藝人/主題近期的粉絲活動新聞與官方公告
2. 搜尋「${input.topic.keywords[0]} 粉絲 心得 討論」於 Dcard / PTT / 各社群平台的反應
3. 搜尋此類型粉絲互動文化（見面會、抽籤活動等）的趨勢報導
4. 搜尋可以補充文章深度的相關文化背景資訊
目標：提供足夠豐富的 context_summary，讓文章即使 Moment 少也有深度和廣度。
` : ""}

搜尋策略（依序執行）：
1. 核心搜尋：用主要 keywords 搜尋最新相關新聞和文章
2. 社群聲量搜尋：搜尋「${input.topic.keywords[0]} 粉絲 討論」了解網路討論動態
3. 趨勢脈絡搜尋：搜尋此現象的更廣背景趨勢（例如「台灣偶像粉絲見面會文化」）
4. 若主題涉及國際藝人：用英文、日文或韓文補搜一輪

完成搜尋後，輸出研究結果的 JSON。

⚠️ 重要規則：
- web_trends 中的 url 只能放搜尋到的真實 URL，不能使用 example.com 或任何虛構 URL
- 若搜尋不到有效外部來源，請將 web_trends 保持為空陣列 []
- 把所有重要資訊放入 context_summary 和 social_insights（這是最重要的輸出）
- context_summary 要寫得豐富具體（300-500 字），讓撰稿者有足夠的素材使用
`.trim();

  const response = await callAgentAgentic({
    model: QUALITY_MODEL,
    systemPrompt: AGENT_B_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 8192,
    tools: [WEB_SEARCH_TOOL],
    maxRounds: maxSearchRounds + 5, // 給 tool_use 輪次額外的緩衝空間
  });

  const result = extractJSON<AgentBOutput>(response);

  // 安全防護：過濾掉明顯虛構的 URL
  const originalTrendCount = (result.web_trends ?? []).length;
  result.web_trends = (result.web_trends ?? []).filter(
    (t) => t.url && !t.url.includes("example.com") && t.url.startsWith("http")
  );
  const filteredCount = originalTrendCount - result.web_trends.length;
  if (filteredCount > 0) {
    console.log(`[Agent B] ⚠️ 過濾掉 ${filteredCount} 個虛構 URL（example.com 等）`);
  }

  // 確保必要欄位存在
  result.social_insights = result.social_insights ?? [];
  result.suggested_angles = result.suggested_angles ?? [];
  result.context_summary = result.context_summary ?? "";

  console.log(
    `[Agent B] 研究完成: ${result.web_trends.length} 則有效趨勢, ` +
    `${result.social_insights.length} 則社群洞察, ` +
    `${result.suggested_angles.length} 個建議角度`
  );

  return result;
}
