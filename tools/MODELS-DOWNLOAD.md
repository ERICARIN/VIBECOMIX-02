# Скачивание моделей: Meshy + Tripo (ноябрь 2026)

Один инструмент на обе площадки: `tools/model-get.mjs`. Кидаешь ссылку — он сам понимает,
Meshy это или Tripo, и забирает файл.

## Быстрый старт

| ОС | Запуск |
|---|---|
| Windows | двойной клик `tools/Model-Get.cmd` |
| macOS / Linux | двойной клик `tools/Model-Get.command` |
| любой | `node tools/model-get.mjs` |

Откроется окно в браузере: вставляешь ссылки (можно несколько, по одной в строке) → **Скачать** →
прогресс → кнопка **⬇ Скачать <формат>**. Файл падает в папку (`~/Downloads/models` по умолчанию)
и одновременно отдаётся браузеру как обычная загрузка.

```bash
# CLI без окна
node tools/model-get.mjs "https://www.meshy.ai/s/FWTYRX" \
                         "https://studio.tripo3d.ai/workspace/generate/ea82c134-4ce8-4558-8922-6045de828ccf"

# самопроверка
node tools/model-get.mjs --doctor
```

## Какие ссылки понимаются

| Площадка | Ссылки |
|---|---|
| **Meshy** | `www.meshy.ai/s/XXXX`, `www.meshy.ai/3d-models/<slug>-<uuid>`, голый task-id |
| **Tripo** | `studio.tripo3d.ai/workspace/{generate,generate-image,segmentation,fill-parts,retopology,smart-uv,texture,texture-edit,texture-upscale,texture-pbr,rigging,animate}/<uuid>`, `studio.tripo3d.ai/3d-model/<uuid>`, `/s/<code>`, голый uuid |

Площадка определяется по домену, а если домен неизвестен (локальное зеркало, сокращалка) —
по структуре пути; в крайнем случае пробуются обе.

## Что происходит под капотом

**Meshy**
1. `/s/XXXX` → редирект → task-id;
2. `GET /meshyd-api/web/public/v2/tasks/<id>` → подписанный `modelUrl`;
3. скачивание `model.meshy` (зашифрован, магия `MESHY.AI`);
4. расшифровка через `mesh_loader.wasm` (кеш в `~/.cache/meshy-glb`), подпись —
   двухпроходный FNV-хеш: сначала `Meshy_Crypto_Key`, потом `host:timestamp`;
5. проверка GLB.

**Tripo**
1. `GET api.tripo3d.ai/v2/studio/project/detail/v3/<id>?locale=en` → `data.model_url`;
2. скачивание по подписанной ссылке CDN — **как есть**, без перекодирования.
   Tripo часто отдаёт `.fbx` (пайплайн Nexus) — файл сохраняется в своём формате;
3. если это GLB — проверка контейнера и показ статистики.

## Опции

```
-o, --out <dir>   папка для файлов      (по умолчанию ~/Downloads/models; env MODELS_OUT)
    --port <n>    порт локального сервера (по умолчанию 7878)
    --host <h>    адрес прослушивания     (по умолчанию 127.0.0.1)
    --no-open     не открывать браузер
    --fbx         дополнительно конвертировать в FBX (нужен Blender; только из GLB)
    --doctor      самопроверка
```

## Приватные модели Tripo

Публичные проекты читаются без авторизации. Для приватных нужен токен сессии:

1. открой Studio, F12 → Network → любой запрос к `api.tripo3d.ai`;
2. Request Headers → `authorization: Bearer eyJ...`;
3. положи в переменную окружения (без слова `Bearer`):

```bash
# Windows (cmd)
set TRIPO_TOKEN=eyJhbGci...
node tools\model-get.mjs "<ссылка>"

# PowerShell
$env:TRIPO_TOKEN="eyJhbGci..."
```

Токен живёт недолго — при ошибке авторизации скопируй свежий.

## Про FBX

* Tripo нередко отдаёт FBX сразу — тогда он и скачается, конвертация не нужна.
* Meshy всегда отдаёт GLB; если нужен именно FBX — нужен установленный Blender
  (`blender` в PATH или `BLENDER=/путь/к/blender`), конвертация идёт локально.
* Без Blender в интерфейсе честно написано «только GLB» — сам GLB открывается
  в Blender/Unity/Unreal/Godot/three.js.

## Диагностика

```bash
node tools/model-get.mjs --doctor
```

```
  OK   · Node.js >= 18 — у тебя 22.22.3
  OK   · папка для файлов доступна
  OK   · сеть до https://www.meshy.ai — HTTP 200
        декриптор: …\.cache\meshy-glb (js 42 КБ, wasm 118 КБ)
  OK   · декриптор Meshy скачан и цел
  OK   · подпись принята wasm (authorize) — hostname=www.meshy.ai
  OK   · API Tripo доступен — HTTP 200 · без токена (публичные модели)
 ВНИМ  · Blender для FBX — не найден — GLB всё равно работает
```

## Частые ошибки

| Сообщение | Что делать |
|---|---|
| «страница не найдена (404)» | проверить ссылку; модель могли удалить или снять с публикации |
| «у задачи/проекта нет файла модели» | генерация ещё идёт либо модель не опубликована |
| «ссылка на файл истекла (403)» | нажать «Скачать» ещё раз — ссылка будет перезапрошена |
| «API Tripo: ... нужен TRIPO_TOKEN» | модель приватная, см. раздел про токен |
| «не удалось соединиться с …» | интернет/VPN/блокировка |
| «декриптор Meshy отклонил подпись» | Meshy сменил формат — запустить `--doctor` и прислать вывод |

## Оговорки

* Скачивать можно только то, что вы создали, или публичные модели под свободной лицензией
  (у модели `Floating Santa Suit` — CC BY 4.0, нужна атрибуция автору `lordofninjago`).
* Подписанные ссылки Meshy живут ~1.5 суток (плюс лимит хранения 3 дня на планах кроме Enterprise);
  у Tripo ссылки тоже подписанные и с ограниченным сроком.
* Meshy отдаёт зашифрованный `.meshy`; расшифровка повторяет то, что делает их собственный вьювер
  в браузере. Это обходной путь, а не официальный API — при изменении формата инструмент может сломаться.
