/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Page, Frame, Layer } from '../types';

export const DEFAULT_BG = '/src/assets/images/cyberpunk_bg_1780281822261.png';
export const DEFAULT_HERO = '/src/assets/images/cyberpunk_hero_1780281838230.png';
export const DEFAULT_FG = '/src/assets/images/cyberpunk_fg_1780281857992.png';

// High-quality public CDN placeholders as backups or extra assets
export const SAMPLE_ASSETS = [
  { name: 'Кибер-Город (Фон)', src: DEFAULT_BG },
  { name: 'Герой Самурай (Центр)', src: DEFAULT_HERO },
  { name: 'Голограмма HUD (Передний)', src: DEFAULT_FG },
  { name: 'Ретро Закат', src: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=600&q=80' },
  { name: 'Аниме Горизонт', src: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&q=80' },
  { name: 'Неоновый Силуэт', src: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&q=80' },
  { name: 'Свечение', src: 'https://images.unsplash.com/photo-1543536448-d209d2d13a1c?w=600&q=80' }
];

// Helper to create IDs dynamically (using current timestamp seed to guarantee absolute uniqueness across page reloads)
let fidCounter = Date.now();
let lidCounter = Date.now() + 1000000;

export const createFrame = (x: number, y: number, w: number, h: number, layers: Layer[] = []): Frame => ({
  id: ++fidCounter,
  x,
  y,
  w,
  h,
  vertices: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h }
  ],
  layers,
  borderWidths: {},
  strokeWidths: {},
});

export const createLayer = (src: string, name: string, parallax = 0, tx = 0, ty = 0, scale = 1, rotate = 0): Layer => ({
  id: ++lidCounter,
  src,
  name,
  parallax,
  hidden: false,
  tx,
  ty,
  scale,
  rotate,
});

export const getInitialPages = (w: number, h: number): Page[] => {
  // Return empty page 1 with deep frames but absolutely NO layers inside them
  const f1 = createFrame(0, 0, w, Math.floor(h * 0.45), []);
  f1.borderWidths = { bottom: 6, top: 12, left: 12, right: 12 };

  const f2 = createFrame(0, Math.floor(h * 0.45), Math.floor(w * 0.5), h - Math.floor(h * 0.45), []);
  f2.borderWidths = { top: 6, bottom: 12, left: 12, right: 6 };

  const f3 = createFrame(Math.floor(w * 0.5), Math.floor(h * 0.45), w - Math.floor(w * 0.5), h - Math.floor(h * 0.45), []);
  f3.borderWidths = { top: 6, bottom: 12, left: 6, right: 12 };

  const page1: Page = {
    frames: [f1, f2, f3],
    w,
    h,
  };

  const splashFrame = createFrame(0, 0, w, h, []);
  splashFrame.borderWidths = { top: 12, bottom: 12, left: 12, right: 12 };

  const page2: Page = {
    frames: [splashFrame],
    w,
    h,
  };

  return [page1, page2];
};

export const VECTOR_SHAPES = [
  {
    name: 'Прямоугольник',
    icon: '⏹️',
    getVertices: (w: number, h: number) => [
      { x: 50, y: 50 },
      { x: w - 50, y: 50 },
      { x: w - 50, y: h - 50 },
      { x: 50, y: h - 50 },
    ]
  },
  {
    name: 'Треугольник',
    icon: '▲',
    getVertices: (w: number, h: number) => [
      { x: w / 2, y: 50 },
      { x: w - 50, y: h - 50 },
      { x: 50, y: h - 50 },
    ]
  },
  {
    name: 'Ромб',
    icon: '◆',
    getVertices: (w: number, h: number) => [
      { x: w / 2, y: 50 },
      { x: w - 50, y: h / 2 },
      { x: w / 2, y: h - 50 },
      { x: 50, y: h / 2 },
    ]
  },
  {
    name: 'Параллелограмм',
    icon: '▰',
    getVertices: (w: number, h: number) => [
      { x: 100, y: 50 },
      { x: w - 50, y: 50 },
      { x: w - 100, y: h - 50 },
      { x: 50, y: h - 50 },
    ]
  },
  {
    name: 'Трапеция',
    icon: '⏃',
    getVertices: (w: number, h: number) => [
      { x: 120, y: 50 },
      { x: w - 120, y: 50 },
      { x: w - 50, y: h - 50 },
      { x: 50, y: h - 50 },
    ]
  },
  {
    name: 'Шестиугольник',
    icon: '⬡',
    getVertices: (w: number, h: number) => [
      { x: w / 2, y: 40 },
      { x: w - 50, y: h * 0.3 },
      { x: w - 50, y: h * 0.7 },
      { x: w / 2, y: h - 40 },
      { x: 50, y: h * 0.7 },
      { x: 50, y: h * 0.3 },
    ]
  },
  {
    name: 'Восьмиугольник',
    icon: '🛑',
    getVertices: (w: number, h: number) => [
      { x: w * 0.35, y: 40 },
      { x: w * 0.65, y: 40 },
      { x: w - 50, y: h * 0.35 },
      { x: w - 50, y: h * 0.65 },
      { x: w * 0.65, y: h - 40 },
      { x: w * 0.35, y: h - 40 },
      { x: 50, y: h * 0.65 },
      { x: 50, y: h * 0.35 },
    ]
  },
  {
    name: 'Звезда',
    icon: '★',
    getVertices: (w: number, h: number) => {
      const cx = w / 2;
      const cy = h / 2;
      const spikes = 5;
      const outerRadius = Math.min(w, h) / 2 - 40;
      const innerRadius = outerRadius * 0.4;
      const pts = [];
      let rot = (Math.PI / 2) * 3;
      const step = Math.PI / spikes;
      for (let i = 0; i < spikes; i++) {
        pts.push({ x: cx + Math.cos(rot) * outerRadius, y: cy + Math.sin(rot) * outerRadius });
        rot += step;
        pts.push({ x: cx + Math.cos(rot) * innerRadius, y: cy + Math.sin(rot) * innerRadius });
        rot += step;
      }
      return pts;
    }
  },
  {
    name: 'Срез / Угловой',
    icon: '📐',
    getVertices: (w: number, h: number) => [
      { x: 50, y: 50 },
      { x: w - 120, y: 50 },
      { x: w - 50, y: 120 },
      { x: w - 50, y: h - 50 },
      { x: 50, y: h - 50 },
    ]
  },
  {
    name: 'Сердце',
    icon: '❤️',
    getVertices: (w: number, h: number) => {
      const cx = w / 2;
      const cy = h / 2;
      return [
        {
          x: cx,
          y: cy - h * 0.22,
          handleIn: { x: -w * 0.16, y: -h * 0.14 },
          handleOut: { x: w * 0.16, y: -h * 0.14 },
          isCurve: true
        },
        {
          x: cx + w * 0.38,
          y: cy - h * 0.12,
          handleIn: { x: 0, y: -h * 0.16 },
          handleOut: { x: 0, y: h * 0.16 },
          isCurve: true
        },
        {
          x: cx,
          y: cy + h * 0.35,
          handleIn: { x: w * 0.08, y: -h * 0.12 },
          handleOut: { x: -w * 0.08, y: -h * 0.12 },
          isCurve: true
        },
        {
          x: cx - w * 0.38,
          y: cy - h * 0.12,
          handleIn: { x: 0, y: h * 0.16 },
          handleOut: { x: 0, y: -h * 0.16 },
          isCurve: true
        }
      ];
    }
  },
  {
    name: 'Юла Gemini',
    icon: '✨',
    getVertices: (w: number, h: number) => {
      const cx = w / 2;
      const cy = h / 2;
      const rx = w * 0.38;
      const ry = h * 0.38;
      return [
        {
          x: cx,
          y: cy - ry,
          handleIn: { x: 0, y: ry * 0.45 },
          handleOut: { x: 0, y: ry * 0.45 },
          isCurve: true
        },
        {
          x: cx + rx,
          y: cy,
          handleIn: { x: -rx * 0.45, y: 0 },
          handleOut: { x: -rx * 0.45, y: 0 },
          isCurve: true
        },
        {
          x: cx,
          y: cy + ry,
          handleIn: { x: 0, y: -ry * 0.45 },
          handleOut: { x: 0, y: -ry * 0.45 },
          isCurve: true
        },
        {
          x: cx - rx,
          y: cy,
          handleIn: { x: rx * 0.45, y: 0 },
          handleOut: { x: rx * 0.45, y: 0 },
          isCurve: true
        }
      ];
    }
  }
];
