# Как скачать модель из Tripo Studio (ноябрь 2026)

> **Универсальный вариант:** `tools/model-get.mjs` (или двойной клик по `Model-Get.cmd` / `Model-Get.command`)
> скачивает и Tripo, и Meshy — просто вставь ссылку. Ниже описан «сырой» способ и детали API.

## TL;DR для твоей модели

Проект: `ea82c134-4ce8-4558-8922-6045de828ccf` — **«purple frog 3d model»** (image→3D, Nexus-v2.0, 5000 граней, без текстуры).

```bash
# прямая ссылка на файл (подписанная, живёт ограниченное время)
node tools/tripo-fetch.mjs ea82c134-4ce8-4558-8922-6045de828ccf --url-only

# скачать файл + исходную картинку и превью
node tools/tripo-fetch.mjs ea82c134-4ce8-4558-8922-6045de828ccf --extras -o ~/Downloads/tripo
```

Или просто открой `https://studio.tripo3d.ai/workspace/generate/ea82c134-4ce8-4558-8922-6045de828ccf`,
затем в браузере:

```
https://api.tripo3d.ai/v2/studio/project/detail/v3/ea82c134-4ce8-4558-8922-6045de828ccf?locale=en
```

В JSON найди поле `data.model_url` — это и есть твой файл (подписанная ссылка на CDN).
Скопируй её в адресную строку → файл сохранится (или Ctrl+S).

---

## Почему старый трюк «F12 → Network → вбить glb → F5» больше не работает

Причин три, и они складываются:

1. **Файл теперь не `.glb`, а `.fbx`** (а часто — `*_meshopt.glb`).
   Studio переключилась на «Nexus mesh» пайплайн: сервер отдаёт `output_mesh_<uuid>.fbx`
   (у тебя именно так — `https://tripo-data.rg1.data.tripo3d.com/tripo-studio/20261118/6bccbc3e-…/output_mesh_6bccbc3e-….fbx`).
   Поиск по слову `glb` в Network просто ничего не находит — не потому что запроса нет, а потому что он называется иначе.
   Фильтр по `glb` искать бесполезно: сортируй по колонке **Size** и смотри самый большой файл.

2. **Модель теперь грузится сжатой**: `EXT_meshopt_compression` + `KHR_mesh_quantization`.
   Если это всё-таки `.glb`, он открывается не во всех вьюверах (Blender — только 4.x со свежим glTF-импортёром),
   и в Network он может отдаваться как `application/octet-stream` / `x-octet-stream`, а не как `model/gltf-binary` —
   поэтому фильтр по типу тоже не срабатывает.

3. **Запросы кешируются, а ссылки подписанные и одноразовые по времени.**
   Без галочки **Disable cache** и жёсткой перезагрузки (Ctrl+Shift+R) браузер берёт модель из кеша/IndexedDB
   и в Network ничего не появляется. Плюс CDN-ссылка — AWS-подписанная (`Key-Pair-Id`, `Policy`, `Signature`):
   она живёт до даты из `Policy`. Для твоей модели это **19 ноября 2026, 00:00 UTC**.
   Просроченная ссылка отдаёт 403 — скачать «старую» ссылку из истории Network уже не получится.

Отдельно: кнопка **Export/Download** в самом Studio теперь работает не через браузер, а через серверную конвертацию —
`POST https://api.tripo3d.ai/v2/studio/operation/export` (format: `gltf|fbx|obj|stl|usdz|3mf`, размер текстур, FBX-пресет).
Она привязана к аккаунту/тарифу и может списывать кредиты, поэтому «просто скачать то, что показано» через неё не всегда хочется.

---

## Актуальный способ (3 варианта)

### Вариант 1 — скрипт из этого репозитория (рекомендую)

`tools/tripo-fetch.mjs` — без зависимостей, Node ≥ 18.

```bash
node tools/tripo-fetch.mjs <ссылка-на-проект | project-id> [опции]

  -o, --out <dir>   куда сохранять (по умолчанию ./tripo_models)
      --token <jwt>  токен для приватных моделей (или env TRIPO_TOKEN)
      --info         только метаданные (промпт, версия, грани, флаги)
      --url-only     только прямая ссылка CDN
      --extras       ещё исходная картинка и превью
```

Что внутри: ровно тот же запрос, который делает веб-приложение Studio при открытии проекта —
`GET /v2/studio/project/detail/v3/<id>?locale=en` — затем скачивание `model_url`.

Приватные модели: открой Studio → F12 → Network → любой запрос к `api.tripo3d.ai` →
Request Headers → `authorization: Bearer eyJ...` → передай это значение в `--token` (или в `TRIPO_TOKEN=...`).
Токен живёт недолго, при ошибке авторизации скопируй новый.

### Вариант 2 — из консоли браузера (без Node)

Открой страницу модели в Studio, F12 → Console:

```js
const id = location.pathname.split('/').pop();
const d = await (await fetch(`https://api.tripo3d.ai/v2/studio/project/detail/v3/${id}?locale=en`)).json();
const u = d.data.model_url || d.data.operator?.model_url;
console.log(u);
window.open(u, '_blank');
```

Если файл открылся «текстом» — правый клик по странице → **Сохранить как…**.
(Атрибут `download` для ссылки на чужой домен браузер игнорирует, поэтому прячем через новую вкладку.)

### Вариант 3 — официально, через UI

В Studio: правая панель → **Export** → формат (GLB/FBX/OBJ/STL/USDZ/3MF) и размер текстур.
Конвертация идёт на серверах Tripo, результат кладётся в тот же CDN и скачивается браузером.
Может требовать платного плана / кредитов — у бесплатного аккаунта часто только «Download» исходного формата.

---

## Что делать с `.fbx` / `_meshopt.glb`

* `.fbx` — импортируется в Blender напрямую (File → Import → FBX). У твоей модели текстуры нет (`is_textured: false`, `is_pbr: false`), так что это просто сетка 5000 граней.
* `_meshopt.glb` — Blender 4.x понимает `EXT_meshopt_compression`; если нет, распакуй:
  ```bash
  npx @gltf-transform/cli copy in_meshopt.glb out.glb
  ```
  (та же операция: `optimize --compress false` / `decompress`).
* Конвертация в OBJ/STL/USDZ/3MF: `npx @gltf-transform/cli` (obj/stl) или Blender (`bpy`/UI).

---

## Где физически лежит файл

```
api.tripo3d.ai/v2/studio/project/detail/v3/<project-id>     ← метаданные + подписанный URL
        └─ data.model_url
             └─ https://tripo-data.rg1.data.tripo3d.com/tripo-studio/<YYYYMMDD>/<operator-uuid>/output_mesh_<operator-uuid>.fbx
                     ?Key-Pair-Id=…&Policy=…&Signature=…                  (подпись AWS CloudFront, истекает)
```

* `tripo-data.rg1.data.tripo3d.com` — приватный бакет, доступ только по подписи (ссылка = пароль).
* `tripo-data-public.rg1.data.tripo3d.com` — публичные превью (thumbnail/small/large).
* `operator-uuid` (`6bccbc3e-…` у тебя) — id конкретной генерации, project-id (`ea82c134-…`) — id проекта в Studio.
  Один проект = цепочка операций (generate → segment → retopo → texture → rig), у каждой свой `model_url`.
  Если ты делал текстуру/риг, нужен URL **последнего** оператора — он и лежит в `data.model_url`,
  а промежуточные видны в `data.operator`.

## Итог по «где сейчас лежит мой трипо-файл»

Нигде локально: файл в CDN Tripo, а браузер получает его по временной подписанной ссылке из API.
Поэтому «скачать из Network» работает только пока страница реально грузит модель (hard reload + disable cache),
и только если искать по размеру, а не по слову `glb`. Надёжнее — дёрнуть API-эндпоинт выше и забрать `model_url`.
