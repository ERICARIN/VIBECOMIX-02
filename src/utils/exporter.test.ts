import assert from 'node:assert/strict';
import test from 'node:test';
import { AppState, Frame } from '../types';
import { addRgbaFrameToGif, findSupportedVideoMimeType, loadGifencApi, resolveExportTargets } from './exporter';

function makeFrame(id: number, hidden = false): Frame {
  return {
    id,
    x: 20,
    y: 30,
    w: 120,
    h: 80,
    hidden,
    layers: [],
    borderWidths: {},
    strokeWidths: {},
  };
}

function makeState(): AppState {
  return {
    width: 800,
    height: 1100,
    borderColor: '#111111',
    borderWidth: 4,
    strokeColor: '#ffffff',
    strokeWidth: 3,
    pageBg: '#ffffff',
    currentPage: 1,
    pages: [
      { name: 'Cover', frames: [makeFrame(1)] },
      { name: 'Inside', frames: [makeFrame(2), makeFrame(3, true)] },
    ],
  };
}

test('all/current/frame scopes resolve to the intended page and frame', () => {
  const state = makeState();
  const all = resolveExportTargets(state, 'all', null);
  assert.deepEqual(all.map(({ pageIndex }) => pageIndex), [0, 1]);

  const current = resolveExportTargets(state, 'current', null);
  assert.equal(current.length, 1);
  assert.equal(current[0].pageIndex, 1);
  assert.equal(current[0].page.name, 'Inside');

  const frame = resolveExportTargets(state, 'frame', 2);
  assert.equal(frame.length, 1);
  assert.equal(frame[0].pageIndex, 1);
  assert.equal(frame[0].frame?.id, 2);
});

test('frame scope rejects missing, stale, hidden, or invalid selection', () => {
  const state = makeState();
  assert.throws(() => resolveExportTargets(state, 'frame', null), /сначала выберите фрейм/i);
  assert.throws(() => resolveExportTargets(state, 'frame', 1), /не найден/i);
  assert.throws(() => resolveExportTargets(state, 'frame', 3), /скрыт/i);
  state.pages[1].frames[0].vertices = [];
  assert.throws(() => resolveExportTargets(state, 'frame', 2), /недостаточно точек/i);
});

test('empty projects are rejected before export', () => {
  const state = makeState();
  state.pages = [];
  assert.throws(() => resolveExportTargets(state, 'all', null), /нет страниц/i);
});

test('video MIME selection never substitutes one container for another', () => {
  assert.equal(
    findSupportedVideoMimeType('webm', (mime) => mime === 'video/webm;codecs=vp8'),
    'video/webm;codecs=vp8',
  );
  assert.equal(
    findSupportedVideoMimeType('mp4', (mime) => mime.startsWith('video/webm')),
    null,
  );
  assert.equal(
    findSupportedVideoMimeType('mp4', (mime) => mime === 'video/mp4'),
    'video/mp4',
  );
});

test('GIF frame encoding returns a complete GIF89a file', async () => {
  const gifApi = await loadGifencApi();
  const encoder = gifApi.GIFEncoder();
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  addRgbaFrameToGif(encoder, gifApi, pixels, 2, 2, 100, true);
  encoder.finish();
  const bytes = encoder.bytes();
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), 'GIF89a');
  assert.equal(bytes[bytes.length - 1], 0x3b);
  assert.ok(bytes.length > 30);
});
