#!/usr/bin/env node
/**
 * tripo-fetch.mjs — скачивание модели из Tripo Studio (studio.tripo3d.ai)
 *
 * Что делает:
 *   1. Дёргает тот же эндпоинт, что и веб-приложение Studio при открытии
 *      /workspace/generate/<project-id>:
 *          GET https://api.tripo3d.ai/v2/studio/project/detail/v3/<id>?locale=en
 *      В ответе лежит подписанная ссылка CDN `model_url` (формат может быть
 *      .glb, .fbx и т.д. — зависит от модели/пайплайна).
 *   2. Скачивает файл по этой ссылке в локальную папку.
 *
 * Зависимостей нет — только Node.js >= 18 (нужен встроенный fetch).
 *
 * Примеры:
 *   node tools/tripo-fetch.mjs https://studio.tripo3d.ai/workspace/generate/ea82c134-4ce8-4558-8922-6045de828ccf
 *   node tools/tripo-fetch.mjs ea82c134-4ce8-4558-8922-6045de828ccf -o ~/Models/tripo
 *   node tools/tripo-fetch.mjs <id> --info            # только метаданные, без скачивания
 *   node tools/tripo-fetch.mjs <id> --url-only        # только прямая ссылка CDN
 *   TRIPO_TOKEN=<jwt> node tools/tripo-fetch.mjs <id> # приватная модель
 *
 * Токен (для приватных моделей): открой studio.tripo3d.ai, F12 -> Network ->
 * любой запрос к api.tripo3d.ai -> Request Headers -> authorization: Bearer <...>
 */

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';

const API_BASE = process.env.TRIPO_API_BASE || 'https://api.tripo3d.ai';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const HELP = `
tripo-fetch — скачать модель из Tripo Studio по ссылке на проект

Использование:
  node tools/tripo-fetch.mjs <project-url | project-id> [опции]

Опции:
  -o, --out <dir>   Куда сохранять (по умолчанию ./tripo_models)
      --token <jwt> Логин-токен Tripo для приватных моделей (или env TRIPO_TOKEN)
      --info        Показать метаданные проекта и выйти
      --url-only    Показать прямую ссылку CDN и выйти (без скачивания)
      --extras      Дополнительно скачать исходную картинку и превью
  -h, --help        Справка
`;

function parseArgs(argv) {
  const o = { out: 'tripo_models', token: process.env.TRIPO_TOKEN, inputs: [] };
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
      case '--token':
        o.token = next();
        break;
      case '--info':
        o.info = true;
        break;
      case '--url-only':
        o.urlOnly = true;
        break;
      case '--extras':
        o.extras = true;
        break;
      default:
        if (a.startsWith('-')) throw new Error(`Неизвестная опция ${a}`);
        o.inputs.push(a);
    }
  }
  return o;
}

const projectId = (input) => {
  const m = String(input).match(UUID_RE);
  if (!m) throw new Error(`Не нашёл id проекта в "${input}"`);
  return m[0].toLowerCase();
};

async function fetchProject(id, token) {
  const url = `${API_BASE}/v2/studio/project/detail/v3/${id}?locale=en`;
  const headers = {
    'user-agent': UA,
    accept: 'application/json',
    origin: 'https://studio.tripo3d.ai',
    referer: 'https://studio.tripo3d.ai/',
    'x-tripo-device-id': randomUUID(),
  };
  if (token) headers.authorization = `Bearer ${String(token).replace(/^Bearer\s+/i, '')}`;

  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Неожиданный ответ API (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || body.code !== 0) {
    const hint = token
      ? ''
      : ' Похоже, модель приватная — нужен токен (--token или TRIPO_TOKEN).';
    throw new Error(`API Tripo вернул ${res.status} code=${body.code}: ${body.message}.${hint}`);
  }
  return body.data;
}

const modelUrlOf = (p) => p.model_url || p.operator?.model_url || '';

function info(p) {
  const op = p.operator || {};
  const gen = op.image_to_model || op.text_to_model || op.multiview_to_model || {};
  const flags = Object.entries(op)
    .filter(([k, v]) => k.startsWith('is_') && v === true)
    .map(([k]) => k.replace(/^is_/, ''));
  const rows = [
    ['Название', p.project_name],
    ['Автор', p.owner_name],
    ['Доступ', p.visibility],
    ['Тип', op.type || p.type],
    ['Версия модели', op.model_version || gen.model_version],
    ['Создано', op.created_at ? new Date(op.created_at * 1000).toISOString() : undefined],
    ['Промпт', gen.prompt],
    ['face_limit', gen.face_limit],
    ['Флаги', flags.join(', ') || '—'],
    ['model_url', modelUrlOf(p).split('?')[0] || '—'],
  ];
  for (const [k, v] of rows) if (v !== undefined && v !== null && v !== '') console.log(`  ${k}: ${v}`);
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`CDN ответил ${res.status} (ссылка могла истечь — запусти ещё раз)`);
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.inputs.length) {
    console.log(HELP.trim());
    process.exit(opts.help ? 0 : 2);
  }

  let failed = 0;
  for (const input of opts.inputs) {
    let id;
    try {
      id = projectId(input);
      console.log(`\n[${id}]`);
      const project = await fetchProject(id, opts.token);
      info(project);

      const url = modelUrlOf(project);
      if (!url) throw new Error('У проекта ещё нет модели (генерация не завершена?)');

      if (opts.info) continue;
      if (opts.urlOnly) {
        console.log(`\n${url}\n`);
        continue;
      }

      const dir = path.join(opts.out, `${id.slice(0, 8)}_${(project.project_name || 'model')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40)}`);
      await mkdir(dir, { recursive: true });

      const name = path.basename(new URL(url).pathname);
      const dest = path.join(dir, name);
      const size = await download(url, dest);
      console.log(`  ✓ ${dest}  (${(size / 1048576).toFixed(1)} MB)`);

      if (opts.extras) {
        const gen = project.operator?.image_to_model || project.operator?.text_to_model || {};
        const extras = [...(gen.generate_image || []), ...(project.cover_image || [])].filter(Boolean);
        for (const [i, u] of extras.entries()) {
          const f = path.join(dir, `extra_${i}${path.extname(new URL(u).pathname) || '.bin'}`);
          try {
            await download(u, f);
            console.log(`  ✓ ${f}`);
          } catch (e) {
            console.warn(`  пропустил extra_${i}: ${e.message}`);
          }
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
