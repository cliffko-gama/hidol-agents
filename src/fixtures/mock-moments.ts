/**
 * 模擬 Moment 資料 — 用於 POC 測試
 *
 * 模擬一個場景：2025 年夏天有一場大型音樂祭，
 * 同時有一些日常練習室和幕後花絮的 Moment。
 */

import type { Moment } from "../types";

export const MOCK_MOMENTS: Moment[] = [
  // === 夏日音樂祭相關 ===
  {
    id: "m-001",
    user_id: "u-101",
    user_display_name: "星星追光者",
    type: "photo",
    text_content:
      "天啊天啊天啊！！！第一次站在最前排，當副歌響起的時候整個場地三萬人一起唱，我的眼淚直接用噴的 😭 這就是現場的魔力吧，沒有任何螢幕可以傳達這種感覺",
    media: [
      {
        id: "media-001",
        type: "image",
        url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800",
        thumbnail_url:
          "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400",
        width: 1200,
        height: 800,
        alt_text: "音樂祭現場，舞台燈光照亮了整個場地，觀眾密集地站在一起",
      },
    ],
    hashtags: ["夏日音樂祭", "最前排", "現場就是不一樣", "hidol"],
    location: { name: "大佳河濱公園", latitude: 25.0711, longitude: 121.5376 },
    created_at: "2025-07-20T21:30:00+08:00",
    engagement: { likes: 1523, comments: 89, shares: 45 },
    deep_link: "hidol://moment/m-001",
  },
  {
    id: "m-002",
    user_id: "u-102",
    user_display_name: "小鹿亂撞",
    type: "video",
    text_content:
      "錄到了安可曲的完整版！整個場地的螢光棒從藍色變成金色的那一刻，我覺得自己見證了什麼很重要的事情。回家的路上一直在單曲循環",
    media: [
      {
        id: "media-002",
        type: "video",
        url: "https://example.com/videos/encore-moment.mp4",
        thumbnail_url:
          "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400",
        width: 1920,
        height: 1080,
        duration_seconds: 180,
        alt_text:
          "音樂祭安可曲現場，觀眾揮舞螢光棒，從藍色漸變為金色，氣氛震撼",
      },
    ],
    hashtags: ["夏日音樂祭", "安可", "螢光棒海", "感動"],
    location: { name: "大佳河濱公園", latitude: 25.0711, longitude: 121.5376 },
    created_at: "2025-07-20T22:15:00+08:00",
    engagement: { likes: 2891, comments: 156, shares: 234 },
    deep_link: "hidol://moment/m-002",
  },
  {
    id: "m-003",
    user_id: "u-103",
    user_display_name: "北極熊不怕冷",
    type: "text",
    text_content:
      "寫在音樂祭之後——\n\n其實我本來不打算去的。票價不便宜，而且要站一整天。但朋友硬是拉了我去。\n\n現在我只想說：謝謝那個拉我去的朋友。\n\n當燈光暗下來，第一個音符響起的時候，我理解了為什麼有人願意排隊八小時、願意從高雄特地北上、願意花一個月的薪水只為了那幾個小時。\n\n音樂是真的能拯救一個人的。至少那天晚上，我被拯救了。",
    media: [],
    hashtags: ["夏日音樂祭", "音樂的力量", "感謝", "被拯救的夜晚"],
    created_at: "2025-07-21T02:30:00+08:00",
    engagement: { likes: 3456, comments: 278, shares: 189 },
    deep_link: "hidol://moment/m-003",
  },
  {
    id: "m-004",
    user_id: "u-104",
    user_display_name: "檸檬氣泡水",
    type: "photo",
    text_content:
      "和閨蜜們的音樂祭穿搭！我們花了兩個禮拜討論要穿什麼 😂 最後決定全部穿白色系配彩色配件，在人群中超好認的！還有人問我們是不是同一個後援會的",
    media: [
      {
        id: "media-004",
        type: "image",
        url: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800",
        thumbnail_url:
          "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400",
        width: 1080,
        height: 1350,
        alt_text: "四個女生穿著白色系服裝，配戴彩色配件，在音樂祭場地合照",
      },
    ],
    hashtags: ["夏日音樂祭", "音樂祭穿搭", "閨蜜", "OOTD"],
    location: { name: "大佳河濱公園" },
    created_at: "2025-07-20T16:00:00+08:00",
    engagement: { likes: 892, comments: 67, shares: 23 },
    deep_link: "hidol://moment/m-004",
  },
  {
    id: "m-005",
    user_id: "u-105",
    user_display_name: "音浪衝擊者",
    type: "photo",
    text_content:
      "排了六小時終於搶到的位置！腳已經不是我的了但聽到第一首歌的時候什麼疲勞都消失了。旁邊的大哥跟我說他從台中五點就出發了，真的是愛才會這樣",
    media: [
      {
        id: "media-005",
        type: "image",
        url: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800",
        thumbnail_url:
          "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=400",
        width: 1200,
        height: 800,
        alt_text: "從觀眾視角拍攝的舞台，燈光絢爛，人群密集",
      },
    ],
    hashtags: ["夏日音樂祭", "前排戰士", "排隊六小時", "值得"],
    location: { name: "大佳河濱公園" },
    created_at: "2025-07-20T19:00:00+08:00",
    engagement: { likes: 1205, comments: 93, shares: 31 },
    deep_link: "hidol://moment/m-005",
  },

  // === 練習室 / 幕後花絮 ===
  {
    id: "m-006",
    user_id: "u-106",
    user_display_name: "偷偷觀察員",
    type: "photo",
    text_content:
      "在公司附近意外目擊了練習室的日常！透過玻璃窗看到他們在練新的編舞，動作超整齊的。偷拍了一張（不要告訴他們 🤫）",
    media: [
      {
        id: "media-006",
        type: "image",
        url: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=800",
        thumbnail_url:
          "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=400",
        width: 1200,
        height: 800,
        alt_text: "透過玻璃窗拍攝的練習室，裡面有人在練舞",
      },
    ],
    hashtags: ["練習室", "偷拍", "幕後", "好努力"],
    created_at: "2025-07-15T14:30:00+08:00",
    engagement: { likes: 678, comments: 45, shares: 12 },
    deep_link: "hidol://moment/m-006",
  },
  {
    id: "m-007",
    user_id: "u-107",
    user_display_name: "MV追蹤達人",
    type: "video",
    text_content:
      "新 MV 拍攝花絮！這次的場景好像是在一個廢棄的工廠裡，燈光超美的。看到工作人員在搬大型道具，感覺這次的製作規模又升級了",
    media: [
      {
        id: "media-007",
        type: "video",
        url: "https://example.com/videos/mv-bts.mp4",
        thumbnail_url:
          "https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?w=400",
        width: 1920,
        height: 1080,
        duration_seconds: 45,
        alt_text: "MV 拍攝現場的幕後花絮，工作人員在佈置燈光和道具",
      },
    ],
    hashtags: ["MV拍攝", "幕後花絮", "新歌", "期待"],
    created_at: "2025-07-10T11:00:00+08:00",
    engagement: { likes: 1034, comments: 78, shares: 56 },
    deep_link: "hidol://moment/m-007",
  },

  // === 粉絲日常 / 其他 ===
  {
    id: "m-008",
    user_id: "u-108",
    user_display_name: "手作達人小美",
    type: "photo",
    text_content:
      "花了三天做的手幅終於完成了！用了 LED 燈條和雷射切割的壓克力板。音樂祭的時候要舉著它！希望能被看到 🥺",
    media: [
      {
        id: "media-008",
        type: "image",
        url: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800",
        thumbnail_url:
          "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400",
        width: 1080,
        height: 1080,
        alt_text: "手工製作的 LED 手幅，發出藍白色光芒",
      },
    ],
    hashtags: ["手幅", "手作", "夏日音樂祭", "應援"],
    created_at: "2025-07-18T20:00:00+08:00",
    engagement: { likes: 756, comments: 89, shares: 15 },
    deep_link: "hidol://moment/m-008",
  },
  {
    id: "m-009",
    user_id: "u-109",
    user_display_name: "高雄特快車",
    type: "text",
    text_content:
      "從高雄搭高鐵北上看音樂祭！5:30 的早班車，現在在車上興奮到睡不著。行李箱裡塞滿了應援物和換洗衣服。今天的目標：不要哭（大概做不到）",
    media: [],
    hashtags: ["夏日音樂祭", "高雄北上", "高鐵", "興奮"],
    created_at: "2025-07-20T05:45:00+08:00",
    engagement: { likes: 543, comments: 67, shares: 8 },
    deep_link: "hidol://moment/m-009",
  },

  // === 低品質 / 應被過濾的 Moment ===
  {
    id: "m-010",
    user_id: "u-110",
    user_display_name: "路人甲",
    type: "text",
    text_content: "+1",
    media: [],
    hashtags: [],
    created_at: "2025-07-20T20:00:00+08:00",
    engagement: { likes: 2, comments: 0, shares: 0 },
  },
  {
    id: "m-011",
    user_id: "u-111",
    user_display_name: "賣場小編",
    type: "text",
    text_content:
      "🔥限時特賣🔥 音樂祭周邊商品全面 8 折！官方 T-shirt 只要 $590！數量有限售完為止！點擊連結搶購 👉 https://fake-shop.com/sale",
    media: [],
    hashtags: ["夏日音樂祭", "特賣", "周邊", "限時"],
    created_at: "2025-07-19T10:00:00+08:00",
    engagement: { likes: 15, comments: 3, shares: 1 },
  },
  {
    id: "m-012",
    user_id: "u-112",
    user_display_name: "emoji王",
    type: "text",
    text_content: "🎵🎶🎤🎸🥁🎹🎷🎺🎻🪕🎼💃🕺✨🌟⭐️🔥💥❤️‍🔥",
    media: [],
    hashtags: ["音樂"],
    created_at: "2025-07-20T18:00:00+08:00",
    engagement: { likes: 8, comments: 1, shares: 0 },
  },
  // 重複內容
  {
    id: "m-013",
    user_id: "u-101",
    user_display_name: "星星追光者",
    type: "photo",
    text_content:
      "天啊天啊天啊！！！第一次站在最前排，當副歌響起的時候整個場地三萬人一起唱，我的眼淚直接用噴的 😭 這就是現場的魔力吧",
    media: [
      {
        id: "media-013",
        type: "image",
        url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800",
        thumbnail_url:
          "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400",
        width: 1200,
        height: 800,
        alt_text: "音樂祭現場",
      },
    ],
    hashtags: ["夏日音樂祭", "最前排"],
    location: { name: "大佳河濱公園" },
    created_at: "2025-07-20T21:35:00+08:00",
    engagement: { likes: 234, comments: 12, shares: 5 },
    deep_link: "hidol://moment/m-013",
  },
];
