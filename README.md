# First Notes

**在 Spotify 裡聽前奏猜歌。** 一開始只給你 1 秒，猜錯或跳過就多聽一點，越早猜中分數越高。可以用自己的歌單單人玩、每天挑戰排行榜，或開房間跟朋友即時對戰。

*Guess the song from short clips inside Spotify — solo with your own library, daily challenges with leaderboards, and real-time multiplayer rooms. A [Spicetify](https://spicetify.app) custom app.*

[![最新版本](https://img.shields.io/github/v/release/ray319129/first-notes)](https://github.com/ray319129/first-notes/releases/latest)
[![授權](https://img.shields.io/github/license/ray319129/first-notes)](LICENSE)

## 安裝

需要：
- [Spicetify](https://spicetify.app/docs/getting-started)
- **Spotify Premium**：要從指定的秒數開始播放，免費帳號做不到。

**Windows**（PowerShell）：

```powershell
iwr -useb https://raw.githubusercontent.com/ray319129/first-notes/main/install.ps1 | iex
```

**macOS／Linux**：

```bash
curl -fsSL https://raw.githubusercontent.com/ray319129/first-notes/main/install.sh | sh
```

裝好後，Spotify 左側會出現 **First Notes**。要更新到新版，再執行一次同一行指令就好。

<details>
<summary>手動安裝</summary>

1. 到 [Releases](https://github.com/ray319129/first-notes/releases/latest) 下載 `first-notes.zip`。
2. 解壓縮，把裡面的 `first-notes` 資料夾放進 Spicetify 的 CustomApps 資料夾：
   - Windows：`%appdata%\spicetify\CustomApps\`
   - macOS／Linux：`~/.config/spicetify/CustomApps/`
3. 執行：

   ```bash
   spicetify config custom_apps first-notes
   ```

   ```bash
   spicetify apply
   ```

</details>

<details>
<summary>移除</summary>

```bash
spicetify config custom_apps first-notes-
```

```bash
spicetify apply
```

</details>

## 怎麼玩

每題最多猜 6 次，可聽的片段長度依序是 **1 → 2 → 4 → 7 → 11 → 16 秒**。第 1 次就猜中得 6 分，第 6 次猜中得 1 分，6 次都沒猜中得 0 分。

| 格子 | 意思 |
|:-:|---|
| 🟩 | 猜中 |
| 🟨 | 歌名不對，但歌手對了 |
| 🟥 | 猜錯 |
| ⬛ | 跳過 |

同一首歌的單曲版、專輯版、重新發行版都算對。

### 自由遊玩

- **題庫**：可以混合「已按讚的歌曲」、自己的播放清單、任何專輯、歌手或公開清單。可以用搜尋找，也可以貼上分享連結。
- **作答方式**：
  - 自由輸入：打字時會跳出自動完成。
  - 選擇題：4／6／8 個選項。猜錯的選項會被換成新的，沒辦法用刪去法。
- **片段起點**：可以選從歌曲開頭，或隨機段落。
- **揭曉後**：可以從片段那裡繼續聽完，或一鍵加入已按讚。
- 最近出過的歌會盡量避開。無法播放的歌會自動換掉。
- 會在你電腦上記錄戰績：局數、得分率、最高分、連續天數、猜中分布。

### 每日挑戰

- 依曲風分類，每個分類每天 5 首，所有人同一組題目，台灣時間午夜換題。
- 排行榜分**日、週、月**三種，可以看單一分類或全部分類加總。
- 結算時可以複製 🟩🟨🟥 格子分享給朋友，不會洩漏答案。

### 多人連線

1. 一個人到「多人」分頁按「開新房間」，把 5 碼房號傳給朋友。
2. 朋友在「輸入房號」填好房號，按「加入」。一間房最多 8 人。
3. 每個人在「我的題庫」選自己的歌。房主設定規則：
   - 題庫要合併所有人的，或只用房主的
   - 題數、每題限時
   - 片段起點
   - 作答方式
4. 房主按「開始遊戲」，大家同時聽同一首歌，各自在自己的 Spotify 上作答。判定和計分都在伺服器端進行。

### 防作弊

- 遊戲中會隱藏歌名、封面、右側欄和播放控制列，並自動開啟私人聆聽。
- 偷按播放、拖進度條或換歌，都會被擋下來。
- 切出視窗的次數會公開在結算畫面。

## 常見問題

**Spotify 更新後 First Notes 不見了？**
Spotify 每次更新都會蓋掉 Spicetify 的修改，執行這行重新套用就好：

```bash
spicetify backup apply
```

**每日挑戰或多人連線打不開？**
到「設定」頁按「測試連線」，看是哪一段連不上。

**視窗標題還是會顯示正在播的歌名？**
工作列和 Alt+Tab 顯示的標題是 Spotify 原生程式設定的，擴充功能改不到。所以切出視窗才會被計次並公開。

**為什麼一定要 Premium？**
遊戲要從歌曲中間的指定秒數開始播放，免費帳號沒辦法這樣播。

## 隱私

- 自由遊玩完全在你的電腦上進行，不會上傳任何東西。
- 每日挑戰和多人連線會送到伺服器的資料只有：
  - Spotify 使用者名稱和顯示名稱
  - 每日挑戰的成績
  - 多人遊戲時你題庫裡的歌曲資訊（歌名、歌手、封面網址）
- 多人房間的資料會在遊戲結束 2 小時後自動刪除。

## 開發者

- 想自己架伺服器：見 [server/README.md](server/README.md)
- 想從原始碼建置：見 [app/README.md](app/README.md)

## 授權

[MIT](LICENSE)

First Notes 是非官方的社群作品，跟 Spotify 沒有關係，也沒有得到 Spotify 的認可。
