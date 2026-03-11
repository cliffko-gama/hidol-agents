/**
 * Agent B — 趨勢研究（Trend Research）
 *
 * 兩段式研究策略：
 *   Phase 1：從 Moment 自身萃取「話題性信號」（關鍵字、粉絲行為、情感主題）
 *   Phase 2：以信號驅動外部社群搜尋，找到能豐富文章的外部脈絡
 *
 * 工具：web_search_20250305（Anthropic 內建，server-side 執行）
 */

import type { AgentBInput, AgentBOutput } from "../types/agents.js";
import { AGENT_B_SYSTEM_PROMPT } from "../prompts/agent-b.js";
import { callAgentAgentic, extractJSON } from "../lib/call-agent.js";
import { PROVIDER_QUALITY_MODEL, type Provider } from "../lib/client.js";

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
};

export async function runAgentB(input: AgentBInput, provider: Provider = "anthropic"): Promise<AgentBOutput> {
  const momentCount = input.moments_summary?.count ?? input.topic.moment_ids.length;
  const isContentThin = input.topic.richness === "low" || momentCount < 5;
  const baseRounds = input.research_config?.max_search_rounds ?? 3;
  // 素材稀薄時多搜幾輪；但最多 5 輪，避免超 token
  const maxSearchRounds = Math.min(isContentThin ? baseRounds + 2 : baseRounds, 5);

  console.log(
    `[Agent B] 研究主題「${input.topic.title}」` +
    ` (richness=${input.topic.richness}, moments=${momentCount}, maxRounds=${maxSearchRounds})`
  );

  // ── Phase 1 提示：Moment 話題信號區塊 ───────────────────────
  const topMomentsSection = input.moments_summary?.top_moments?.length
    ? `
互動最高的 Moment（依 likes 排序）：
${input.moments_summary.top_moments.map((m, i) =>
  `[${i + 1}] ${m.engagement_likes} 讚 | ${m.has_media ? "有圖/影片" : "純文字"} | "${m.text.slice(0, 120)}${m.text.length > 120 ? "…" : ""}"`
).join("\n")}`.trim()
    : "";

  const sampleSection = input.moments_summary?.sample_texts?.length
    ? `
代表性 Moment 文字（最多 5 則）：
${input.moments_summary.sample_texts.map((t, i) => `[${i + 1}] ${t.slice(0, 100)}${t.length > 100 ? "…" : ""}`).join("\n")}`.trim()
    : "";

  const momentDataSection = [topMomentsSection, sampleSection].filter(Boolean).join("\n\n");

  // ── 搜尋策略提示 ───────────────────────────────────────────
  const thinContentNote = isContentThin
    ? `\n⚠️ 素材偏稀薄（${momentCount} 則 Moment）：請執行更深入的外部搜尋，讓 context_summary 即使 Moment 少也有充分脈絡。`
    : "";

  const userMessage = `
## 研究任務

主題：${input.topic.title}
描述：${input.topic.description}
關鍵字：${input.topic.keywords.join("、")}
建議敘事角度：${input.topic.suggested_narrative}
素材豐富度：${input.topic.richness}（${momentCount} 則 Moment）${thinContentNote}

---

## Moment 素材（用於 moment_trend_signals 分析）

${momentDataSection || `（素材摘要：${input.topic.richness} 豐富度，${momentCount} 則）`}

> 請從以上 Moment 素材中萃取關鍵字、粉絲行為、情感主題、話題性因子，
> 填入最終 JSON 的 moment_trend_signals 欄位。
> **不要先輸出分析文字，直接開始呼叫 web_search 工具。**

---

## 搜尋指引（請依序執行）

1. 核心搜尋：「${input.topic.keywords.slice(0, 2).join(" ")} 粉絲 2025」
2. 社群聲量：「${input.topic.keywords[0]} Dcard」或「${input.topic.keywords[0]} PTT 討論」
3. 文化背景：搜尋這類粉絲行為的更廣趨勢（例：台灣偶像見面會文化、粉絲應援文化）
4. 延伸脈絡：搜尋類似事件或現象，讓文章有「普遍共鳴」

搜尋語言優先順序：${input.research_config?.languages?.join("、") ?? "繁體中文、英文"}

---

⚠️ 完成所有搜尋後，直接輸出 JSON（從 { 開頭，不要任何前置文字）。
`.trim();

  const response = await callAgentAgentic({
    model: PROVIDER_QUALITY_MODEL[provider],
    systemPrompt: AGENT_B_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 6000,  // 縮小 max_tokens 降低 rate limit 壓力
    tools: [WEB_SEARCH_TOOL],
    maxRounds: maxSearchRounds + 4,
    provider,
  });

  const result = extractJSON<AgentBOutput>(response);

  // 過濾虛構 URL
  const originalCount = (result.web_trends ?? []).length;
  result.web_trends = (result.web_trends ?? []).filter(
    (t) => t.url && !t.url.includes("example.com") && t.url.startsWith("http")
  );
  const filtered = originalCount - result.web_trends.length;
  if (filtered > 0) {
    console.log(`[Agent B] ⚠️ 過濾掉 ${filtered} 個虛構 URL`);
  }

  // 確保必要欄位存在
  result.social_insights   = result.social_insights   ?? [];
  result.suggested_angles  = result.suggested_angles  ?? [];
  result.context_summary   = result.context_summary   ?? "";
  result.moment_trend_signals = result.moment_trend_signals ?? undefined;

  console.log(
    `[Agent B] ✅ 完成: ${result.web_trends.length} 篇趨勢文章, ` +
    `${result.social_insights.length} 則社群洞察, ` +
    `${result.moment_trend_signals?.keywords.length ?? 0} 個話題關鍵字`
  );

  return result;
}
