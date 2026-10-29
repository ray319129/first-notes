-- 每日挑戰可以選自由輸入或選擇題，排行榜依作答方式分開
-- 選擇題的選項大家要一樣，所以跟題目一起存（第一次有人玩選擇題時才填）
ALTER TABLE daily_sets ADD COLUMN choices TEXT;
-- 每人每天每分類還是只收一次成績（不能用一種方式玩過再用另一種刷分）
ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'free';
