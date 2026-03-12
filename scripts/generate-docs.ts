/**
 * generate-docs.ts
 *
 * 從 output/ 目錄讀取 Pipeline 產出的故事，
 * 生成 docs/ 靜態網站供 GitHub Pages 部署。
 *
 * 用法：
 *   npx tsx scripts/generate-docs.ts
 *   npm run generate-docs
 *
 * 輸出：
 *   docs/index.html      → 主頁面（含所有故事資料，自包含）
 *   docs/stories/*.json  → 個別故事 JSON（給外部程式讀取用）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");
const DOCS_DIR = path.join(PROJECT_ROOT, "docs");
const DOCS_STORIES_DIR = path.join(DOCS_DIR, "stories");

// ─────────────────────────────────────────────────────────
// 型別（與 agents.ts 對齊，這裡只取需要的欄位）
// ─────────────────────────────────────────────────────────

interface StoryMeta {
  story_id: string;
  title: string;
  published_at: string;
  url: string;
  cover_image_url: string;
  tags?: string[];
  moment_count?: number;
  contributing_fans?: number;
  reading_time_minutes?: number;
}

interface SectionMoment {
  moment_id: string;
  user_display_name?: string;
  media_type?: string;
  text_content?: string;
  media_url?: string;
  thumbnail_url?: string;
  alt_text?: string;
  caption?: string;
  engagement?: { likes?: number; comments?: number; shares?: number };
  deep_link?: string;
}

interface Section {
  section_id: string;
  type: string;
  heading?: string;
  content?: string;
  items?: Array<{ content: string; media_url?: string; user?: string }>;
  moments?: SectionMoment[];
  [key: string]: unknown;
}

interface StoryJSON {
  meta: {
    title: string;
    description: string;
    og_image?: string;
    keywords?: string[];
    published_at: string;
    reading_time_minutes?: number;
  };
  header: {
    title: string;
    subtitle?: string;
    cover?: {
      url: string;
      alt?: string;
      caption?: string;
      credit?: { user_display_name: string };
    };
  };
  sections: Section[];
  footer?: {
    // Agent E 實際格式：Record<user_display_name, count> 或 Array 兩種都支援
    moment_credits?: Record<string, number> | Array<{ user_display_name: string; moment_count: number }>;
    contributing_fans?: string[];
    external_sources?: Array<{ title: string; url: string }>;
    related_stories?: Array<{ story_id: string; title: string; url: string; cover_image_url?: string }>;
    tags?: string[];
  };
}

/** moment_credits 正規化成 { name, count } 陣列 */
function normalizeCredits(credits: StoryJSON["footer"]["moment_credits"]): Array<{ name: string; count: number }> {
  if (!credits) return [];
  if (Array.isArray(credits)) {
    return credits.map((c) => ({ name: c.user_display_name ?? "", count: c.moment_count ?? 0 }));
  }
  // Record<string, number>
  return Object.entries(credits).map(([name, count]) => ({ name, count }));
}

interface ParsedStory {
  meta: StoryMeta;
  content: StoryJSON;
  runId: string;
}

// ─────────────────────────────────────────────────────────
// 1. 掃描 output/ 找所有已發佈故事，並從 docs/stories/ 補充歷史故事
// ─────────────────────────────────────────────────────────

function collectStories(): ParsedStory[] {
  const storiesMap = new Map<string, ParsedStory>(); // story_id → latest

  // ── Step 0：先掃描 manifest.json 與 docs/stories/ 建立歷史 published_at 對照表 ──
  // 用來保留已存在故事的原始發佈時間，避免重新生成時被覆蓋成新時間
  const historicalPublishedAt = new Map<string, string>();

  // 來源 1：manifest.json（所有故事都有 published_at，作為 fallback）
  const manifestPath = path.join(DOCS_DIR, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw) as { stories: Array<{ story_id: string; published_at: string }> };
      for (const s of manifest.stories ?? []) {
        if (s.story_id && s.published_at) {
          historicalPublishedAt.set(s.story_id, s.published_at);
        }
      }
    } catch {
      // manifest 不可用時忽略
    }
  }

  // 來源 2：docs/stories/*.json 的 meta.published_at（更精確，優先覆蓋 manifest 版本）
  if (fs.existsSync(DOCS_STORIES_DIR)) {
    const storyFiles = fs
      .readdirSync(DOCS_STORIES_DIR)
      .filter((f) => f.endsWith(".json") && f !== "stories.json");

    for (const file of storyFiles) {
      try {
        const storyId = file.replace(/\.json$/, "");
        const raw = fs.readFileSync(path.join(DOCS_STORIES_DIR, file), "utf-8");
        const storyContent = JSON.parse(raw) as StoryJSON;
        if (storyContent.meta?.published_at) {
          historicalPublishedAt.set(storyId, storyContent.meta.published_at);
        }
      } catch {
        // 忽略解析錯誤，後續 Step 2 會再處理
      }
    }
  }

  // ── Step 1：從 output/ 收集當前 run 的故事 ──
  if (fs.existsSync(OUTPUT_DIR)) {
    // 找所有 run-* 子目錄
    const entries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
    const runDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("run-"))
      .map((e) => e.name)
      .sort(); // 按時間排序，後面的覆蓋前面的

    for (const runDir of runDirs) {
      const runPath = path.join(OUTPUT_DIR, runDir);
      const runFiles = fs.readdirSync(runPath);

      // 找所有 Agent E publish 檔案
      const publishFiles = runFiles.filter((f) =>
        f.match(/^06-topic-\d+-agent-e-publish\.json$/)
      );

      for (const file of publishFiles) {
        try {
          const raw = fs.readFileSync(path.join(runPath, file), "utf-8");
          const eOutput = JSON.parse(raw) as {
            story_meta: StoryMeta;
            generated_files: Array<{ path: string; content: string; action: string }>;
          };

          // 找故事 JSON（通常是 generated_files[0]，path 含 stories/）
          const storyFile = eOutput.generated_files.find(
            (f) => f.path.includes("stories/") && f.path.endsWith(".json") && !f.path.endsWith("stories.json")
          );

          if (!storyFile) continue;

          const storyContent = JSON.parse(storyFile.content) as StoryJSON;
          const storyId = eOutput.story_meta.story_id;

          // 如果這篇故事已存在於 docs/stories/，保留原始 published_at
          // 只有真正新增的故事才使用 Agent E 給的最新時間戳
          const originalPubAt = historicalPublishedAt.get(storyId);
          if (originalPubAt) {
            eOutput.story_meta.published_at = originalPubAt;
            storyContent.meta.published_at = originalPubAt;
            console.log(`   ℹ️  ${storyId}: 保留原始發佈時間 ${originalPubAt}`);
          }

          storiesMap.set(storyId, {
            meta: eOutput.story_meta,
            content: storyContent,
            runId: runDir,
          });
        } catch (err) {
          console.warn(`  ⚠️  無法解析 ${runDir}/${file}:`, (err as Error).message);
        }
      }
    }
  } else {
    console.log("⚠️  output/ 目錄不存在，將從 docs/stories/ 載入歷史故事。");
  }

  // ── Step 2：從 docs/stories/ 補充歷史故事（不覆蓋 output/ 已有的版本）──
  // 這樣即使 GitHub Actions 每次都從空的 output/ 開始，也能累積所有故事
  if (fs.existsSync(DOCS_STORIES_DIR)) {
    const storyFiles = fs
      .readdirSync(DOCS_STORIES_DIR)
      .filter((f) => f.endsWith(".json") && f !== "stories.json");

    for (const file of storyFiles) {
      const storyId = file.replace(/\.json$/, "");
      if (storiesMap.has(storyId)) continue; // output/ 版本優先，跳過

      try {
        const raw = fs.readFileSync(path.join(DOCS_STORIES_DIR, file), "utf-8");
        const storyContent = JSON.parse(raw) as StoryJSON;

        // 從 StoryJSON 重建 StoryMeta
        const coverUrl =
          storyContent.meta?.og_image ?? storyContent.header?.cover?.url ?? "";
        const fanCount = Array.isArray(storyContent.footer?.contributing_fans)
          ? storyContent.footer.contributing_fans.length
          : undefined;

        // 從 sections 統計 moment 數量
        let momentCount = 0;
        for (const section of storyContent.sections ?? []) {
          if (Array.isArray(section.moments)) {
            momentCount += (section.moments as SectionMoment[]).length;
          }
        }

        const meta: StoryMeta = {
          story_id: storyId,
          title: storyContent.header?.title ?? storyContent.meta?.title ?? storyId,
          published_at: storyContent.meta?.published_at ?? new Date().toISOString(),
          url: `#/story/${storyId}`,
          cover_image_url: coverUrl,
          tags: storyContent.footer?.tags,
          reading_time_minutes: storyContent.meta?.reading_time_minutes,
          contributing_fans: fanCount,
          moment_count: momentCount > 0 ? momentCount : undefined,
        };

        storiesMap.set(storyId, {
          meta,
          content: storyContent,
          runId: "archived",
        });
      } catch (err) {
        console.warn(`  ⚠️  無法解析 docs/stories/${file}:`, (err as Error).message);
      }
    }
  }

  const stories = [...storiesMap.values()];
  // 按發佈時間排序（新 → 舊）
  stories.sort(
    (a, b) =>
      new Date(b.meta.published_at).getTime() -
      new Date(a.meta.published_at).getTime()
  );

  return stories;
}

// ─────────────────────────────────────────────────────────
// 2. 寫入 docs/stories/*.json
// ─────────────────────────────────────────────────────────

function writeStoryJsons(stories: ParsedStory[]): void {
  fs.mkdirSync(DOCS_STORIES_DIR, { recursive: true });
  for (const story of stories) {
    // 確保 story JSON 的 meta.published_at 一定存在
    // Agent E 可能不會產生此欄位，所以從 story.meta 回填
    if (!story.content.meta.published_at && story.meta.published_at) {
      story.content.meta.published_at = story.meta.published_at;
    }
    // 同步 reading_time_minutes（部分舊故事用 estimated_read_time）
    const anyMeta = story.content.meta as Record<string, unknown>;
    if (!story.content.meta.reading_time_minutes && anyMeta.estimated_read_time) {
      story.content.meta.reading_time_minutes = anyMeta.estimated_read_time as number;
    }

    const filePath = path.join(DOCS_STORIES_DIR, `${story.meta.story_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(story.content, null, 2), "utf-8");
  }
}

// ─────────────────────────────────────────────────────────
// 3. HTML 渲染工具函數（hidol 深色主題版）
// ─────────────────────────────────────────────────────────

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 把文字內容轉成 HTML，支援 >blockquote 格式 */
function renderText(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith(">")) {
        return `<blockquote>${esc(line.slice(1).trim())}</blockquote>`;
      }
      if (line.trim() === "") return `<div class="para-break"></div>`;
      return `<p>${esc(line)}</p>`;
    })
    .join("");
}

/** 渲染單一 Section（hidol 深色主題）*/
function renderSection(section: Section): string {
  switch (section.type) {
    case "divider":
      return `<div class="story-divider"></div>`;

    case "text": {
      const heading = section.heading
        ? `<h2 class="section-heading">${esc(section.heading)}</h2>`
        : "";
      const body = section.content ? renderText(section.content) : "";
      return `<section class="section-text">${heading}${body}</section>`;
    }

    case "moment_highlight": {
      // 核心 Moment 卡片元件 — 對應 Figma 設計風格
      const heading = section.heading
        ? `<div class="moment-tag"><span>${esc(section.heading)}</span></div>`
        : "";
      const body = section.content ? renderText(section.content) : "";
      return `<section class="section-moment">
        <div class="moment-card-inner">
          ${heading}
          <div class="moment-body">${body}</div>
        </div>
      </section>`;
    }

    case "trend_insight": {
      const heading = section.heading
        ? `<h3 class="insight-heading">${esc(section.heading)}</h3>`
        : "";
      const body = section.content ? renderText(section.content) : "";
      return `<section class="section-insight">${heading}${body}</section>`;
    }

    case "moment_gallery": {
      const heading = section.heading
        ? `<h3 class="gallery-heading">${esc(section.heading)}</h3>`
        : "";
      const body = section.content ? renderText(section.content) : "";
      return `<section class="section-gallery">${heading}${body}</section>`;
    }

    default: {
      if (section.content) {
        const heading = section.heading
          ? `<h3 class="section-heading">${esc(section.heading)}</h3>`
          : "";
        return `<section class="section-text">${heading}${renderText(section.content)}</section>`;
      }
      return "";
    }
  }
}

/** 渲染故事文章頁面（hidol 深色主題 Hero 版）*/
function renderStoryPage(story: ParsedStory): string {
  const { content } = story;
  const { header, sections, footer } = content;

  // Tags
  const tags = footer?.tags ?? story.meta.tags ?? [];
  const tagsHtml =
    tags.length > 0
      ? `<div class="story-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`
      : "";

  // Reading time & fan count
  const readTime = content.meta.reading_time_minutes ?? story.meta.reading_time_minutes;
  const fanCount = story.meta.contributing_fans;
  const momentCount = story.meta.moment_count;

  // Sections
  const sectionsHtml = sections.map(renderSection).join("\n");

  // 從所有 moment_highlight / moment_gallery 段落中收集來源 Moment
  const allSourceMoments: SectionMoment[] = [];
  const seenMomentIds = new Set<string>();
  for (const section of sections) {
    if (
      (section.type === "moment_highlight" || section.type === "moment_gallery") &&
      Array.isArray(section.moments)
    ) {
      for (const m of section.moments) {
        if (m.moment_id && !seenMomentIds.has(m.moment_id)) {
          seenMomentIds.add(m.moment_id);
          allSourceMoments.push(m);
        }
      }
    }
  }

  const sourceMomentsHtml =
    allSourceMoments.length > 0
      ? `<div class="source-moments">
          <h4>引用的 Moment</h4>
          <div class="source-moments-grid">
            ${allSourceMoments
              .map(
                (m) => `
              <div class="source-moment-card">
                ${
                  m.media_url
                    ? `<div class="smc-image-wrap">
                        <img src="${esc(m.media_url)}" alt="${esc(m.alt_text ?? m.text_content?.slice(0, 40))}"
                          onerror="this.style.display='none'; this.parentElement.classList.add('no-img')">
                      </div>`
                    : ""
                }
                <div class="smc-body">
                  <div class="smc-user">
                    <span class="smc-avatar">${esc(m.user_display_name?.slice(0, 1) ?? "P")}</span>
                    <span class="smc-name">${esc(m.user_display_name ?? "粉絲")}</span>
                  </div>
                  ${
                    m.text_content
                      ? `<p class="smc-text">${esc(m.text_content.slice(0, 120))}${m.text_content.length > 120 ? "…" : ""}</p>`
                      : ""
                  }
                  ${
                    m.engagement?.likes
                      ? `<div class="smc-stats"><span>❤️ ${m.engagement.likes}</span></div>`
                      : ""
                  }
                </div>
              </div>`
              )
              .join("")}
          </div>
        </div>`
      : "";

  // External sources（過濾掉 example.com）
  const sources = (footer?.external_sources ?? []).filter(
    (s) => s.url && !s.url.includes("example.com") && s.url.startsWith("http")
  );
  const sourcesHtml =
    sources.length > 0
      ? `<div class="story-sources">
          <h4>延伸閱讀</h4>
          ${sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join("")}
        </div>`
      : "";

  // Related stories
  const related = footer?.related_stories ?? [];
  const relatedHtml =
    related.length > 0
      ? `<div class="story-related">
          <h4>你可能也喜歡</h4>
          <div class="related-list">
            ${related
              .map(
                (r) =>
                  `<div class="related-card" onclick="showStory('${esc(r.story_id)}')">
                    ${r.cover_image_url ? `<img src="${esc(r.cover_image_url)}" alt="${esc(r.title)}" onerror="this.style.display='none'">` : ""}
                    <span>${esc(r.title)}</span>
                  </div>`
              )
              .join("")}
          </div>
        </div>`
      : "";

  // Hero cover
  const coverUrl = header.cover?.url ?? "";
  const hasCover = Boolean(coverUrl);

  return `
    <div class="story-page-inner">
      <!-- ── Hero ── -->
      <div class="story-hero ${hasCover ? "" : "story-hero--no-img"}">
        ${hasCover ? `<div class="story-hero-bg">
          <img src="${esc(coverUrl)}" alt="${esc(header.cover?.alt ?? "")}"
            onerror="this.style.display='none'; this.parentElement.classList.add('no-img')">
          <div class="story-hero-overlay"></div>
        </div>` : ""}
        <div class="story-hero-content">
          ${tagsHtml}
          <h1 class="story-title">${esc(header.title)}</h1>
          ${header.subtitle ? `<p class="story-subtitle">${esc(header.subtitle)}</p>` : ""}
          <div class="story-meta-row">
            ${readTime ? `<span class="meta-item">📖 ${readTime} 分鐘閱讀</span>` : ""}
            ${fanCount ? `<span class="meta-item">👤 ${fanCount} 位粉絲</span>` : ""}
            ${momentCount ? `<span class="meta-item">📸 ${momentCount} 則 Moment</span>` : ""}
          </div>
          ${header.cover?.caption ? `<p class="cover-caption">${esc(header.cover.caption)}</p>` : ""}
        </div>
      </div>

      <!-- ── Article Body ── -->
      <div class="story-layout">
        <!-- Floating sidebar (share) -->
        <aside class="story-sidebar">
          <button class="sidebar-btn" title="分享" onclick="navigator.clipboard?.writeText(location.href).then(()=>alert('連結已複製！'))">🔗</button>
          <button class="sidebar-btn" title="返回列表" onclick="showIndex()">←</button>
        </aside>

        <article class="story-article">
          <div class="story-body">
            ${sectionsHtml}
          </div>
          <footer class="story-footer">
            ${sourceMomentsHtml}
            ${sourcesHtml}
            ${relatedHtml}
          </footer>
        </article>
      </div>
    </div>
  `;
}

/** 渲染首頁故事卡片（hidol Moment Card 風格）*/
function renderStoryCard(story: ParsedStory): string {
  const tags = story.meta.tags ?? [];
  const topTag = tags[0] ?? "";
  const pubDate = new Date(story.meta.published_at).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const readTime = story.meta.reading_time_minutes ?? story.content.meta.reading_time_minutes;
  const fanCount = story.meta.contributing_fans;
  const desc = story.content.meta.description;
  const coverUrl = story.meta.cover_image_url;

  return `
    <div class="story-card" data-story-id="${esc(story.meta.story_id)}">
      <div class="card-image-wrapper">
        <img class="card-image" src="${esc(coverUrl)}" alt="${esc(story.content.header.title)}" loading="lazy"
          onerror="this.style.display='none'; this.parentElement.classList.add('no-img')">
        <div class="card-overlay">
          <div class="card-overlay-content">
            <h3 class="card-overlay-title">${esc(story.meta.title)}</h3>
          </div>
        </div>
        ${topTag ? `<span class="card-tag">${esc(topTag)}</span>` : ""}
      </div>
      <div class="card-body">
        <h2 class="card-title">${esc(story.meta.title)}</h2>
        ${desc ? `<p class="card-desc">${esc(desc.slice(0, 75))}${desc.length > 75 ? "…" : ""}</p>` : ""}
        <div class="card-footer">
          <div class="card-user">
            <span class="card-avatar">✨</span>
            <span class="card-date">${pubDate}</span>
          </div>
          <div class="card-meta">
            ${fanCount ? `<span class="card-stat">👤 ${fanCount}</span>` : ""}
            ${readTime ? `<span class="card-stat">${readTime} min</span>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────
// 4. 產生完整 HTML 頁面（hidol 深色主題）
// ─────────────────────────────────────────────────────────

function generateHtml(stories: ParsedStory[]): string {
  const storyCardsHtml = stories.map(renderStoryCard).join("\n");
  const storyPagesHtml = stories
    .map(
      (s) =>
        `<div class="story-page" id="story-${esc(s.meta.story_id)}" style="display:none">${renderStoryPage(s)}</div>`
    )
    .join("\n");

  const storyIds = JSON.stringify(stories.map((s) => s.meta.story_id));

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>hidol Feature Stories</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700;900&family=Noto+Serif+TC:wght@400;700;900&display=swap" rel="stylesheet">
<style>
/* ── Design Tokens (hidol 設計系統) ── */
:root {
  --bg:        #080811;
  --bg-2:      #12121a;
  --bg-card:   #1a1a25;
  --glass:     rgba(26, 26, 37, 0.65);
  --glass-2:   rgba(26, 26, 37, 0.85);
  --gb:        rgba(255,255,255,0.07);   /* glass border */
  --pink:      #ff6b9d;
  --purple:    #b968ff;
  --blue:      #00d4ff;
  --gold:      #ffd700;
  --grad:      linear-gradient(135deg, #ff6b9d 0%, #b968ff 50%, #00d4ff 100%);
  --grad-pk:   linear-gradient(135deg, #ff6b9d, #e040a0);
  --grad-pu:   linear-gradient(135deg, #b968ff, #00d4ff);
  --text:      #f0f0f5;
  --text-2:    #a0a0b0;
  --text-m:    #6b6b7b;
  --r:         16px;
  --r-sm:      10px;
  --font:      'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', system-ui, sans-serif;
  --font-s:    'Noto Serif TC', Georgia, serif;
  --glow-pk:   0 0 24px rgba(255,107,157,0.35);
  --glow-pu:   0 0 24px rgba(185,104,255,0.35);
  --glow-bl:   0 0 24px rgba(0,212,255,0.35);
  --shadow:    0 8px 32px rgba(0,0,0,0.5);
  --t:         250ms ease;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: var(--font); background: var(--bg); color: var(--text);
  line-height: 1.75; font-size: 16px; min-height: 100vh;
}
a { color: var(--pink); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; display: block; }

/* ── NAVBAR ── */
.nav {
  position: sticky; top: 0; z-index: 1000;
  background: rgba(8,8,17,0.88);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255,107,157,0.12);
  padding: 0 24px; height: 64px;
  display: flex; align-items: center; gap: 14px;
}
.nav-logo {
  font-size: 22px; font-weight: 900; cursor: pointer;
  background: var(--grad); -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; background-clip: text;
  letter-spacing: -0.5px;
}
.nav-badge {
  font-size: 11px; color: var(--text-m);
  background: rgba(255,255,255,0.06); border: 1px solid var(--gb);
  padding: 3px 10px; border-radius: 999px;
}
.nav-back {
  margin-left: auto; font-size: 13px; color: var(--text-2); cursor: pointer;
  padding: 7px 16px; border-radius: 999px;
  border: 1px solid rgba(255,107,157,0.25);
  background: rgba(255,107,157,0.05);
  transition: var(--t); display: none; align-items: center; gap: 6px;
  font-family: var(--font);
}
.nav-back:hover {
  background: rgba(255,107,157,0.12);
  border-color: rgba(255,107,157,0.5);
  color: var(--text);
}
.nav-back.visible { display: flex; }

/* ── INDEX HERO ── */
.index-hero {
  position: relative; overflow: hidden;
  background: var(--bg-2); padding: 80px 24px 96px; text-align: center;
}
.index-hero::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 60% 80% at 20% 80%, rgba(255,107,157,0.18) 0%, transparent 70%),
    radial-gradient(ellipse 60% 80% at 80% 20%, rgba(185,104,255,0.14) 0%, transparent 70%);
  pointer-events: none;
}
.index-hero-inner { position: relative; }
.hero-label {
  display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 2px;
  text-transform: uppercase; color: var(--pink);
  background: rgba(255,107,157,0.1); border: 1px solid rgba(255,107,157,0.25);
  padding: 5px 14px; border-radius: 999px; margin-bottom: 20px;
}
.index-hero h1 {
  font-size: clamp(32px, 5vw, 54px); font-weight: 900;
  letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 16px;
}
.index-hero h1 .grad-text {
  background: var(--grad); -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; background-clip: text;
}
.index-hero p { font-size: 15px; color: var(--text-2); max-width: 460px; margin: 0 auto; line-height: 1.7; }

/* ── STORIES GRID ── */
.stories-grid {
  max-width: 1160px; margin: 0 auto;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 20px; padding: 48px 24px 80px;
}

/* ── STORY CARD (Moment Card 風格) ── */
.story-card {
  background: var(--glass); border: 1px solid var(--gb);
  border-radius: var(--r); overflow: hidden; cursor: pointer;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  transition: transform var(--t), box-shadow var(--t), border-color var(--t);
}
.story-card:hover {
  transform: translateY(-8px);
  box-shadow: var(--glow-pk), var(--shadow);
  border-color: rgba(255,107,157,0.3);
}

/* Card image with overlay */
.card-image-wrapper {
  position: relative; overflow: hidden;
  aspect-ratio: 4/3; background: var(--bg-card);
}
.card-image {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform 400ms ease;
}
.story-card:hover .card-image { transform: scale(1.07); }
.card-image-wrapper.no-img {
  background: linear-gradient(135deg, #1a0a1f, #0a1a2f);
}
.card-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 35%, rgba(8,8,17,0.85) 100%);
  display: flex; flex-direction: column; justify-content: flex-end; padding: 20px;
  opacity: 0; transition: opacity var(--t);
}
.story-card:hover .card-overlay { opacity: 1; }
.card-overlay-title {
  font-size: 14px; font-weight: 700; color: white; line-height: 1.4;
}
.card-tag {
  position: absolute; top: 14px; left: 14px;
  background: var(--grad); color: white;
  font-size: 11px; font-weight: 700;
  padding: 4px 12px; border-radius: 999px;
  letter-spacing: 0.3px;
}

/* Card body */
.card-body { padding: 18px 20px 20px; }
.card-title { font-size: 16px; font-weight: 700; line-height: 1.45; margin-bottom: 8px; color: var(--text); }
.card-desc { font-size: 13px; color: var(--text-2); line-height: 1.65; margin-bottom: 14px; }
.card-footer { display: flex; justify-content: space-between; align-items: center; }
.card-user { display: flex; align-items: center; gap: 8px; }
.card-avatar {
  width: 26px; height: 26px; border-radius: 999px;
  background: var(--grad); display: flex; align-items: center; justify-content: center;
  font-size: 13px;
}
.card-date { font-size: 12px; color: var(--text-m); }
.card-meta { display: flex; gap: 8px; }
.card-stat { font-size: 12px; color: var(--text-m); }

/* ── EMPTY STATE ── */
.empty-state { text-align: center; padding: 100px 24px; color: var(--text-2); }
.empty-state h3 { font-size: 22px; margin-bottom: 10px; color: var(--text); }

/* ─── STORY PAGE ─── */
#story-view { display: none; }

/* Hero section */
.story-hero {
  position: relative; min-height: 60vh;
  display: flex; align-items: flex-end;
  background: var(--bg-2);
}
.story-hero--no-img { min-height: 280px; }
.story-hero-bg {
  position: absolute; inset: 0; overflow: hidden;
}
.story-hero-bg img {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform 8s ease;
}
.story-hero:hover .story-hero-bg img { transform: scale(1.03); }
.story-hero-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(8,8,17,0.2) 0%, rgba(8,8,17,0.6) 50%, rgba(8,8,17,1) 100%);
}
.story-hero-bg.no-img {
  background: linear-gradient(135deg, rgba(255,107,157,0.15), rgba(185,104,255,0.1), rgba(8,8,17,1));
}
.story-hero-content {
  position: relative; z-index: 2;
  max-width: 800px; width: 100%; margin: 0 auto;
  padding: 60px 24px 48px;
}
.story-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.tag {
  font-size: 11px; font-weight: 600;
  background: rgba(255,107,157,0.15); border: 1px solid rgba(255,107,157,0.3);
  color: var(--pink); padding: 4px 12px; border-radius: 999px;
}
.story-title {
  font-size: clamp(26px, 4.5vw, 42px); font-weight: 900;
  line-height: 1.2; letter-spacing: -0.5px; margin-bottom: 14px;
  color: var(--text);
}
.story-subtitle { font-size: 17px; color: var(--text-2); line-height: 1.65; margin-bottom: 20px; }
.story-meta-row { display: flex; flex-wrap: wrap; gap: 16px; }
.meta-item { font-size: 13px; color: var(--text-m); }
.cover-caption { font-size: 12px; color: var(--text-m); margin-top: 12px; font-style: italic; }

/* Story layout (sidebar + article) */
.story-layout {
  max-width: 860px; margin: 0 auto;
  display: grid; grid-template-columns: 48px 1fr; gap: 32px;
  padding: 48px 24px 80px; align-items: start;
}

/* Floating sidebar */
.story-sidebar {
  position: sticky; top: 80px;
  display: flex; flex-direction: column; gap: 10px; align-items: center;
}
.sidebar-btn {
  width: 42px; height: 42px; border-radius: 999px;
  background: var(--glass); border: 1px solid var(--gb);
  color: var(--text-2); font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: var(--t); font-family: var(--font);
}
.sidebar-btn:hover {
  background: rgba(255,107,157,0.12);
  border-color: rgba(255,107,157,0.4);
  color: var(--text); box-shadow: var(--glow-pk);
}

/* Article content */
.story-article { min-width: 0; }
.story-body { margin-bottom: 48px; }

/* ── SECTION: Text ── */
.section-text { margin-bottom: 28px; }
.section-heading {
  font-size: 20px; font-weight: 700; margin-bottom: 16px; padding-top: 4px;
  color: var(--text);
}
.section-text p { font-size: 16px; color: var(--text-2); margin-bottom: 16px; line-height: 1.8; }
.section-text .para-break { height: 8px; }
.section-text blockquote {
  border-left: 3px solid rgba(255,107,157,0.5);
  background: rgba(255,107,157,0.05);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  padding: 12px 18px; margin: 16px 0;
  font-size: 15px; color: var(--text-2); line-height: 1.75;
}

/* ── DIVIDER ── */
.story-divider {
  height: 1px; margin: 28px 0;
  background: linear-gradient(90deg, transparent, rgba(255,107,157,0.3), rgba(185,104,255,0.3), transparent);
}

/* ── SECTION: Moment Highlight Card ── */
.section-moment {
  position: relative; margin-bottom: 28px;
  border-radius: var(--r); overflow: hidden;
}
.section-moment::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,107,157,0.08) 0%, rgba(185,104,255,0.05) 100%);
  border-radius: var(--r); pointer-events: none;
}
.moment-card-inner {
  border: 1px solid rgba(255,107,157,0.18);
  border-left: 3px solid var(--pink);
  border-radius: var(--r);
  padding: 22px 26px;
  background: rgba(255,107,157,0.04);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.moment-tag {
  display: inline-flex; margin-bottom: 14px;
}
.moment-tag span {
  font-size: 12px; font-weight: 700;
  background: var(--grad-pk); color: white;
  padding: 4px 14px; border-radius: 999px;
  letter-spacing: 0.3px;
}
.moment-body p { font-size: 15px; color: var(--text-2); margin-bottom: 12px; line-height: 1.8; }
.moment-body .para-break { height: 6px; }
.moment-body blockquote {
  position: relative;
  border-left: 3px solid rgba(255,107,157,0.6);
  background: rgba(8,8,17,0.6);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  padding: 14px 18px; margin: 14px 0;
  font-size: 15px; color: var(--text); line-height: 1.75;
  font-style: normal;
}

/* ── SECTION: Trend Insight ── */
.section-insight {
  border-left: 3px solid var(--purple);
  border-radius: 0 var(--r) var(--r) 0;
  padding: 22px 26px; margin-bottom: 28px;
  background: rgba(185,104,255,0.05);
  border: 1px solid rgba(185,104,255,0.15);
  border-left: 3px solid var(--purple);
}
.insight-heading {
  font-size: 17px; font-weight: 700; margin-bottom: 14px;
  background: var(--grad-pu); -webkit-background-clip: text;
  -webkit-text-fill-color: transparent; background-clip: text;
}
.section-insight p { font-size: 15px; color: var(--text-2); margin-bottom: 12px; line-height: 1.8; }
.section-insight .para-break { height: 6px; }
.section-insight blockquote {
  border-left: 3px solid rgba(185,104,255,0.5);
  background: rgba(8,8,17,0.5);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  padding: 12px 16px; margin: 14px 0;
  font-size: 14px; color: var(--text-2); line-height: 1.75;
}

/* ── SECTION: Gallery ── */
.section-gallery { margin-bottom: 28px; }
.gallery-heading { font-size: 17px; font-weight: 700; margin-bottom: 14px; color: var(--text); }
.section-gallery p { font-size: 15px; color: var(--text-2); margin-bottom: 12px; line-height: 1.8; }
.section-gallery .para-break { height: 6px; }
.section-gallery blockquote {
  border-left: 3px solid rgba(255,107,157,0.4);
  background: rgba(255,107,157,0.04);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  padding: 12px 16px; margin: 14px 0;
  font-size: 14px; color: var(--text-2); line-height: 1.75;
}

/* ── STORY FOOTER ── */
.story-footer { border-top: 1px solid rgba(255,255,255,0.07); padding-top: 36px; }

/* ── Source Moments Grid ── */
.source-moments { margin-bottom: 36px; }
.source-moments h4 {
  font-size: 13px; font-weight: 600; color: var(--text-m);
  text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 18px;
}
.source-moments-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.source-moment-card {
  background: var(--glass); border: 1px solid var(--gb);
  border-radius: var(--r); overflow: hidden;
  transition: transform var(--t), border-color var(--t), box-shadow var(--t);
}
.source-moment-card:hover {
  transform: translateY(-4px);
  border-color: rgba(255,107,157,0.3);
  box-shadow: var(--glow-pk);
}
.smc-image-wrap {
  position: relative; aspect-ratio: 4/3; overflow: hidden;
  background: var(--bg-card);
}
.smc-image-wrap img {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform 400ms ease;
}
.source-moment-card:hover .smc-image-wrap img { transform: scale(1.06); }
.smc-image-wrap.no-img {
  background: linear-gradient(135deg, #1a0a1f, #0a1a2f);
}
.smc-body { padding: 14px 16px; }
.smc-user { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.smc-avatar {
  width: 28px; height: 28px; border-radius: 999px;
  background: var(--grad); display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: white; flex-shrink: 0;
}
.smc-name { font-size: 13px; font-weight: 600; color: var(--pink); }
.smc-text {
  font-size: 13px; color: var(--text-2); line-height: 1.65;
  margin-bottom: 10px; display: -webkit-box;
  -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.smc-stats { font-size: 12px; color: var(--text-m); }

.story-sources h4 {
  font-size: 13px; font-weight: 600; color: var(--text-m);
  text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;
}
.story-sources a {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-2); margin-bottom: 8px;
  padding: 8px 14px; border-radius: var(--r-sm);
  border: 1px solid var(--gb); background: var(--glass);
  transition: var(--t);
}
.story-sources a:hover {
  color: var(--pink); border-color: rgba(255,107,157,0.25);
  text-decoration: none;
}
.story-sources a::before { content: '↗'; font-size: 12px; color: var(--text-m); }

/* Related stories */
.story-related { margin-top: 28px; }
.story-related h4 {
  font-size: 13px; font-weight: 600; color: var(--text-m);
  text-transform: uppercase; letter-spacing: 1px; margin-bottom: 14px;
}
.related-list { display: flex; flex-wrap: wrap; gap: 12px; }
.related-card {
  display: flex; align-items: center; gap: 10px;
  background: var(--glass); border: 1px solid var(--gb);
  border-radius: var(--r-sm); padding: 10px 14px; cursor: pointer;
  transition: var(--t); max-width: 320px;
}
.related-card:hover {
  border-color: rgba(255,107,157,0.3);
  background: rgba(255,107,157,0.06);
}
.related-card img {
  width: 44px; height: 44px; object-fit: cover;
  border-radius: 6px; flex-shrink: 0;
}
.related-card span { font-size: 13px; color: var(--text-2); line-height: 1.4; }

/* ── RESPONSIVE ── */
@media (max-width: 768px) {
  .stories-grid { grid-template-columns: 1fr 1fr; gap: 14px; padding: 28px 16px 60px; }
  .story-layout { grid-template-columns: 1fr; padding: 32px 16px 60px; }
  .story-sidebar { display: none; }
  .story-hero-content { padding: 40px 16px 36px; }
  .story-title { font-size: clamp(22px, 6vw, 34px); }
}
@media (max-width: 500px) {
  .stories-grid { grid-template-columns: 1fr; }
  .card-image-wrapper { aspect-ratio: 16/9; }
}
</style>
</head>
<body>

<!-- ── Navbar ── -->
<nav class="nav">
  <span class="nav-logo" onclick="showIndex()">hidol</span>
  <span class="nav-badge" id="story-count-badge">${stories.length} 篇專題</span>
  <button class="nav-back" id="nav-back-btn" onclick="showIndex()">← 返回列表</button>
</nav>

<!-- ── 首頁 ── -->
<div id="index-view">
  <div class="index-hero">
    <div class="index-hero-inner">
      <div class="hero-label">AI × 粉絲 Moment</div>
      <h1>hidol<br><span class="grad-text">Feature Stories</span></h1>
      <p>由 AI 從粉絲 Moment 中自動整理的追星故事，每一篇都是真實的記錄。</p>
    </div>
  </div>

  ${
    stories.length > 0
      ? `<div class="stories-grid" id="stories-grid">${storyCardsHtml}</div>`
      : `<div class="empty-state"><h3>還沒有故事</h3><p>執行 Pipeline 後，故事會出現在這裡。</p></div>`
  }
</div>

<!-- ── 故事頁面 ── -->
<div id="story-view">
  ${storyPagesHtml}
</div>

<script>
const STORY_IDS = ${storyIds};

function showIndex() {
  document.getElementById('index-view').style.display = '';
  document.getElementById('story-view').style.display = 'none';
  document.getElementById('nav-back-btn').classList.remove('visible');
  window.scrollTo(0, 0);
  history.pushState(null, '', location.pathname);
}

function showStory(storyId) {
  const storyPage = document.getElementById('story-' + storyId);
  if (!storyPage) return;
  document.getElementById('index-view').style.display = 'none';
  const storyView = document.getElementById('story-view');
  storyView.style.display = 'block';
  STORY_IDS.forEach(id => {
    const el = document.getElementById('story-' + id);
    if (el) el.style.display = 'none';
  });
  storyPage.style.display = 'block';
  document.getElementById('nav-back-btn').classList.add('visible');
  window.scrollTo(0, 0);
  history.pushState({ storyId }, '', '#/story/' + storyId);
}

document.addEventListener('click', function(e) {
  const card = e.target.closest('.story-card');
  if (card) showStory(card.dataset.storyId);
});

window.addEventListener('popstate', function(e) {
  if (e.state && e.state.storyId) showStory(e.state.storyId);
  else showIndex();
});

const initialHash = location.hash;
if (initialHash.startsWith('#/story/')) {
  const storyId = initialHash.replace('#/story/', '');
  if (STORY_IDS.includes(storyId)) showStory(storyId);
}
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────
// 5. Main
// ─────────────────────────────────────────────────────────

function main(): void {
  console.log("📦 hidol Docs Generator\n");

  // 確保 docs/ 目錄存在
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.mkdirSync(DOCS_STORIES_DIR, { recursive: true });

  // 收集故事（output/ 當前 run + docs/stories/ 歷史累積）
  console.log(`🔍 掃描 output/ 與 docs/stories/ ...`);
  const stories = collectStories();
  console.log(`   找到 ${stories.length} 篇故事（含歷史累積）`);

  if (stories.length === 0) {
    console.log("\n⚠️  沒有找到故事，生成空的首頁。");
  } else {
    for (const story of stories) {
      console.log(`   • ${story.meta.story_id}: ${story.meta.title}`);
    }
  }

  // 寫入個別故事 JSON
  writeStoryJsons(stories);
  console.log(`\n✅ 故事 JSON 已寫入 docs/stories/`);

  // 生成 HTML
  const html = generateHtml(stories);
  const indexPath = path.join(DOCS_DIR, "index.html");
  fs.writeFileSync(indexPath, html, "utf-8");
  console.log(`✅ 主頁已生成: docs/index.html (${Math.round(html.length / 1024)} KB)`);

  // 寫入 manifest（供外部程式讀取）
  const manifest = {
    generated_at: new Date().toISOString(),
    story_count: stories.length,
    stories: stories.map((s) => ({
      story_id: s.meta.story_id,
      title: s.meta.title,
      published_at: s.meta.published_at,
      tags: s.meta.tags ?? [],
    })),
  };
  fs.writeFileSync(
    path.join(DOCS_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  console.log(`✅ Manifest 已生成: docs/manifest.json`);

  console.log("\n🎉 完成！部署步驟：");
  console.log("   git add docs/ && git commit -m 'deploy: update stories' && git push");
  console.log("   → GitHub Pages 將自動更新");
}

main();
