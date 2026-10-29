import React from "react";
import styles from "./css/game.module.css";
import { Daily } from "./daily/Daily";
import { Game } from "./game/Game";
import { APP_NAME } from "./game/engine";
import { Multi } from "./multi/Multi";
import { SettingsPage } from "./SettingsPage";

type Tab = "free" | "daily" | "multi" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "free", label: "自由遊玩" },
  { id: "daily", label: "每日挑戰" },
  { id: "multi", label: "多人" },
  { id: "settings", label: "設定" },
];

const App = () => {
  const [tab, setTab] = React.useState<Tab>("free");
  return (
    <div className={styles.container} id="first-notes-root">
      <header className={styles.header}>
        <h1 className={styles.title}>{APP_NAME}</h1>
        <nav className={styles.tabs}>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? styles.tabActive : styles.tab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {tab === "free" && <Game />}
      {tab === "daily" && <Daily />}
      {tab === "multi" && <Multi />}
      {tab === "settings" && <SettingsPage />}
    </div>
  );
};

export default App;
