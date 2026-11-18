# Meshy: где лежит модель и как её скачать (ноябрь 2026)

## Твоя ссылка

`https://www.meshy.ai/s/FWTYRX` → редирект на
`https://www.meshy.ai/3d-models/Floating-Santa-Suit-01a1ec88-7fca-7797-9bfa-cf24fa191c59`

Task-id: **`01a1ec88-7fca-7797-9bfa-cf24fa191c59`**

### Что за модель (из публичного task-API)

| | |
|---|---|
| Название | Floating Santa Suit |
| Автор | lordofninjago |
| Создано | 2026-11-18 02:42 UTC |
| Статус | SUCCEEDED |
| Тип | draft (`mode: draft`), модель **venus-t2p5** (Meshy **T2.5**) |
| Промпт | `Floating Santa Suit`, seed 42973548, symmetry 0 |
| Топология | triangle, **21 049** треугольников / **10 540** вершин (цель 20 000) |
| Текстуры | нет: `result.texture = null`, текстурирование не запускалось |
| Лицензия | **CC BY 4.0** (можно использовать, нужна атрибуция) |
| Габариты (AABB) | ≈ 0.93 × 0.95 × 0.51, по центру около нуля |
| Printability | **error**, 4 проблемы (1 ошибка, 3 предупреждения) → как есть не для печати |
| Превью | `api.meshy.ai/misc/cdn-images/.../output/preview.png` (+ версия с водяным знаком) |

---

## Где физически лежит файл

```
https://www.meshy.ai/meshyd-api/web/public/v2/tasks/01a1ec88-…      ← публичный JSON, без токена
        └─ result.generate.modelUrl
             └─ https://api.meshy.ai/misc/cdn-models/<user>/tasks/<task>/output/model.meshy?sign=1795132800-<hash>
```

* `sign=1795132800` — это Unix-время **2026-11-20 00:00 UTC**, т.е. подписанная ссылка живёт ~1.5 суток.
  (Плюс общее правило Meshy: на планах кроме Enterprise файлы хранятся 3 дня.)
* Есть ещё `result.generate.quadJsonUrl` → `assets.meshy.ai/.../output/model.json` (quad-топология, CloudFront-подпись `Expires=…&Signature=…`).
* Никакого `.glb` в ответе **нет** — и это главное изменение.

## Почему «скачать .glb» больше не работает напрямую

1. **Файл теперь зашифрован.** Meshy отдаёт анониму контейнер с магией `MESHY.AI` (`model.meshy`).
   Вьювер на странице расшифровывает его **в браузере** через `mesh_loader.wasm`
   (`https://www.meshy.ai/resource/decrypt/mesh_loader.{js,wasm}`), вызывая
   `authorize(hostname, timestamp, signature)`, где signature — хеш от
   `"www.meshy.ai:<ts>"` с ключом `Meshy_Crypto_Key`.
   Поэтому «F12 → Network → glb → F5» ничего не найдёт: запросы называются `model.meshy`,
   а расшифровка идёт внутри WASM-воркера, в Network её не видно.
2. **Кнопки Download/GLB/FBX/OBJ — только для залогиненных и (часто) платных.** Анонимной странице
   они не отдаются вообще.
3. Ссылки на ассеты подписанные и протухают — старая ссылка из истории Network даёт 403.
4. Официальный API (`api.meshy.ai/openapi/...`, ключ `msy_...`) возвращает уже распакованный
   `model_urls: { glb, fbx, obj }`, но **только для задач твоего аккаунта**, не для чужих публичных ссылок.

---

## Как скачать — 3 варианта

### 1. Скрипт `tools/meshy-fetch.mjs` (рекомендую)

Без зависимостей, Node ≥ 18. Сам повторяет путь вьювера Meshy: короткая ссылка → редирект →
task-API → ассет → расшифровка через `mesh_loader.wasm` → проверка GLB.

```bash
node tools/meshy-fetch.mjs https://www.meshy.ai/s/FWTYRX --decrypt -o ~/Downloads/meshy
```

```
  -o, --out <dir>   куда сохранять (по умолчанию ./meshy_models)
      --info        только метаданные (промпт, полигоны, лицензия, ссылки)
      --url-only    только подписанная ссылка на ассет
      --decrypt     расшифровать .meshy -> .glb (wasm тянется один раз в ~/.cache/meshy-glb)
      --no-validate не проверять GLB-контейнер
```

Результат: `<out>/01a1ec88_floating_santa_suit/` — `floating_santa_suit.glb`,
рядом `model.meshy` (исходник), `input_image.png`, `preview.png`.
Если GLB уже не зашифрован (бывает на новых задачах), скрипт просто сохранит его как есть.

### 2. Без установки: браузерная консоль + веб-декриптор

На странице модели, F12 → Console:

```js
const id = location.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)[0];
const t = await (await fetch(`https://www.meshy.ai/meshyd-api/web/public/v2/tasks/${id}`)).json();
const r = t.result.result;
const u = r.generate?.modelUrl || Object.values(r).find(s => s && s.modelUrl)?.modelUrl;
console.log(u);           // подписанная ссылка ~1.5 суток
window.open(u, '_blank'); // скачается model.meshy
```

Получишь зашифрованный `model.meshy`. Дальше либо
* скормить его `tools/meshy-fetch.mjs` (он умеет `--decrypt`), либо
* воспользоваться готовым клиентским инструментом вроде **savemesh.com** (вставляет ссылку meshy/tripo → отдаёт .glb)
  или CLI `github.com/Shuvam-Banerji-Seal/meshy-glb-downloader`
  (`uvx --from git+https://github.com/…  meshy-glb "<url>" -o model.glb`).

### 3. Официально, со своего аккаунта

* Залогиниться в Meshy → карточка модели → **Download** (GLB/FBX/OBJ/USDZ/STL) — для своих моделей.
* Или через API: `GET https://api.meshy.ai/openapi/v1/<task-type>/<id>` с `Authorization: Bearer <API key>`
  → `model_urls.glb` (плюс `fbx`, `obj`), ссылки живут 3 дня.

---

## Что дальше с этой моделью

* **GLB** импортируется в Blender (glTF 2.0), Unity/Unreal/Godot, three.js — 21k треугольников, лёгкая.
* Текстуры нет: это «голая» геометрия из draft-прохода. Чтобы получить PBR — в Meshy нужен шаг
  **Texture** (или локально: UV → procedural/трипланар в Blender).
* **Printability = error** — есть незакрытая геометрия/тонкие места. Для печати: Blender →
  Voxel Remesh / 3D-Print Toolbox → «Make Manifold», потом STL.
* Лицензия **CC BY 4.0**: при публикации укажи автора `lordofninjago` и ссылку на модель.

> Скрипт проверен на локальном моке (короткая ссылка → редирект → task-API → скачивание →
> расшифровка через тестовый loader → валидация GLB). Доступа к самому meshy.ai из песочницы нет,
> поэтому боевой прогон — на твоей машине.
