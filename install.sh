#!/bin/sh
# First Notes 安裝腳本（macOS／Linux）。用法：
#   curl -fsSL https://raw.githubusercontent.com/ray319129/first-notes/main/install.sh | sh
# 會下載最新版、放進 Spicetify 的 CustomApps、註冊並套用。重新執行一次就是更新。
set -e
REPO="ray319129/first-notes"
NAME="first-notes"

command -v spicetify >/dev/null 2>&1 || { echo "找不到 spicetify，請先安裝：https://spicetify.app/docs/getting-started"; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "需要 unzip"; exit 1; }

APPS_DIR="$(spicetify path userdata)/CustomApps"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "下載最新版…"
curl -fsSL "https://github.com/$REPO/releases/latest/download/$NAME.zip" -o "$TMP/$NAME.zip"
unzip -q "$TMP/$NAME.zip" -d "$TMP"
mkdir -p "$APPS_DIR"
rm -rf "$APPS_DIR/$NAME"
mv "$TMP/$NAME" "$APPS_DIR/$NAME"

echo "註冊並套用…"
spicetify config custom_apps "$NAME"
spicetify apply
echo "安裝完成，Spotify 側邊欄會出現 First Notes。"
