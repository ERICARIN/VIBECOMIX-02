#!/bin/bash
# macOS / Linux: двойной клик (или ./Model-Get.command). Нужен Node.js >= 18.
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Поставь с https://nodejs.org (нужна версия 18 или новее)."
  read -r -p "Enter — закрыть..." _
  exit 1
fi
node tools/model-get.mjs "$@"
