# First Notes 伺服器

每日挑戰、排行榜和多人連線的後端，用 Cloudflare Workers + D1 + Durable Objects，免費方案就夠用。

一般玩家不需要自己架，遊戲預設就會連到公開的伺服器。想自己架的情況像是：只給自己的朋友用、不想把資料送到別人的伺服器，或公開伺服器停止服務了。

## 部署

1. 在這個資料夾底下執行 `npm install`，再執行 `npx wrangler login`。
2. 建立資料庫，把輸出的 `database_id` 填進 `wrangler.jsonc`：

   ```bash
   npx wrangler d1 create first-notes
   ```

3. 建立資料表：

   ```bash
   npm run db:migrate:remote
   ```

4. 部署：

   ```bash
   npm run deploy
   ```

5. 在遊戲的「設定」頁填入部署後的網址，按「測試連線」確認可以連上。

## 結構

| 檔案 | 用途 |
|---|---|
| `src/index.ts` | API 入口：每日題目、成績、排行榜、開房間 |
| `src/room.ts` | 多人房間（每間房是一個 Durable Object，用 WebSocket 連線） |
| `src/categories.ts` | 每日挑戰的分類與對應的歌單、搜尋關鍵字 |
| `src/validate.ts` | 檢查客戶端送來的資料 |
| `migrations/` | D1 資料表 |

改了 `src/categories.ts` 之後重新部署就會生效，玩家不用更新 app。

## 本機開發

```bash
npm run db:migrate:local && npm run dev
```

伺服器會跑在 `http://127.0.0.1:8787`，在遊戲的「設定」頁把伺服器網址改成這個就能測試。
