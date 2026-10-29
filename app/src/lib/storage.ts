// 本機儲存（Spicetify.LocalStorage，跟著 Spotify 的使用者資料走）。讀寫失敗時退回預設值，不影響遊戲
const PREFIX = "first-notes:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = Spicetify.LocalStorage.get(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    Spicetify.LocalStorage.set(PREFIX + key, JSON.stringify(value));
  } catch {
    // 存不了就算了
  }
}
