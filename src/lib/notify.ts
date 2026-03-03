/**
 * Pipeline 結果通知
 *
 * 支援：
 * 1. GitHub Actions Job Summary — $GITHUB_STEP_SUMMARY 存在時自動寫入 Markdown
 * 2. Slack Webhook — SLACK_WEBHOOK_URL 存在且有失敗時自動發送
 *
 * 在本地開發時兩者皆為 no-op，不影響現有流程。
 */

import fs from "fs";
import type { PipelineResult } from "../types/pipeline.js";

/** 主入口：在 pipeline 完成後呼叫 */
export async function notifyPipelineResult(
  result: PipelineResult,
  runId: string
): Promise<void> {
  const tasks: Promise<void>[] = [];

  // 1. GitHub Actions Job Summary
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    tasks.push(writeGitHubSummary(summaryPath, result, runId));
  }

  // 2. Slack Webhook（僅在有錯誤時發送）
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl && (result.status !== "success" || result.errors.length > 0)) {
    tasks.push(sendSlackAlert(slackUrl, result, runId));
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks).then((results) => {
      results.forEach((r) => {
        if (r.status === "rejected") {
          console.warn(`[Notify] 通知發送失敗（不影響 pipeline 結果）: ${r.reason}`);
        }
      });
    });
  }
}

// ─── GitHub Actions Job Summary ────────────────────────────────────────────

function writeGitHubSummary(
  summaryPath: string,
  result: PipelineResult,
  runId: string
): Promise<void> {
  const statusEmoji =
    result.status === "success" ? "✅" :
    result.status === "partial_success" ? "⚠️" : "❌";

  const storiesSection =
    result.published_stories.length > 0
      ? result.published_stories.map((s) => `- **${s.title}** — ${s.url}`).join("\n")
      : "_本次未發佈任何文章_";

  const errorsSection =
    result.errors.length > 0
      ? result.errors.map((e) => `- \`[${e.agent}]\` ${e.message.slice(0, 200)}`).join("\n")
      : "_無錯誤_";

  const summary = `
## ${statusEmoji} hidol Pipeline 執行結果

| 欄位 | 值 |
|------|-----|
| Run ID | \`${runId}\` |
| 狀態 | ${result.status} |
| 輸入 Moment | ${result.stats.total_moments_input} |
| 篩選後 | ${result.stats.moments_after_filter} |
| 發現主題 | ${result.stats.topics_identified} |
| 成功發佈 | ${result.stats.stories_published} |

### 發佈文章

${storiesSection}

### 錯誤紀錄

${errorsSection}
`;

  try {
    fs.appendFileSync(summaryPath, summary, "utf-8");
    console.log("[Notify] ✅ GitHub Job Summary 已寫入");
  } catch (err) {
    console.warn(`[Notify] 無法寫入 GitHub Job Summary: ${err}`);
  }

  return Promise.resolve();
}

// ─── Slack Webhook ──────────────────────────────────────────────────────────

async function sendSlackAlert(
  webhookUrl: string,
  result: PipelineResult,
  runId: string
): Promise<void> {
  const statusEmoji =
    result.status === "success" ? "✅" :
    result.status === "partial_success" ? "⚠️" : "❌";

  const errorList =
    result.errors.length > 0
      ? result.errors.map((e) => `• [${e.agent}] ${e.message.slice(0, 150)}`).join("\n")
      : "無";

  const payload = {
    text: `${statusEmoji} *hidol Pipeline 完成* — \`${runId}\``,
    attachments: [
      {
        color: result.status === "success" ? "good" : result.status === "partial_success" ? "warning" : "danger",
        fields: [
          { title: "狀態", value: result.status, short: true },
          { title: "發佈文章", value: String(result.stats.stories_published), short: true },
          { title: "錯誤", value: errorList, short: false },
        ],
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook 回應 ${response.status}: ${await response.text()}`);
  }

  console.log("[Notify] ✅ Slack 告警已發送");
}
