#!/usr/bin/env node
/**
 * meshy-get.mjs — «вставь ссылку Meshy и получи файл».
 *
 * Один файл, без зависимостей (Node >= 18). Поднимает локальный веб-интерфейс:
 *   - вставляешь одну или несколько ссылок (www.meshy.ai/s/XXXX, /3d-models/... или task-id);
 *   - жмёшь «Скачать»;
 *   - скрипт сам: редирект короткой ссылки -> task-API -> скачивание ассета ->
 *     расшифровка model.meshy через mesh_loader.wasm -> валидация GLB;
 *   - файл кладётся в папку (по умолчанию ~/Downloads/meshy) и сразу отдаётся
 *     браузеру как обычное скачивание.
 *
 * Запуск:
 *   node tools/meshy-get.mjs
 *   node tools/meshy-get.mjs --port 7900 --no-open
 *   node tools/meshy-get.mjs --out "/Users/me/Models/Meshy"
 *
 * Поддерживается и просто CLI-режим (без окна):
 *   node tools/meshy-get.mjs "https://www.meshy.ai/s/FWTYRX"
 *
 * FBX: если в системе есть Blender (`blender` в PATH или BLENDER=/path), в интерфейсе
 * появится выбор FBX — конвертация идёт локально через Blender. Без Blender остаётся GLB
 * (это родной формат Meshy; GLB открывают Blender, Unity, Unreal, Godot, three.js).
 */

import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ─── настройки / окружение ──────────────────────────────────────────────────
const BASE = (process.env.MESHY_BASE || 'https://www.meshy.ai').replace(/\/$/, '');
const TASK_API = `${BASE}/meshyd-api/web/public/v2/tasks/`;
const LOADER_BASE = (process.env.MESHY_LOADER_BASE || `${BASE}/resource/decrypt/`).replace(/\/?$/, '/');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SECTIONS = ['texture', 'generate', 'remesh', 'draft', 'stylize', 'animate'];

function parseArgv(argv) {
  const o = { port: 7878, open: true, host: process.env.MESHY_HOST || '127.0.0.1', links: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--port') o.port = Number(next());
    else if (a === '--out' || a === '-o') o.out = next();
    else if (a === '--host') o.host = next();
    else if (a === '--no-open') o.open = false;
    else if (a === '--fbx') o.fbx = true;
    else if (a.startsWith('-')) throw new Error(`Неизвестная опция ${a}`);
    else o.links.push(a);
  }
  return o;
}

const HELP = `
meshy-get — вставь ссылку Meshy, получи GLB

  node tools/meshy-get.mjs                 открыть окно в браузере (обычный режим)
  node tools/meshy-get.mjs <ссылка> [...]  скачать сразу, без окна
  node tools/meshy-get.mjs --fbx <ссылка>  ещё и FBX (нужен установленный Blender)

Опции:
  --port <n>    порт локального сервера (по умолчанию 7878)
  -o, --out <dir> папка для файлов (по умолчанию ~/Downloads/meshy)
  --host <h>    адрес прослушивания (по умолчанию 127.0.0.1)
  --no-open     не открывать браузер автоматически
  --fbx         конвертировать в FBX через Blender, если он найден
  -h, --help    эта справка

Переменные окружения: MESHY_OUT, BLENDER, MESHY_BASE.
`;

function defaultOutDir() {
  if (process.env.MESHY_OUT) return process.env.MESHY_OUT.replace(/^~(?=$|\/)/, os.homedir());
  const dl = path.join(os.homedir(), 'Downloads');
  return fs.existsSync(dl) ? path.join(dl, 'meshy') : path.join(process.cwd(), 'meshy_models');
}

// ─── поиск task-id ──────────────────────────────────────────────────────────
async function resolveLink(input) {
  let url = String(input)
    .trim()
    .replace(/^[<("'\s]+|[>)"'\s.,]+$/g, '');
  if (!url) throw new Error('пустая ссылка');
  if (!/^https?:/i.test(url)) {
    if (UUID_RE.test(url)) return { taskId: url.match(UUID_RE)[0].toLowerCase(), page: null };
    url = `${BASE}/s/${url.replace(/^.*\/s\//, '')}`;
  }
  const direct = url.match(UUID_RE);
  if (direct) return { taskId: direct[0].toLowerCase(), page: url };
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  } catch {
    throw new Error('не удалось соединиться с meshy.ai — проверь интернет/ VPN или правильность ссылки');
  }
  if (res.status === 404) throw new Error('страница не найдена (404) — проверь ссылку');
  const finalUrl = res.url || url;
  const m = finalUrl.match(UUID_RE);
  if (!m) throw new Error('в ссылке нет id задачи Meshy (ожидался .../s/XXXX или .../3d-models/<slug>-<uuid>)');
  // HTML может пригодиться как запасной источник modelUrl
  let html = null;
  try {
    html = await res.text();
  } catch {}
  return { taskId: m[0].toLowerCase(), page: finalUrl, html };
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
    throw new Error(`task-API вернул не JSON (HTTP ${res.status})`);
  }
  if (body.code && body.code !== 'OK') throw new Error(`task-API: ${body.code}`);
  if (!body.result) throw new Error('задача не найдена');
  return body.result;
}

function pickModel(task, html) {
  const result = task.result || {};
  for (const s of SECTIONS) {
    const u = (result[s] || {}).modelUrl;
    if (u) return { url: u, section: s };
  }
  for (const [k, v] of Object.entries(task.args || {})) {
    if (v && v.modelUrl) return { url: v.modelUrl, section: `args.${k}` };
  }
  if (html) {
    const m = html.match(/modelUrl\\?":\\?"(https:[^"\\]+model\.(?:meshy|glb)[^"\\]*)/);
    if (m) return { url: m[1].encode().decode('unicode_escape'), section: 'html' };
  }
  throw new Error('у задачи нет файла модели (ещё генерируется или удалена)');
}

// ─── сеть ───────────────────────────────────────────────────────────────────
async function fetchBuffer(url, onProgress) {
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': UA } });
  } catch {
    throw new Error('оборвалось соединение при скачивании файла — попробуй ещё раз');
  }
  if (res.status === 403)
    throw new Error('ссылка на файл истекла (403) — нажми «Скачать» ещё раз, скрипт перезапросит её у Meshy');
  if (!res.ok) throw new Error(`сервер файла ответил ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let done = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    done += c.length;
    onProgress?.(done, total);
    chunks.push(c);
  });
  await new Promise((resolve, reject) => {
    body.on('end', resolve);
    body.on('error', reject);
  });
  return Buffer.concat(chunks);
}

// ─── расшифровка .meshy (как это делает вьювер Meshy) ────────────────────────
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

let loaderPromise = null;
function ensureLoader() {
  loaderPromise ??= (async () => {
    const dir = process.env.MESHY_LOADER_CACHE || path.join(os.homedir(), '.cache', 'meshy-glb');
    await fsp.mkdir(dir, { recursive: true });
    const out = {};
    for (const [name, magic] of [
      ['mesh_loader.js', null],
      ['mesh_loader.wasm', Buffer.from([0x00, 0x61, 0x73, 0x6d])],
    ]) {
      const p = path.join(dir, name);
      let ok = false;
      try {
        const buf = await fsp.readFile(p);
        ok = buf.length > 0 && (!magic || buf.subarray(0, magic.length).equals(magic));
      } catch {}
      if (!ok) {
        const res = await fetch(LOADER_BASE + name, { headers: { 'user-agent': UA } });
        if (!res.ok) throw new Error(`не удалось загрузить ${name} (HTTP ${res.status})`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (magic && !buf.subarray(0, magic.length).equals(magic)) throw new Error(`${name} повреждён`);
        await fsp.writeFile(p, buf);
      }
      out[name] = p;
    }
    return { js: out['mesh_loader.js'], wasm: out['mesh_loader.wasm'] };
  })();
  return loaderPromise;
}

async function decryptMeshy(buf) {
  const { js, wasm } = await ensureLoader();
  const hostname = new URL(BASE).hostname || 'www.meshy.ai';
  const timestamp = Date.now();
  const { default: init } = await import(pathToFileURL(js).href);
  const mod = await init({ locateFile: (p) => (p.endsWith('.wasm') ? wasm : p) });
  if (!mod.authorize(hostname, timestamp, signature(hostname, timestamp)))
    throw new Error('декриптор Meshy отклонил подпись (изменился формат — попробуй позже)');
  const res = mod.processMeshyFile(new Uint8Array(buf));
  if (!res || !res.success || !res.data) throw new Error(`расшифровка не удалась: ${res?.error || 'unknown'}`);
  return Buffer.from(res.data.buffer, res.data.byteOffset, res.data.byteLength);
}

function checkGlb(buf) {
  if (buf.length < 20 || buf.subarray(0, 4).toString() !== 'glTF') throw new Error('результат не является GLB');
  const declared = buf.readUInt32LE(8);
  if (declared !== buf.length) throw new Error(`файл неполный (${buf.length} из ${declared} байт)`);
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return {
    generator: doc.asset?.generator || '',
    meshes: doc.meshes?.length || 0,
    materials: doc.materials?.length || 0,
    textures: doc.textures?.length || 0,
  };
}

// ─── Blender (необязательно, для FBX) ───────────────────────────────────────
function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const candidates =
    process.platform === 'win32'
      ? ['C:/Program Files/Blender Foundation/Blender 4.5/blender.exe', 'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe']
      : process.platform === 'darwin'
        ? ['/Applications/Blender.app/Contents/MacOS/Blender']
        : ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender'];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null; // «blender» в PATH проверяется при первом запуске
}

async function toFbx(glbPath, fbxPath, blenderBin) {
  const py = `
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=${JSON.stringify(glbPath)})
bpy.ops.export_scene.fbx(filepath=${JSON.stringify(fbxPath)}, embed_textures=True, path_mode='COPY')
`;
  await new Promise((resolve, reject) => {
    execFile(blenderBin, ['-b', '--python-expr', py], { timeout: 600_000 }, (err, _out, stderr) => {
      if (err) reject(new Error(`Blender: ${String(stderr || err.message).slice(-300)}`));
      else resolve();
    });
  });
  return fbxPath;
}

// ─── собственно скачивание ──────────────────────────────────────────────────
const files = new Map(); // token -> { path, name }

const slugify = (s, fb = 'model') =>
  (s || fb)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || fb;

async function grab(link, { outDir, wantFbx, progress }) {
  const { taskId, html } = await resolveLink(link);
  progress?.({ stage: 'task', message: 'читаю информацию о модели' });
  const task = await fetchTask(taskId);
  if (task.status && task.status !== 'SUCCEEDED' && task.status !== 'SUCCEEDED')
    progress?.({ stage: 'warn', message: `статус задачи: ${task.status}` });

  const picked = pickModel(task, html);
  const name = slugify(task.name || path.basename(new URL(picked.url).pathname, '.meshy'));
  const dir = path.join(outDir, `${taskId.slice(0, 8)}_${name}`);
  await fsp.mkdir(dir, { recursive: true });

  progress?.({ stage: 'download', message: 'скачиваю файл модели', pct: 0 });
  let buf = await fetchBuffer(picked.url, (done, total) =>
    progress?.({ stage: 'download', message: 'скачиваю файл модели', done, total, pct: total ? Math.round((done / total) * 100) : null }),
  );
  await fsp.writeFile(path.join(dir, 'source.meshy'), buf);

  let outPath;
  let info = null;
  if (buf.subarray(0, 8).toString() === 'MESHY.AI') {
    progress?.({ stage: 'decrypt', message: 'расшифровываю .meshy → .glb' });
    buf = await decryptMeshy(buf);
  }
  if (buf.subarray(0, 4).toString() === 'glTF') {
    info = checkGlb(buf);
    outPath = path.join(dir, `${name}.glb`);
    await fsp.writeFile(outPath, buf);
  } else {
    outPath = path.join(dir, `${name}.bin`);
    await fsp.writeFile(outPath, buf);
    throw new Error('файл получен, но это не GLB и не .meshy — сохранён как .bin');
  }

  let fbxPath = null;
  if (wantFbx) {
    progress?.({ stage: 'fbx', message: 'конвертирую в FBX через Blender' });
    const bin = findBlender();
    if (!bin) throw Object.assign(new Error('FBX: Blender не найден'), { glb: outPath, dir, info });
    fbxPath = await toFbx(outPath, path.join(dir, `${name}.fbx`), bin);
  }

  const size = (await fsp.stat(outPath)).size;
  const token = randomUUID();
  files.set(token, { path: outPath, name: `${name}.glb` });
  if (fbxPath) files.set(randomUUID(), { path: fbxPath, name: `${name}.fbx` });

  return {
    ok: true,
    taskId,
    title: task.name || name,
    dir,
    file: outPath,
    size,
    info,
    licence: task.license || '',
    polys: task.faceCount ?? task.triangleCount ?? null,
    verts: task.vertexCount ?? null,
    downloadUrl: `/file/${[...files.entries()].find(([, v]) => v.path === outPath)[0]}`,
    fbxUrl: fbxPath ? `/file/${[...files.entries()].find(([, v]) => v.path === fbxPath)[0]}` : null,
  };
}

// ─── веб-интерфейс ──────────────────────────────────────────────────────────
const PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meshy → GLB</title>
<style>
  :root{--bg:#0d0f14;--card:#161a22;--line:#252b36;--fg:#e8ecf3;--mut:#8b95a7;--acc:#6ea8ff;--ok:#4ade80;--err:#f87171}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#1a2333 0%,var(--bg) 60%);color:var(--fg);
       font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh}
  .wrap{max-width:820px;margin:0 auto;padding:40px 20px 80px}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-.02em}
  .sub{color:var(--mut);font-size:13px;margin-bottom:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  textarea{width:100%;min-height:96px;resize:vertical;background:#0f131a;color:var(--fg);
           border:1px solid var(--line);border-radius:10px;padding:12px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  textarea:focus{outline:none;border-color:var(--acc)}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
  button{background:var(--acc);color:#08101d;border:0;border-radius:10px;padding:10px 18px;font-weight:650;font-size:14px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
  .hint{color:var(--mut);font-size:12.5px}
  .out{margin-top:18px;display:grid;gap:10px}
  .item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
  .item.ok{border-color:#1f5136}
  .item.err{border-color:#5b2224}
  .t{font-weight:600;margin-bottom:2px;display:flex;gap:8px;align-items:center}
  .m{color:var(--mut);font-size:12.5px}
  .bar{height:6px;background:#0f131a;border-radius:99px;overflow:hidden;margin-top:8px}
  .bar>i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#6ea8ff);width:0;transition:width .2s}
  .dl{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:#1b2637;border:1px solid #2b3850;
      color:var(--fg);text-decoration:none;padding:8px 14px;border-radius:9px;font-weight:600;font-size:13.5px}
  code{background:#0f131a;border:1px solid var(--line);padding:1px 6px;border-radius:6px;font-size:12.5px}
  .tag{font-size:11px;padding:2px 8px;border-radius:99px;background:#1c2331;color:var(--mut);border:1px solid var(--line)}
  select{background:#0f131a;color:var(--fg);border:1px solid var(--line);border-radius:9px;padding:9px 12px;font-size:13.5px}
</style></head><body><div class="wrap">
  <h1>Meshy → GLB</h1>
  <div class="sub">Вставь ссылку на модель, нажми «Скачать». Файл сохранится в папку <code id="outdir"></code> и начнёт качаться в браузер.</div>
  <div class="card">
    <textarea id="links" placeholder="https://www.meshy.ai/s/FWTYRX&#10;https://www.meshy.ai/3d-models/My-Model-01a1ec88-...&#10;(можно несколько ссылок, по одной в строке)"></textarea>
    <div class="row">
      <button id="go">Скачать</button>
      <button id="clear" class="ghost">Очистить</button>
      <select id="fmt"><option value="glb">GLB (родной формат)</option><option value="fbx">GLB + FBX (нужен Blender)</option></select>
      <span class="hint" id="env"></span>
    </div>
  </div>
  <div class="out" id="out"></div>
</div>
<script type="application/json" id="cfg">__CFG__</script>
<script>
const CFG = JSON.parse(document.getElementById('cfg').textContent);
document.getElementById('outdir').textContent = CFG.out;
const out = document.getElementById('out');
const go = document.getElementById('go');
const fmt = document.getElementById('fmt');
const envEl = document.getElementById('env');
envEl.textContent = 'Blender: ' + CFG.blender;

function card(url){
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = '<div class="t"><span class="tag">ждёт</span><span class="ti"></span></div>'+
                 '<div class="m msg">в очереди…</div><div class="bar" style="display:none"><i></i></div>';
  el.querySelector('.ti').textContent = url.length > 70 ? url.slice(0,70)+'…' : url;
  el.dataset.url = url;
  out.prepend(el);
  return el;
}
function setMsg(el, text, cls){ const m = el.querySelector('.msg'); m.textContent = text; if(cls) msgCls(el, cls); }
function msgCls(el, cls){ const m = el.querySelector('.msg'); m.className = 'm msg ' + (cls||''); }

async function one(url){
  const el = card(url);
  const tag = el.querySelector('.tag');
  const bar = el.querySelector('.bar'), fill = el.querySelector('.bar>i');
  const poll = setInterval(async () => {
    try {
      const r = await fetch('/api/progress?url=' + encodeURIComponent(url));
      const p = await r.json();
      if (!p.state) return;
      if (p.state.stage === 'download' && p.state.total) {
        bar.style.display = 'block';
        fill.style.width = (p.state.done / p.state.total * 100) + '%';
      } else if (p.state.pct != null) {
        bar.style.display = 'block'; fill.style.width = p.state.pct + '%';
      }
      if (p.state.message) setMsg(el, p.state.message);
    } catch {}
  }, 400);
  try {
    const res = await fetch('/api/grab', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ url, fbx: fmt.value === 'fbx' })
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'ошибка');
    bar.style.display='none';
    el.classList.add('ok');
    tag.textContent = 'готово';
    const meta = [];
    if (d.polys) meta.push(d.polys.toLocaleString('ru-RU') + ' полигонов');
    if (d.verts) meta.push(d.verts.toLocaleString('ru-RU') + ' вершин');
    if (d.info) { meta.push(d.info.textures ? d.info.textures + ' текстур' : 'без текстур'); }
    if (d.licence) meta.push('лицензия ' + d.licence.toUpperCase());
    setMsg(el, (d.title ? d.title + ' · ' : '') + meta.join(' · '));
    const a = document.createElement('a');
    a.className='dl'; a.href = d.downloadUrl; a.textContent = '⬇ Скачать GLB (' + (d.size/1048576).toFixed(1) + ' МБ)';
    el.appendChild(a);
    if (d.fbxUrl) { const b=document.createElement('a'); b.className='dl'; b.style.marginLeft='8px'; b.href=d.fbxUrl; b.textContent='⬇ FBX'; el.appendChild(b); }
  } catch (e) {
    el.classList.add('err'); bar.style.display='none'; tag.textContent='ошибка';
    setMsg(el, e.message);
  } finally { clearInterval(poll); }
}

go.onclick = async () => {
  const urls = document.getElementById('links').value.split(/\\s+/).map(s=>s.trim()).filter(Boolean);
  if (!urls.length) return;
  go.disabled = true;
  for (const u of urls) { await one(u); }
  go.disabled = false;
};
document.getElementById('clear').onclick = () => { document.getElementById('links').value=''; out.innerHTML=''; };
document.getElementById('links').addEventListener('keydown', e => { if (e.key==='Enter' && (e.metaKey||e.ctrlKey)) go.click(); });
</script></body></html>`;

// прогресс по ссылке (для опроса из UI)
const progressMap = new Map();

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch {}
}

async function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP.trim());
    return;
  }
  const outDir = opts.out ? opts.out.replace(/^~(?=$|\/)/, os.homedir()) : defaultOutDir();
  await fsp.mkdir(outDir, { recursive: true });

  // CLI-режим: ссылки переданы аргументами
  if (opts.links.length) {
    let bad = 0;
    for (const link of opts.links) {
      console.log(`\n→ ${link}`);
      try {
        const r = await grab(link, {
          outDir,
          wantFbx: !!opts.fbx,
          progress: (p) => {
            if (p.stage === 'download' && p.total)
              process.stdout.write(`\r  ${(p.done / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} МБ   `);
            else if (p.message) process.stdout.write(`\r  ${p.message}…                    `);
          },
        });
        process.stdout.write('\r');
        console.log(`  ✓ ${r.file} (${(r.size / 1048576).toFixed(1)} МБ)`);
        if (r.info)
          console.log(`    ${r.info.meshes} mesh · ${r.info.materials} material · ${r.info.textures} texture`);
      } catch (e) {
        process.stdout.write('\r');
        console.error(`  ✗ ${e.message}`);
        bad++;
      }
    }
    process.exit(bad ? 1 : 0);
  }

  // GUI-режим
  const blender = findBlender();
  const cfg = JSON.stringify({
    out: outDir,
    blender: blender ? path.basename(blender) : 'не найден (только GLB)',
  }).replace(/</g, '\\u003c');
  const page = PAGE.replace('__CFG__', cfg);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page, 'text/html; charset=utf-8');

      if (req.method === 'GET' && url.pathname === '/api/progress')
        return send(res, 200, { state: progressMap.get(url.searchParams.get('url')) || null });

      if (req.method === 'POST' && url.pathname === '/api/grab') {
        const body = await readJson(req);
        const link = String(body.url || '');
        try {
          const result = await grab(link, {
            outDir,
            wantFbx: !!body.fbx,
            progress: (p) => progressMap.set(link, p),
          });
          progressMap.delete(link);
          return send(res, 200, result);
        } catch (e) {
          progressMap.delete(link);
          return send(res, 200, {
            ok: false,
            error: e.message,
            glb: e.glb || null,
            downloadUrl: e.glb && files.size ? `/file/${[...files.entries()].pop()[0]}` : null,
          });
        }
      }

      if (req.method === 'GET' && url.pathname.startsWith('/file/')) {
        const token = url.pathname.slice(6);
        const f = files.get(token);
        if (!f) return send(res, 404, 'файл не найден (перезапусти скрипт)');
        const stat = await fsp.stat(f.path);
        res.writeHead(200, {
          'content-type': f.name.endsWith('.fbx') ? 'application/octet-stream' : 'model/gltf-binary',
          'content-length': stat.size,
          'content-disposition': `attachment; filename="${encodeURIComponent(f.name)}"`,
        });
        return fs.createReadStream(f.path).pipe(res);
      }

      return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  });

  await new Promise((resolve) => server.listen(opts.port, opts.host, resolve));
  const local = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`;
  console.log(`\n  Meshy → GLB  ·  ${local}`);
  console.log(`  файлы: ${outDir}`);
  console.log(`  Blender: ${blender || 'не найден (FBX недоступен, GLB работает всегда)'}`);
  console.log('  Ctrl+C — выйти\n');
  if (opts.open) openBrowser(local);
}

main().catch((e) => {
  console.error('Ошибка запуска:', e.message);
  process.exit(1);
});
