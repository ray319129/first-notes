import { Category } from "../../app/src/net/protocol";

/**
 * 每日挑戰分類（自己挑的清單）。
 * playlists 是已知的 Spotify 官方歌單；不確定 ID 的只放 queries，由客戶端搜尋擁有者是 Spotify 的歌單。
 * 標「未驗證」的 ID 需要在 Spotify 裡確認，見 HANDOFF。
 */
export const CATEGORIES: Category[] = [
  // 37i9dQZF1DX670mqw6YyS4 原本以為是「Taiwan Indie Pick」，2026-10-29 查證已變成「2026 HER VOICE 暖場歌單」，已移除
  { id: "tw-indie", name: "台灣獨立樂團", playlists: [], queries: ["Taiwan Indie", "台灣獨立"] },
  { id: "tw-pop", name: "台灣流行音樂", playlists: [], queries: ["Hot Hits Taiwan", "最 Hit 華語榜"] },
  { id: "mando-classic", name: "華語經典", playlists: [], queries: ["華語經典", "Mandopop Classics"] },
  { id: "jpop", name: "日本流行", playlists: [], queries: ["Tokyo Super Hits!", "J-Pop"] },
  { id: "kpop", name: "韓國流行", playlists: [], queries: ["K-Pop ON!", "K-Pop Daebak"] },
  { id: "global", name: "全球熱門", playlists: ["spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"], queries: ["Today's Top Hits"] },
  { id: "rock", name: "經典搖滾", playlists: ["spotify:playlist:37i9dQZF1DWXRqgorJj26U"], queries: ["Rock Classics"] },
  { id: "hiphop", name: "嘻哈", playlists: ["spotify:playlist:37i9dQZF1DX0XUsuxWHRQd"], queries: ["RapCaviar"] },
];

export const findCategory = (id: string) => CATEGORIES.find((c) => c.id === id);
