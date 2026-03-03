/**
 * Token 成本追蹤器
 *
 * 以 module singleton 方式在整個 pipeline 執行過程中累計 API token 用量，
 * 並在結束後輸出成本摘要。
 *
 * 使用方式：
 *   import { tokenTracker } from "./token-tracker.js";
 *   tokenTracker.record("Agent C", inputTokens, outputTokens);
 *   tokenTracker.printSummary();
 *
 * 定價（claude-sonnet-4-5 / sonnet-4-6，2025 年）：
 *   Input : $3.00 / 1M tokens
 *   Output: $15.00 / 1M tokens
 * 參考：https://www.anthropic.com/pricing
 */

export interface TokenRecord {
  agent: string;
  input_tokens: number;
  output_tokens: number;
  calls: number;
}

// claude-sonnet-4-x 定價（USD per 1M tokens）
const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;

class TokenTracker {
  private records: Map<string, TokenRecord> = new Map();

  /** 記錄一次 API 呼叫的 token 用量 */
  record(agent: string, inputTokens: number, outputTokens: number): void {
    const existing = this.records.get(agent);
    if (existing) {
      existing.input_tokens += inputTokens;
      existing.output_tokens += outputTokens;
      existing.calls += 1;
    } else {
      this.records.set(agent, {
        agent,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        calls: 1,
      });
    }
  }

  /** 取得所有紀錄（用於寫入 JSON 等） */
  getRecords(): TokenRecord[] {
    return [...this.records.values()];
  }

  /** 重設（每次 pipeline run 開始時呼叫） */
  reset(): void {
    this.records.clear();
  }

  /** 輸出成本摘要到 console */
  printSummary(): void {
    if (this.records.size === 0) return;

    const rows = [...this.records.values()];
    const totalInput = rows.reduce((s, r) => s + r.input_tokens, 0);
    const totalOutput = rows.reduce((s, r) => s + r.output_tokens, 0);
    const totalCost =
      (totalInput / 1_000_000) * PRICE_INPUT_PER_M +
      (totalOutput / 1_000_000) * PRICE_OUTPUT_PER_M;

    console.log("\n--- Token 成本摘要 ---\n");
    console.log(
      `${"Agent".padEnd(14)} ${"呼叫".padStart(4)} ${"Input".padStart(10)} ${"Output".padStart(10)} ${"Cost(USD)".padStart(12)}`
    );
    console.log("-".repeat(55));

    for (const r of rows) {
      const cost =
        (r.input_tokens / 1_000_000) * PRICE_INPUT_PER_M +
        (r.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_M;
      console.log(
        `${r.agent.padEnd(14)} ${String(r.calls).padStart(4)} ` +
          `${r.input_tokens.toLocaleString().padStart(10)} ` +
          `${r.output_tokens.toLocaleString().padStart(10)} ` +
          `${("$" + cost.toFixed(4)).padStart(12)}`
      );
    }

    console.log("-".repeat(55));
    console.log(
      `${"Total".padEnd(14)} ${"".padStart(4)} ` +
        `${totalInput.toLocaleString().padStart(10)} ` +
        `${totalOutput.toLocaleString().padStart(10)} ` +
        `${("$" + totalCost.toFixed(4)).padStart(12)}`
    );
    console.log("");
  }
}

/** Pipeline 全域 singleton */
export const tokenTracker = new TokenTracker();
