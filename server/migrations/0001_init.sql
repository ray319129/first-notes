-- 每日挑戰題目：每個分類每天一組，第一個送上來的客戶端產生（first-write-wins）
CREATE TABLE IF NOT EXISTS daily_sets (
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  tracks TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (category, date)
);

-- 每日挑戰成績：每人每天每分類只算第一次
CREATE TABLE IF NOT EXISTS scores (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  date TEXT NOT NULL,
  score INTEGER NOT NULL,
  max INTEGER NOT NULL,
  solved_at TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category, date)
);

CREATE INDEX IF NOT EXISTS scores_by_date ON scores (date, category);
