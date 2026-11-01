import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../types';
import { parseProjectFile, serializeProjectFile } from './projectFiles';

const sampleState: AppState = {
  width: 800,
  height: 1100,
  borderColor: '#ffffff',
  borderWidth: 12,
  strokeColor: '#000000',
  strokeWidth: 2,
  pageBg: '#d0cbc4',
  currentPage: 0,
  pages: [{
    w: 800,
    h: 1100,
    frames: [{
      id: 1,
      x: 0,
      y: 0,
      w: 800,
      h: 1100,
      layers: [{
        id: 2,
        src: 'data:image/png;base64,AA==',
        name: 'test image',
        parallax: 0,
        hidden: false,
        tx: 0,
        ty: 0,
        scale: 1,
        rotate: 0,
      }],
      borderWidths: {},
      strokeWidths: {},
    }],
  }],
};

test('project file round-trips the full document and embedded images', () => {
  const restored = parseProjectFile(serializeProjectFile(sampleState));
  assert.deepEqual(restored, sampleState);
});

test('legacy browser-state JSON remains importable', () => {
  const restored = parseProjectFile(JSON.stringify(sampleState));
  assert.deepEqual(restored, sampleState);
});

test('malformed JSON is rejected with a useful error', () => {
  assert.throws(() => parseProjectFile('{not json'), /корректный JSON-проект/);
});

test('documents without pages or with invalid frame geometry are rejected', () => {
  assert.throws(() => parseProjectFile(JSON.stringify({ ...sampleState, pages: [] })), /нет страниц/);
  const invalidState = structuredClone(sampleState);
  invalidState.pages[0].frames[0].x = Number.NaN;
  assert.throws(() => parseProjectFile(JSON.stringify(invalidState)), /некорректная геометрия/);
});
