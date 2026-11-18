#!/usr/bin/env node
/**
 * meshy-fetch.mjs — скачать модель Meshy (meshy.ai) по публичной ссылке
 *
 * Как это устроено у Meshy (ноябрь 2026):
 *   Публичная страница /3d-models/<slug>-<task-id> отдаёт анониму не GLB, а
 *   зашифрованный файл `model.meshy` (магия "MESHY.AI"). Его расшифровывает
 *   в браузере сам вьювер через mesh_loader.wasm.
 *   Метаданные (и подписанный modelUrl) лежат в публичном task-API:
 *       GET https://www.meshy.ai/meshyd-api/web/public/v2/tasks/<task-id>
 *
 * Что делает скрипт:
 *   1. вытаскивает task-id из ссылки /s/<code> (через редирект) или /3d-models/...;
 *   2. читает task-API -> result.generate.modelUrl (или texture/generate/...);
 *   3. скачивает asset (model.meshy или сразу .glb), проверяет магию;
 *   4. если это .meshy — расшифровывает через mesh_loader.wasm (--decrypt);
 *   5. валидирует GLB-контейнер (магия glTF, версия, длина).
 *
 * Зависимостей нет. Нужен Node >= 18; для --decrypt ещё интернет (wasm тянется
 * с сайта Meshy один раз и кешируется в ~/.cache/meshy-glb).
 *
 * Примеры:
 *   node tools/meshy-fetch.mjs https://www.meshy.ai/s/FWTYRX
 *   node tools/meshy-fetch.mjs https://www.meshy.ai/3d-models/Floating-Santa-Suit-01a1ec88-... --info
 *   node tools/meshy-fetch.mjs https://www.meshy.ai/s/FWTYRX -o ~/Downloads/meshy --decrypt
 *   node tools/meshy-fetch.mjs <task-id> --url-only
 *
 * Только для моделей, которые вы создали или которые опубликованы под свободной
 * лицензией (у этой — CC BY 4.0). Соблюдайте ToS Meshy.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// Переопределяемо для тестов/зеркал: MESHY_BASE, MESHY_LOADER_BASE, MESHY_LOADER_CACHE
const BASE = (process.env.MESHY_BASE || 'https://www.meshy.ai').replace(/\/$/, '');
const TASK_API = `${BASE}/meshyd-api/web/public/v2/tasks/`;
const LOADER_BASE = (process.env.MESHY_LOADER_BASE || `${BASE}/resource/decrypt/`).replace(/\/?$/, '/');
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SECTIONS = ['texture', 'generate', 'remesh', 'draft', 'stylize', 'animate'];

const HELP = `
meshy-fetch — скачать модель Meshy по публичной ссылке

Использование:
  node tools/meshy-fetch.mjs <share-ссылка | ссылка на /3d-models/... | task-id> [опции]

Опции:
  -o, --out <dir>   Куда сохранять (по умолчанию ./meshy_models)
      --info        Только метаданные (промпт, полигоны, лицензия, ссылки)
      --url-only    Только подписанную ссылку на ассет
      --decrypt     Расшифровать .meshy -> .glb через mesh_loader.wasm (нужен интернет)
      --no-validate Не проверять GLB-контейнер
  -h, --help        Справка
`;

function parseArgs(argv) {
  const o = { out: 'meshy_models', inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} требует значения`);
      return argv[++i];
    };
    switch (a) {
      case '-h':
      case '--help':
        o.help = true;
        break;
      case '-o':
      case '--out':
        o.out = next().replace(/^~(?=$|\/)/, os.homedir());
        break;
      case '--info':
        o.info = true;
        break;
      case '--url-only':
        o.urlOnly = true;
        break;
      case '--decrypt':
        o.decrypt = true;
        break;
      case '--no-validate':
        o.noValidate = true;
        break;
      default:
        if (a.startsWith('-')) throw new Error(`Неизвестная опция ${a}`);
        o.inputs.push(a);
    }
  }
  return o;
}

// /s/FWTYRX — короткая ссылка, task-id виден только после редиректа.
async function resolveInput(input) {
  let url = input;
  if (!/^https?:/i.test(url)) {
    if (UUID_RE.test(url)) return { taskId: url.match(UUID_RE)[0].toLowerCase(), page: null };
    url = `${BASE}/s/${url.replace(/^.*\/s\//, '')}`;
  }
  const direct = url.match(UUID_RE);
  if (direct) return { taskId: direct[0].toLowerCase(), page: url };
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  const finalUrl = res.url || url;
  const m = finalUrl.match(UUID_RE);
  if (!m) throw new Error(`Не нашёл task-id после перехода на ${finalUrl}`);
  return { taskId: m[0].toLowerCase(), page: finalUrl };
}

async function fetchTask(taskId) {
  const res = await fetch(TASK_API + taskId, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Неожиданный ответ task-API (${res.status}): ${text.slice(0, 160)}`);
  }
  if (body.code && body.code !== 'OK') throw new Error(`task-API: ${body.code}`);
  if (!body.result) throw new Error('task-API не вернул result');
  return body.result;
}

function pickModel(task) {
  const result = task.result || {};
  for (const s of SECTIONS) {
    const u = (result[s] || {}).modelUrl;
    if (u) return { url: u, section: s };
  }
  const args = task.args || {};
  for (const s of Object.keys(args)) {
    const u = (args[s] || {}).modelUrl;
    if (u) return { url: u, section: `args.${s}` };
  }
  throw new Error('В задаче нет modelUrl (модель ещё генерируется или удалена)');
}

function printInfo(task, picked) {
  const args = task.args || {};
  const gen = args.generate || args.draft || {};
  const rows = [
    ['Название', task.name],
    ['Автор', task.author?.nickname],
    ['Статус', task.status],
    ['Создано', task.createdAt ? new Date(task.createdAt).toISOString() : undefined],
    ['Режим / модель', [task.mode, gen.aiModel || gen.modelType].filter(Boolean).join(' · ')],
    ['Промпт', gen.prompt],
    ['Топология', task.topology],
    ['Полигоны', [task.faceCount ?? task.triangleCount, 'faces /', task.vertexCount, 'verts'].join(' ')],
    ['Целевой polycount', gen.targetPolycount],
    ['Лицензия', task.license],
    ['Скачиваний', task.downloads],
    ['AABB', Array.isArray(task.aabb) ? task.aabb.map((n) => +n.toFixed(3)).join(', ') : undefined],
    ['printability', task.result?.printability ? `${task.result.printability.status} (issues: ${task.result.printability.issueCount})` : undefined],
    ['Источник модели', picked ? `${picked.section}` : '—'],
    ['model_url', picked ? picked.url.split('?')[0] : '—'],
  ];
  for (const [k, v] of rows) if (v !== undefined && v !== null && v !== '') console.log(`  ${k}: ${v}`);

  const images = [];
  if (gen.imageUrl) images.push(['входное изображение', gen.imageUrl, 'input_image']);
  if (task.result?.previewUrl) images.push(['превью', task.result.previewUrl, 'preview']);
  if (task.result?.previewLogoUrl)
    images.push(['превью с водяным знаком', task.result.previewLogoUrl, 'preview_watermark']);
  for (const [k, u] of images) console.log(`  ${k}: ${u.split('?')[0]}`);
  return images;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (res.status === 403) throw new Error('403: подписанная ссылка истекла — запусти скрипт ещё раз (он перезапросит task-API)');
  if (!res.ok) throw new Error(`CDN ответил ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    done += c.length;
    const now = Date.now();
    if (now - last < 250 && done !== total) return;
    last = now;
    const mb = (n) => (n / 1048576).toFixed(1);
    process.stdout.write(`\r  ${mb(done)}${total ? ` / ${mb(total)}` : ''} MB   `);
  });
  await pipeline(body, createWriteStream(dest));
  process.stdout.write('\n');
  return (await stat(dest)).size;
}

function validateGlb(buf) {
  if (buf.length < 20 || buf.subarray(0, 4).toString() !== 'glTF')
    throw new Error('не GLB: нет магии glTF');
  const version = buf.readUInt32LE(4);
  const declared = buf.readUInt32LE(8);
  if (version !== 2) throw new Error(`неизвестная версия glTF: ${version}`);
  if (declared !== buf.length)
    throw new Error(`файл обрезан: заголовок обещает ${declared} байт, получено ${buf.length}`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.subarray(16, 20).toString() !== 'JSON') throw new Error('первый чанк не JSON');
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return {
    generator: doc.asset?.generator,
    meshes: doc.meshes?.length || 0,
    materials: doc.materials?.length || 0,
    textures: doc.textures?.length || 0,
  };
}

// --- расшифровка .meshy через mesh_loader.wasm (как делает вьювер Meshy) ------
function signature(hostname, timestamp) {
  const M = BigInt('0xFFFFFFFFFFFFFFFF');
  let r = BigInt('14695981039346656037');
  const prime = BigInt('1099511628211');
  const data = `${hostname}:${timestamp}` + 'Meshy_Crypto_Key';
  for (let i = 0; i < data.length; i++) {
    r ^= BigInt(data.charCodeAt(i));
    r = (r * prime) & M;
  }
  r ^= r >> BigInt(33);
  r = (r * BigInt('0xff51afd7ed558ccd')) & M;
  r ^= r >> BigInt(33);
  r = (r * BigInt('0xc4ceb9fe1a85ec53')) & M;
  r ^= r >> BigInt(33);
  return r.toString(16).padStart(16, '0');
}

async function ensureLoader() {
  const dir = process.env.MESHY_LOADER_CACHE || path.join(os.homedir(), '.cache', 'meshy-glb');
  await mkdir(dir, { recursive: true });
  const files = [
    ['mesh_loader.js', null],
    ['mesh_loader.wasm', Buffer.from([0x00, 0x61, 0x73, 0x6d])],
  ];
  const paths = {};
  for (const [name, magic] of files) {
    const p = path.join(dir, name);
    let ok = false;
    try {
      const buf = await readFile(p);
      ok = buf.length > 0 && (!magic || buf.subarray(0, magic.length).equals(magic));
    } catch {}
    if (!ok) {
      process.stdout.write(`  загружаю ${name} ...\n`);
      const res = await fetch(LOADER_BASE + name, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`не смог скачать ${name}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (magic && !buf.subarray(0, magic.length).equals(magic))
        throw new Error(`${name}: неверная сигнатура`);
      await writeFile(p, buf);
    }
    paths[name] = p;
  }
  return { js: paths['mesh_loader.js'], wasm: paths['mesh_loader.wasm'] };
}

async function decrypt(meshyBuf, { js, wasm }) {
  const hostname = 'www.meshy.ai';
  const timestamp = Date.now();
  const { default: init } = await import(pathToFileURL(js).href);
  const mod = await init({ locateFile: (p) => (p.endsWith('.wasm') ? wasm : p) });
  if (!mod.authorize(hostname, timestamp, signature(hostname, timestamp)))
    throw new Error('WASM authorize() отклонил подпись');
  const res = mod.processMeshyFile(new Uint8Array(meshyBuf));
  if (!res || !res.success || !res.data) throw new Error(`processMeshyFile: ${res?.error || 'unknown'}`);
  return Buffer.from(res.data.buffer, res.data.byteOffset, res.data.byteLength);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.inputs.length) {
    console.log(HELP.trim());
    process.exit(opts.help ? 0 : 2);
  }

  let failed = 0;
  for (const input of opts.inputs) {
    try {
      const { taskId } = await resolveInput(input);
      console.log(`\n[${taskId}]`);
      const task = await fetchTask(taskId);
      const picked = opts.info || opts.urlOnly ? (() => { try { return pickModel(task); } catch { return null; } })() : pickModel(task);
      const images = printInfo(task, picked);

      if (opts.info) {
        if (opts.urlOnly && picked) console.log(`\n${picked.url}\n`);
        continue;
      }
      if (opts.urlOnly) {
        console.log(`\n${picked.url}\n`);
        continue;
      }

      const slug = (task.name || 'model').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 40);
      const dir = path.join(opts.out, `${taskId.slice(0, 8)}_${slug}`);
      await mkdir(dir, { recursive: true });

      const name = path.basename(new URL(picked.url).pathname);
      const raw = path.join(dir, name);
      const size = await download(picked.url, raw);
      console.log(`  ✓ ${raw}  (${(size / 1048576).toFixed(1)} MB)`);

      let buf = await readFile(raw);
      let outFile = raw;
      if (buf.subarray(0, 8).toString() === 'MESHY.AI' && opts.decrypt) {
        console.log('  расшифровываю .meshy -> .glb ...');
        const loader = await ensureLoader();
        buf = await decrypt(buf, loader);
        outFile = path.join(dir, `${slug || 'model'}.glb`);
        await writeFile(outFile, buf);
        console.log(`  ✓ ${outFile}`);
      } else if (buf.subarray(0, 8).toString() === 'MESHY.AI') {
        console.log('  ! это зашифрованный .meshy — добавь --decrypt, чтобы получить .glb');
      }

      if (!opts.noValidate) {
        const head = buf.subarray(0, 4).toString();
        if (head === 'glTF') {
          const info = validateGlb(buf);
          console.log(
            `  GLB ok: ${info.meshes} mesh, ${info.materials} material, ${info.textures} texture (${info.generator || 'n/a'})`,
          );
        } else if (head.startsWith('MESHY')) {
          console.log('  GLB-валидация пропущена: файл зашифрован');
        } else {
          await stat(outFile);
        }
      }

      for (const [label, u, stem] of images) {
        const f = path.join(dir, `${stem}${path.extname(new URL(u).pathname) || '.bin'}`);
        try {
          await download(u, f);
          console.log(`  ✓ ${f}`);
        } catch (e) {
          console.warn(`  пропустил ${label}: ${e.message}`);
        }
      }
    } catch (e) {
      failed++;
      console.error(`  ОШИБКА: ${e.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
