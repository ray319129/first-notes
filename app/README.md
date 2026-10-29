# First Notes app

Spicetify 自訂 app 的原始碼，用 [Spicetify Creator](https://github.com/spicetify/creator) 建置。

## 建置

```bash
npm install && npm run build && spicetify refresh -a
```

`npm run build` 會直接輸出到 Spicetify 的 CustomApps 資料夾。第一次建置後，要先執行 `spicetify config custom_apps first-notes` 和 `spicetify apply` 註冊這個 app。

## 結構

| 資料夾 | 用途 |
|---|---|
| `src/game/` | 自由遊玩：出題、播放片段、判定、統計 |
| `src/daily/` | 每日挑戰與排行榜 |
| `src/multi/` | 多人連線 |
| `src/net/` | 跟伺服器溝通的 API 與共用型別 |

判定和計分的邏輯（`src/game/engine.ts`、`text.ts`）跟伺服器共用。

## 發行新版

1. 改 `package.json` 的版本號。
2. 推 `v*` 標籤（例如 `v0.2.0`）。

GitHub Actions 會用 `npm run build-release` 建置，並把 `first-notes.zip` 附到 Release 上。
