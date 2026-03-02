/**
 * Shared utility for calling an agent (Claude API with structured output)
 */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./client.js";

/**
 * 自動重試包裝器：處理 overloaded_error 與 529 暫時性錯誤
 * 使用指數退避（5s → 15s → 45s），最多重試 3 次
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3
): Promise<T> {
  const delays = [5_000, 15_000, 45_000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isOverloaded =
        (err instanceof Error &&
          (err.message.includes("overloaded") ||
           err.message.includes("529") ||
           (err as { status?: number }).status === 529)) ||
        (typeof err === "object" &&
          err !== null &&
          (err as { error?: { type?: string } }).error?.type === "overloaded_error");

      if (isOverloaded && attempt < maxRetries) {
        const waitMs = delays[attempt] ?? 45_000;
        console.warn(
          `[Retry] ${label} → overloaded，${waitMs / 1000}s 後重試 (${attempt + 1}/${maxRetries})...`
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
}

export interface AgentAgenticOptions {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  /** 要掛載的工具（支援 web_search_20250305 等 built-in 工具） */
  tools?: unknown[];
  /** 最多執行幾輪 tool_use → tool_result 迴圈，預設 12 */
  maxRounds?: number;
}

/**
 * Call Claude with a system prompt and user message, returning the raw text response.
 * For structured output, the caller should parse the JSON from the response.
 */
export async function callAgent(options: AgentCallOptions): Promise<string> {
  const client = getClient();
  const { model, systemPrompt, userMessage, maxTokens = 8192, tools } = options;

  // Use streaming with finalMessage() to avoid timeouts on large responses
  // Wrap with retry to handle transient overloaded_error (529)
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

  // Extract text from response
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

/**
 * Runs an agent in an agentic loop, supporting multi-turn tool use.
 *
 * Suitable for agents that may use built-in tools like web_search_20250305.
 * The loop continues until Claude returns stop_reason="end_turn" or maxRounds is reached.
 *
 * For Anthropic's server-side tools (e.g. web_search_20250305), the actual
 * tool execution is handled by Anthropic's infrastructure — the client only
 * needs to return empty tool_result blocks to keep the conversation going.
 */
export async function callAgentAgentic(
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
