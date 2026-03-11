/**
 * Token 成本追蹤器
 *
 * 以 module singleton 方式在整個 pipeline 執行過程中累計 API token 用量，
 * 並在結束後輸出成本摘要。支援 Anthropic（Claude）與 Google（Gemini）雙軌計價。
 *
 * 使用方式：
 *   tokenTracker.record("Agent C", inputTokens, outputTokens, "claude-sonnet-4-5");
 *   tokenTracker.printSummary();
 *
 * 定價（USD per 1M tokens，2025 年）：
 *   claude-haiku-4-5    : Input $0.80 / Output $4.00
 *   claude-sonnet-4-5/6 : Input $3.00 / Output $15.00
 *   gemini-3.1-flash-preview : Input $0.10 / Output $0.40  (estimated)
 *   gemini-3.1-pro-preview   : Input $1.25 / Output $10.00 (estimated)
 */

export interface TokenRecord {
  agent: string;
  input_tokens: number;
  output_tokens: number;
  calls: number;
  model: string;
}

// USD per 1M tokens
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5":   { input: 0.80,  output: 4.00  },
  "claude-sonnet-4-5":  { input: 3.00,  output: 15.00 },
  "claude-sonnet-4-6":  { input: 3.00,  output: 15.00 },
  "gemini-2.5-flash": { input: 0.10,  output: 0.40  },
  "gemini-2.5-pro":   { input: 1.25,  output: 10.00 },
};

const DEFAULT_PRICING = { input: 3.00, output: 15.00 };

function getPricing(model: string) {
  // 對 model ID 做前綴比對，相容未來的 minor version
  const key = Object.keys(MODEL_PRICING).find((k) => model.startsWith(k));
  return key ? MODEL_PRICING[key] : DEFAULT_PRICING;
}

class TokenTracker {
  private records: Map<string, TokenRecord> = new Map();

  /** 記錄一次 API 呼叫的 token 用量 */
  record(
    agent: string,
    inputTokens: number,
    outputTokens: number,
    model = "claude-sonnet-4-5"
  ): void {
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
        model,
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
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;

    console.log("\n--- Token 成本摘要 ---\n");
    console.log(
      `${"Agent".padEnd(24)} ${"Model".padEnd(22)} ${"呼叫".padStart(4)} ${"Input".padStart(10)} ${"Output".padStart(10)} ${"Cost(USD)".padStart(12)}`
    );
    console.log("-".repeat(90));

    for (const r of rows) {
      const pricing = getPricing(r.model);
      const cost =
        (r.input_tokens / 1_000_000) * pricing.input +
        (r.output_tokens / 1_000_000) * pricing.output;
      totalCost += cost;
      totalInput += r.input_tokens;
      totalOutput += r.output_tokens;

      console.log(
        `${r.agent.padEnd(24)} ${r.model.padEnd(22)} ${String(r.calls).padStart(4)} ` +
        `${r.input_tokens.toLocaleString().padStart(10)} ` +
        `${r.output_tokens.toLocaleString().padStart(10)} ` +
        `${("$" + cost.toFixed(4)).padStart(12)}`
      );
    }

    console.log("-".repeat(90));
    console.log(
      `${"Total".padEnd(24)} ${"".padEnd(22)} ${"".padStart(4)} ` +
      `${totalInput.toLocaleString().padStart(10)} ` +
      `${totalOutput.toLocaleString().padStart(10)} ` +
      `${("$" + totalCost.toFixed(4)).padStart(12)}`
    );
    console.log("");
  }
}

/** Pipeline 全域 singleton */
export const tokenTracker = new TokenTracker();
