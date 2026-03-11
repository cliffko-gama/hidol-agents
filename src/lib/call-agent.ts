/**
 * Shared utility for calling an agent (Anthropic / Gemini with structured output)
 *
 * callAgent()        — 單次呼叫（所有 agent 適用）
 * callAgentAgentic() — 工具迴圈呼叫（Agent B 的搜尋適用）
 *
 * 兩個函式皆透過 provider 欄位選擇後端：
 *   provider: "anthropic" (預設) — 使用 Anthropic SDK + Claude
 *   provider: "gemini"           — 使用 Google Generative AI SDK + Gemini
 *
 * Agent B 使用 web search 時的行為差異：
 *   Anthropic: web_search_20250305 工具（server-side 執行，需 tool_use 迴圈）
 *   Gemini:    googleSearch grounding（自動執行，一次呼叫即回傳結果）
 */

import Anthropic from "@anthropic-ai/sdk";
import { getClient, getGeminiClient, type Provider } from "./client.js";
import { tokenTracker } from "./token-tracker.js";

/**
 * 自動重試包裝器：處理 429 Rate Limit 及 529 overloaded 暫時性錯誤
 *
 * - 529 (overloaded)：指數退避 5s → 15s → 45s
 * - 429 (rate_limit)：較長退避 30s → 60s → 120s（等待 TPM 視窗恢復）
 * - 最多重試 3 次（maxRetries 可覆寫）
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3
): Promise<T> {
  const overloadedDelays = [5_000, 15_000, 45_000];
  const rateLimitDelays = [30_000, 60_000, 120_000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const errObj = err as { status?: number; error?: { type?: string } };

      const isOverloaded =
        (err instanceof Error &&
          (err.message.includes("overloaded") ||
           err.message.includes("529") ||
           errObj.status === 529)) ||
        errObj.error?.type === "overloaded_error";

      const isRateLimited =
        err instanceof Error &&
        (err.message.includes("rate_limit") ||
         err.message.includes("429") ||
         errObj.status === 429);

      if ((isOverloaded || isRateLimited) && attempt < maxRetries) {
        const delays = isRateLimited ? rateLimitDelays : overloadedDelays;
        const waitMs = delays[attempt] ?? delays[delays.length - 1];
        const reason = isRateLimited ? "rate limited (429)" : "overloaded (529)";
        console.warn(
          `[Retry] ${label} → ${reason}，等待 ${waitMs / 1000}s 後重試 (${attempt + 1}/${maxRetries})...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
  // TypeScript 要求：實際上不會跑到這裡
  throw new Error(`[Retry] ${label} 超過重試上限`);
}

export interface AgentCallOptions {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  tools?: Anthropic.Messages.Tool[];
  /** 使用的 provider，預設為 "anthropic" */
  provider?: Provider;
}

export interface AgentAgenticOptions {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  /** 要掛載的工具（支援 web_search_20250305 等 built-in 工具） */
  tools?: unknown[];
  /** 最多執行幾輪 tool_use → tool_result 迴圈，預設 12（Gemini 自動搜尋，此參數忽略） */
  maxRounds?: number;
  /** 使用的 provider，預設為 "anthropic" */
  provider?: Provider;
}

/**
 * Call an AI model with a system prompt and user message, returning the raw text response.
 * Dispatches to Anthropic or Gemini based on options.provider (default: "anthropic").
 */
export async function callAgent(options: AgentCallOptions): Promise<string> {
  if (options.provider === "gemini") {
    return callAgentGemini(options);
  }
  return callAgentAnthropic(options);
}

async function callAgentAnthropic(options: AgentCallOptions): Promise<string> {
  const client = getClient();
  const { model, systemPrompt, userMessage, maxTokens = 8192, tools } = options;

  // Use streaming with finalMessage() to avoid timeouts on large responses
  const response = await withRetry(async () => {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      ...(tools ? { tools } : {}),
    });
    return stream.finalMessage();
  }, `callAgent(${model})`);

  if (response.usage) {
    tokenTracker.record(
      `callAgent(${model.split("-").slice(-2).join("-")})`,
      response.usage.input_tokens,
      response.usage.output_tokens,
      model
    );
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.Messages.TextBlock => block.type === "text"
  );

  if (!textBlock) {
    throw new Error(
      `Agent returned no text content. Stop reason: ${response.stop_reason}`
    );
  }

  return textBlock.text;
}

async function callAgentGemini(options: AgentCallOptions): Promise<string> {
  const { model, systemPrompt, userMessage, maxTokens = 8192 } = options;
  const client = getGeminiClient();

  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: maxTokens },
  });

  const result = await genModel.generateContent(userMessage);
  const text = result.response.text();
  const usage = result.response.usageMetadata;

  if (usage) {
    tokenTracker.record(
      `callAgent(${model.split("-").slice(-2).join("-")})`,
      usage.promptTokenCount ?? 0,
      usage.candidatesTokenCount ?? 0,
      model
    );
  }

  return text;
}

/**
 * Runs an agent in an agentic loop with tool support.
 *
 * Anthropic: web_search_20250305 工具，需 tool_use → tool_result 多輪迴圈
 * Gemini:    googleSearch grounding，單次呼叫自動搜尋並回傳結果
 */
export async function callAgentAgentic(
  options: AgentAgenticOptions
): Promise<string> {
  if (options.provider === "gemini") {
    return callAgentAgenticGemini(options);
  }
  return callAgentAgenticAnthropic(options);
}

async function callAgentAgenticGemini(options: AgentAgenticOptions): Promise<string> {
  const { model, systemPrompt, userMessage, maxTokens = 8192, tools = [] } = options;
  const client = getGeminiClient();

  // 若 tools 包含 web_search 工具，啟用 Google Search grounding
  const hasSearch = tools.some(
    (t: unknown) =>
      (t as Record<string, unknown>)?.type === "web_search_20250305" ||
      (t as Record<string, unknown>)?.googleSearch !== undefined
  );

  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: maxTokens },
    ...(hasSearch ? { tools: [{ googleSearchRetrieval: {} }] } : {}),
  });

  const result = await genModel.generateContent(userMessage);
  const text = result.response.text();
  const usage = result.response.usageMetadata;

  if (usage) {
    tokenTracker.record(
      `callAgentAgentic(${model.split("-").slice(-2).join("-")})`,
      usage.promptTokenCount ?? 0,
      usage.candidatesTokenCount ?? 0,
      model
    );
  }

  return text;
}

async function callAgentAgenticAnthropic(
  options: AgentAgenticOptions
): Promise<string> {
  const client = getClient();
  const {
    model,
    systemPrompt,
    userMessage,
    maxTokens = 8192,
    tools = [],
    maxRounds = 12,
  } = options;

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    // Wrap each round with retry to handle transient overloaded_error (529)
    const response = await withRetry(
      () =>
        (client.messages.create as Function)({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          ...(tools.length > 0 ? { tools } : {}),
          messages,
        }) as Promise<Anthropic.Messages.Message>,
      `callAgentAgentic(${model}) round=${round + 1}`
    );

    // Track token usage for this round
    if (response.usage) {
      tokenTracker.record(
        `callAgentAgentic(${model.split("-").slice(-2).join("-")})`,
        response.usage.input_tokens,
        response.usage.output_tokens,
        model
      );
    }

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(
        (b): b is Anthropic.Messages.TextBlock => b.type === "text"
      );
      if (!textBlock) {
        throw new Error(
          `[callAgentAgentic] Round ${round + 1}: end_turn but no text block. ` +
          `Content types: ${response.content.map((b) => b.type).join(", ")}`
        );
      }
      return textBlock.text;
    }

    if (response.stop_reason === "tool_use") {
      // Append assistant turn to history
      messages.push({ role: "assistant", content: response.content });

      // Build tool_result blocks for each tool_use request.
      // For server-side tools (web_search_20250305), Anthropic handles execution;
      // we pass back empty content to continue the loop.
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = toolUseBlocks.map(
        (block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: "",
        })
      );

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // max_tokens or unexpected stop — try to salvage partial text
    const partialText = response.content.find(
      (b): b is Anthropic.Messages.TextBlock => b.type === "text"
    );
    if (partialText?.text) {
      console.warn(
        `[callAgentAgentic] Unexpected stop_reason="${response.stop_reason}" in round ${round + 1}, returning partial text`
      );
      return partialText.text;
    }

    throw new Error(
      `[callAgentAgentic] stop_reason="${response.stop_reason}" with no usable text in round ${round + 1}`
    );
  }

  throw new Error(
    `[callAgentAgentic] Exceeded maxRounds=${maxRounds} without reaching end_turn`
  );
}

/**
 * Extract JSON from a response that may contain markdown code fences.
 * Includes robust repair for common LLM JSON output issues.
 */
export function extractJSON<T>(text: string): T {
  // Try to extract JSON from code fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Attempt 1: Direct parse
  try {
    return JSON.parse(jsonStr) as T;
  } catch (_) {
    // continue to repair
  }

  // Attempt 2: Find JSON start and parse
  const startIdx = Math.min(
    jsonStr.indexOf("{") === -1 ? Infinity : jsonStr.indexOf("{"),
    jsonStr.indexOf("[") === -1 ? Infinity : jsonStr.indexOf("[")
  );

  if (startIdx === Infinity) {
    throw new Error(
      `Failed to find JSON in agent response: ${text.slice(0, 200)}...`
    );
  }

  const cleaned = jsonStr.slice(startIdx);

  try {
    return JSON.parse(cleaned) as T;
  } catch (_) {
    // continue to repair
  }

  // Attempt 3: Repair truncated/malformed JSON
  console.log(`[JSON Repair] 嘗試修復 JSON (${cleaned.length} chars)...`);
  const repaired = repairJSON(cleaned);
  try {
    const result = JSON.parse(repaired) as T;
    console.log(`[JSON Repair] ✅ 修復成功`);
    return result;
  } catch (finalErr) {
    throw new Error(
      `Failed to parse JSON even after repair. ` +
        `Error: ${finalErr instanceof Error ? finalErr.message : String(finalErr)}\n` +
        `First 500 chars: ${cleaned.slice(0, 500)}...`
    );
  }
}

/**
 * Attempt to repair common JSON issues from LLM output:
 * - Unterminated strings (e.g., revision_instructions with Markdown)
 * - Missing closing brackets/braces (truncated output)
 * - Trailing commas
 * - Control characters inside strings
 */
function repairJSON(json: string): string {
  let repaired = json;

  // Step 1: Remove control characters that break JSON (keep \n \r \t)
  repaired = repaired.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

  // Step 2: Fix unterminated strings by tracking quote state
  let inString = false;
  let escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; }
  }

  // If we ended inside a string, close it
  if (inString) {
    repaired += '"';
  }

  // Step 3: Remove trailing commas before } or ]
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  // Step 4: Balance brackets and braces (inner arrays first, then objects)
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += "]";
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += "}";
  }

  return repaired;
}
