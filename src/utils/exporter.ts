/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppState, Frame, Layer, Modifier, Page } from '../types';
import { generateVectorStrokePrimitives, getAdjustedVertices, getPolygonBounds, getSvgPathFromVertices, StrokePrimitive } from './geometry';

export type ExportFormat = 'html' | 'png' | 'jpg' | 'gif' | 'webm' | 'mp4' | 'sequence';
export type ExportScope = 'all' | 'current' | 'frame';

export interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  scale: number; // Raster render scale multiplier
  jpgQuality: number; // 0 to 100
  fps: number;
  duration: number; // in seconds
  resolution: '720p' | '1080p' | '4k';
  bitrate?: 'low' | 'medium' | 'high';
  selectedFrameId: number | null;
  htmlMode?: 'scroll' | 'slide' | 'arrows';
}

export interface ProgressUpdate {
  percent: number;
  status: string;
}

export interface ExportTarget {
  page: Page;
  pageIndex: number;
  frame?: Frame;
}

const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_PIXELS = 100_000_000;

/** Resolve all/current/frame to explicit source indexes before doing any work. */
export function resolveExportTargets(
  state: AppState,
  scope: ExportScope,
  selectedFrameId: number | null
): ExportTarget[] {
  if (!state.pages.length) {
    throw new Error('В проекте нет страниц для экспорта.');
  }

  if (scope === 'all') {
    return state.pages.map((page, pageIndex) => ({ page, pageIndex }));
  }

  const requestedIndex = Number.isInteger(state.currentPage) ? state.currentPage : 0;
  const pageIndex = Math.min(Math.max(requestedIndex, 0), state.pages.length - 1);
  const page = state.pages[pageIndex];
  if (scope === 'current') return [{ page, pageIndex }];

  if (selectedFrameId === null) {
    throw new Error('Для экспорта фрейма сначала выберите фрейм на текущем листе.');
  }
  const frame = page.frames.find((candidate) => candidate.id === selectedFrameId);
  if (!frame) {
    throw new Error('Выбранный фрейм не найден на текущем листе. Выберите его заново.');
  }
  if (frame.hidden) {
    throw new Error('Выбранный фрейм скрыт. Покажите его или выберите другой фрейм.');
  }
  if (frame.vertices && frame.vertices.length < 2) {
    throw new Error('У выбранного фрейма недостаточно точек для экспорта. Исправьте контур или выберите другой фрейм.');
  }
  return [{ page, pageIndex, frame }];
}

/** Return the first browser-supported, real MediaRecorder container for a requested format. */
export function findSupportedVideoMimeType(
  format: 'webm' | 'mp4',
  isTypeSupported: (mimeType: string) => boolean
): string | null {
  const candidates = format === 'mp4'
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((mimeType) => isTypeSupported(mimeType)) ?? null;
}

function reportProgress(onProgress: ((update: ProgressUpdate) => void) | undefined, percent: number, status: string) {
  onProgress?.({ percent: Math.max(0, Math.min(100, Math.round(percent))), status });
}

function downloadBlob(blob: Blob, filename: string) {
  if (!blob.size) throw new Error('Экспорт завершился пустым файлом. Повторите экспорт.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function downloadFile(content: string, filename: string, mimeType: string) {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

function sanitizeFilename(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || 'untitled';
}

function safeCssColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const color = value.trim();
  const safe = color === 'transparent'
    || /^#[\da-f]{3,8}$/i.test(color)
    || /^(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\([\da-z.%\s,\/+\-]+\)$/i.test(color)
    || /^[a-z]{1,20}$/i.test(color);
  return safe ? color : fallback;
}

function safeDashArray(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() === 'none') return 'none';
  const parts = value.trim().split(/[ ,]+/).map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0) || parts.every((part) => part === 0)) return 'none';
  return parts.join(' ');
}

function safeModifiers(modifiers: Modifier[] | undefined): Modifier[] | undefined {
  return modifiers?.map((modifier) => ({
    ...modifier,
    params: {
      ...modifier.params,
      color: modifier.params.color === undefined
        ? undefined
        : safeCssColor(modifier.params.color, 'rgba(0,0,0,0.5)'),
    },
  }));
}

function pageSize(state: AppState, page: Page) {
  const width = Number.isFinite(page.w) && page.w! > 0 ? page.w! : state.width;
  const height = Number.isFinite(page.h) && page.h! > 0 ? page.h! : state.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('У листа некорректный размер. Проверьте настройки холста.');
  }
  return { width, height };
}

function assertCanvasSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Невозможно создать холст с выбранным размером.');
  }
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > MAX_CANVAS_PIXELS) {
    throw new Error('Размер экспорта слишком велик для браузера. Уменьшите масштаб или разрешение.');
  }
}

/**
 * 1. Export entire Comic State to a self-contained Interactive HTML file.
 * Preserves page structures, frames, layers, and styles, and includes interactive JS parallax!
 */
export async function exportToHtml(
  sourceState: AppState,
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<void> {
  if (options.scope === 'frame') {
    throw new Error('HTML-плеер экспортируется целыми листами. Для одного фрейма выберите PNG или JPG.');
  }
  const targets = resolveExportTargets(sourceState, options.scope, null);
  const mode = options.htmlMode || 'arrows';
  reportProgress(onProgress, 5, 'Подготовка листов для HTML-плеера...');

  const uniqueSources = new Map<string, string>();
  targets.forEach(({ page }) => {
    page.frames.filter((frame) => !frame.hidden).forEach((frame) => {
      (frame.layers || []).filter((layer) => !layer.hidden).forEach((layer) => {
        if (!layer.src) throw new Error(`У слоя «${layer.name || 'без имени'}» нет изображения для HTML-экспорта.`);
        if (!uniqueSources.has(layer.src)) uniqueSources.set(layer.src, layer.name || layer.src);
      });
    });
  });

  const inlineAssets = new Map<string, string>();
  const sourceEntries = [...uniqueSources.entries()];
  let nextSourceIndex = 0;
  let completedSources = 0;
  const inlineWorker = async () => {
    while (nextSourceIndex < sourceEntries.length) {
      const index = nextSourceIndex++;
      const [src, name] = sourceEntries[index];
      if (/^data:[^,]*;base64,[a-z\d+/=\s]+$/i.test(src)) {
        inlineAssets.set(src, src);
      } else {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(src, { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Не удалось прочитать изображение'));
            reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать изображение'));
            reader.readAsDataURL(blob);
          });
          inlineAssets.set(src, dataUrl);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Не удалось встроить изображение «${name}» в HTML (${detail}). Проверьте доступ к файлу и CORS.`);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      completedSources++;
      reportProgress(
        onProgress,
        5 + (completedSources / Math.max(sourceEntries.length, 1)) * 30,
        `Встраивание изображений: ${completedSources} из ${sourceEntries.length}...`
      );
    }
  };
  if (sourceEntries.length) {
    await Promise.all(Array.from({ length: Math.min(4, sourceEntries.length) }, () => inlineWorker()));
  } else {
    reportProgress(onProgress, 35, 'Растровые слои не найдены.');
  }

  const requestedPageIndex = Number.isInteger(sourceState.currentPage) ? sourceState.currentPage : 0;
  const htmlPageBg = safeCssColor(sourceState.pageBg, '#ffffff');
  const htmlBorderColor = safeCssColor(sourceState.borderColor, '#141210');
  const state: AppState = {
    ...sourceState,
    borderColor: htmlBorderColor,
    pageBg: htmlPageBg,
    strokeColor: safeCssColor(sourceState.strokeColor, '#000000'),
    pages: targets.map(({ page }) => ({
      ...page,
      borderColor: page.borderColor === undefined ? undefined : safeCssColor(page.borderColor, htmlBorderColor),
      strokeColor: page.strokeColor === undefined ? undefined : safeCssColor(page.strokeColor, safeCssColor(sourceState.strokeColor, '#000000')),
      modifiers: safeModifiers(page.modifiers),
      frames: page.frames.filter((frame) => !frame.hidden).map((frame) => ({
        ...frame,
        fillColor: frame.fillColor === undefined
          ? undefined
          : frame.fillColor === 'transparent' ? 'transparent' : safeCssColor(frame.fillColor, htmlPageBg),
        strokeColor: frame.strokeColor === undefined ? undefined : safeCssColor(frame.strokeColor, safeCssColor(sourceState.strokeColor, '#000000')),
        strokeDasharray: safeDashArray(frame.strokeDasharray),
        modifiers: safeModifiers(frame.modifiers),
        layers: (frame.layers || []).filter((layer) => !layer.hidden).map((layer) => ({
          ...layer,
          src: inlineAssets.get(layer.src) || layer.src,
        })),
      })),
    })),
    currentPage: options.scope === 'current'
      ? 0
      : Math.max(0, targets.findIndex((target) => target.pageIndex === requestedPageIndex)),
  };

  reportProgress(onProgress, 40, 'Генерация интерактивного HTML-плеера...');

  // Escape script-closing sequences so project text cannot terminate the embedded script.
  const serializedState = JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  // Generate layouts style configurations
  let alignmentStyles = '';
  if (mode === 'scroll') {
    alignmentStyles = `
      .comic-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 32px;
        width: 100%;
        max-width: 900px;
        padding: 40px 10px;
      }
      .page-wrapper {
        position: relative;
        display: block !important;
        opacity: 1 !important;
        margin-bottom: 24px;
      }
      .side-arrow {
        display: none !important;
      }
    `;
  } else if (mode === 'slide') {
    alignmentStyles = `
      .comic-container {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 40px;
        overflow-x: auto;
        width: 100%;
        padding: 40px 24px;
        scroll-snap-type: x mandatory;
      }
      .page-wrapper {
        position: relative;
        display: block !important;
        opacity: 1 !important;
        flex-shrink: 0;
        scroll-snap-align: center;
      }
      .side-arrow {
        display: none !important;
      }
    `;
  } else {
    // Mode arrows / slideshow
    alignmentStyles = `
      .comic-container {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: calc(100vh - 20px);
        position: relative;
      }
      .page-wrapper {
        position: absolute;
        display: none;
        opacity: 0;
        transition: opacity 0.4s ease-in-out;
      }
      .page-wrapper.active {
        display: block;
        opacity: 1;
      }
    `;
  }

  // Build clean frames and pages HTML in strict compliance with the PreviewOverlay model
  const pagesHTML = state.pages
    .map((pg, pIdx) => {
      const pw = pg.w || state.width;
      const ph = pg.h || state.height;

      const framesHTML = pg.frames
        .map((fr, fIdx) => {
          if (fr.hidden) return '';

          const adjustedVertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, pg.borderWidth);
          if (adjustedVertices.length < 2) return '';
          const box = getPolygonBounds(adjustedVertices);

          const clipVertices = adjustedVertices.map((v) => ({
            x: v.x - box.x,
            y: v.y - box.y,
            handleIn: v.handleIn,
            handleOut: v.handleOut,
            isCurve: v.isCurve,
          }));
          const clipPathD = getSvgPathFromVertices(clipVertices, fr.isClosed !== false);

          const visibleLayers = fr.layers ? fr.layers.filter((l) => !l.hidden) : [];

          const frameCenterX = fr.x + (fr.tx || 0) + fr.w / 2;
          const frameCenterY = fr.y + (fr.ty || 0) + fr.h / 2;
          const boxCenterX = box.x + box.w / 2;
          const boxCenterY = box.y + box.h / 2;
          const stableOffsetX = frameCenterX - boxCenterX;
          const stableOffsetY = frameCenterY - boxCenterY;

          const layersHTML = visibleLayers
            .map((l, lIdx) => {
              const sX = l.scaleX !== undefined ? l.scaleX : l.scale;
              const sY = l.scaleY !== undefined ? l.scaleY : l.scale;
              const layerTx = l.tx + stableOffsetX;
              const layerTy = l.ty + stableOffsetY;
              const transformStr = `translate(${layerTx}px, ${layerTy}px) scale(${sX}, ${sY}) rotate(${l.rotate}deg)`;
              
              return `
              <div class="layer-item" data-layer-id="${l.id}" data-parallax="${l.parallax}" data-stable-tx="${layerTx}" data-stable-ty="${layerTy}" data-stable-sx="${sX}" data-stable-sy="${sY}" data-stable-rotate="${l.rotate}" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:${15 + lIdx};pointer-events:none;transition:transform 0.08s ease-out;will-change:transform;">
                <div class="layer-inner" style="position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;transform:${transformStr};transform-origin:center center;pointer-events:auto;">
                  <img src="${l.src}" class="layer-image" style="max-width:100%;max-height:100%;object-fit:contain;user-select:none;" />
                </div>
              </div>`;
            })
            .join('');

          // Stroke parameters
          const fallbackSW = pg.strokeWidth !== undefined ? pg.strokeWidth : state.strokeWidth;
          const strColor = fr.strokeColor || (pg.strokeColor !== undefined ? pg.strokeColor : state.strokeColor);
          const strWidth = fr.strokeWidth !== undefined ? fr.strokeWidth : fallbackSW;

          // Reuse the editor's stroke geometry so PNG/GIF/HTML agree on artistic stroke styles.
          const strokeHtmlSegmentsList: string[] = [];
          const strokePrimitives = generateVectorStrokePrimitives(
            fr,
            clipVertices,
            strWidth,
            strColor,
            state.strokeCaps || 'round'
          );
          strokePrimitives.forEach((primitive) => {
            const opacityAttr = primitive.opacity !== undefined ? ` opacity="${primitive.opacity}"` : '';
            const dash = primitive.strokeDasharray && primitive.strokeDasharray !== 'none'
              ? ` stroke-dasharray="${safeDashArray(primitive.strokeDasharray)}"`
              : '';
            if (primitive.type === 'path') {
              strokeHtmlSegmentsList.push(
                `<path d="${primitive.d || ''}" fill="${primitive.fill || 'none'}" stroke="${primitive.stroke || 'none'}" stroke-width="${primitive.strokeWidth || strWidth}" stroke-linecap="${primitive.strokeLinecap || 'round'}"${dash}${opacityAttr} />`
              );
            } else if (primitive.type === 'line') {
              strokeHtmlSegmentsList.push(
                `<line x1="${primitive.x1 ?? 0}" y1="${primitive.y1 ?? 0}" x2="${primitive.x2 ?? 0}" y2="${primitive.y2 ?? 0}" fill="${primitive.fill || 'none'}" stroke="${primitive.stroke || 'none'}" stroke-width="${primitive.strokeWidth || strWidth}" stroke-linecap="${primitive.strokeLinecap || 'round'}"${dash}${opacityAttr} />`
              );
            } else if (primitive.type === 'polygon') {
              strokeHtmlSegmentsList.push(
                `<polygon points="${primitive.points || ''}" fill="${primitive.fill || 'none'}"${opacityAttr} />`
              );
            } else if (primitive.type === 'circle') {
              strokeHtmlSegmentsList.push(
                `<circle cx="${primitive.cx ?? 0}" cy="${primitive.cy ?? 0}" r="${primitive.r ?? 0}" fill="${primitive.fill || 'none'}"${opacityAttr} />`
              );
            }
          });

          const strokeHtmlSegments = strokeHtmlSegmentsList.join('\n');

          return `
          <div class="frame-box" data-frame-id="${fr.id}" style="position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;user-select:none;z-index:${10 + fIdx};transition:transform 0.08s ease-out;">
            <svg width="0" height="0" style="position:absolute;">
              <defs>
                <clipPath id="clip-${fr.id}">
                  <path d="${clipPathD}" />
                </clipPath>
              </defs>
            </svg>
            <div class="frame-content-block" style="position:absolute;inset:0;clip-path:url(#clip-${fr.id});-webkit-clip-path:url(#clip-${fr.id});overflow:hidden;background:${fr.fillColor || state.pageBg};">
              ${layersHTML}
            </div>
            <svg style="position:absolute;inset:0;pointer-events:none;width:100%;height:100%;z-index:99;overflow:visible;">
              ${strokeHtmlSegments}
            </svg>
          </div>`;
        })
        .join('');

      return `
      <!-- Page ${pIdx + 1} -->
      <div class="page-wrapper ${pIdx === state.currentPage ? 'active' : ''}" id="page-${pIdx}" style="position:relative;width:${pw}px;height:${ph}px;background:${state.borderColor};flex-shrink:0;margin-bottom:40px;">
        ${framesHTML}
      </div>`;
    })
    .join('\n');

  // Parallax client-side logic
  const clientJS = `
    (function() {
      const state = ${serializedState};
      const offsets = {};
      let globalMouseOffset = { x: 0, y: 0 };
      const startTime = Date.now();
      let activePageIndex = ${state.currentPage};

      window.addEventListener('mousemove', (e) => {
        const mx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2 || 1);
        const my = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2 || 1);
        globalMouseOffset = { x: mx, y: my };
      });

      document.querySelectorAll('.frame-box').forEach((frameBox) => {
        const frameId = parseInt(frameBox.dataset.frameId);
        if (!frameId) return;
        const contentBlock = frameBox.querySelector('.frame-content-block');
        if (!contentBlock) return;

        offsets[frameId] = { dx: 0, dy: 0 };

        contentBlock.addEventListener('mousemove', (e) => {
          const rect = contentBlock.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          const dx = x / (rect.width / 2 || 1);
          const dy = y / (rect.height / 2 || 1);
          offsets[frameId] = { dx: dx, dy: dy };
        });

        contentBlock.addEventListener('mouseleave', () => {
          offsets[frameId] = { dx: 0, dy: 0 };
        });
      });

      function getPageFrameAdjustments(fr, page, mouseOffset, time) {
        let tx = 0;
        let ty = 0;
        let scaleX = 1;
        let scaleY = 1;
        let rotate = 0;
        const cssFilterList = [];

        const modifiers = page.modifiers || [];
        for (let i = 0; i < modifiers.length; i++) {
          const mod = modifiers[i];
          if (!mod.enabled) continue;
          const isTargeted = mod.targetIds.includes(fr.id);
          if (!isTargeted) continue;

          const weight = mod.targetWeights && mod.targetWeights[fr.id] !== undefined
            ? mod.targetWeights[fr.id]
            : 1.0;

          if (mod.type === 'parallax') {
            const intensity = mod.params.intensity !== undefined ? mod.params.intensity : 50;
            tx += mouseOffset.x * intensity * weight * -1.2;
            ty += mouseOffset.y * intensity * weight * -1.2;
          } else if (mod.type === 'noise') {
            const intensity = mod.params.intensity !== undefined ? mod.params.intensity : 10;
            const speed = mod.params.speed !== undefined ? mod.params.speed : 1.0;
            const phase = time * 0.003 * speed;
            tx += Math.sin(phase) * intensity * weight;
            ty += Math.cos(phase * 0.8) * intensity * weight;
            rotate += Math.sin(phase * 1.5) * (intensity * 0.2) * weight;
          } else if (mod.type === 'tint') {
            const intensity = mod.params.intensity !== undefined ? mod.params.intensity : 50;
            cssFilterList.push('hue-rotate(' + (intensity * 3.6 * weight) + 'deg) saturate(' + (1 + intensity * 0.012 * weight) + ')');
          } else if (mod.type === 'shadow') {
            const blur = mod.params.blur !== undefined ? mod.params.blur : 5;
            const shadowX = mod.params.shadowX !== undefined ? mod.params.shadowX : 4;
            const shadowY = mod.params.shadowY !== undefined ? mod.params.shadowY : 4;
            const color = mod.params.color !== undefined ? mod.params.color : 'rgba(0,0,0,0.5)';
            cssFilterList.push('drop-shadow(' + (shadowX * weight) + 'px ' + (shadowY * weight) + 'px ' + blur + 'px ' + color + ')');
          }
        }

        return { tx, ty, scaleX, scaleY, rotate, cssFilter: cssFilterList.join(' ') };
      }

      function getFrameLayerAdjustments(layer, fr, mouseOffset, localOffset, time) {
        let tx = 0;
        let ty = 0;
        let scaleX = 1;
        let scaleY = 1;
        let rotate = 0;
        const cssFilterList = [];

        const modifiers = fr.modifiers || [];
        if (modifiers.length === 0) {
          const pSpeed = parseFloat(layer.parallax) || 0;
          if (pSpeed !== 0) {
            tx += mouseOffset.x * pSpeed * -1.2;
            ty += mouseOffset.y * pSpeed * -1.2;
          }
        } else {
          for (let i = 0; i < modifiers.length; i++) {
            const mod = modifiers[i];
            if (!mod.enabled) continue;
            const isTargeted = mod.targetIds.includes(parseInt(layer.id));
            if (!isTargeted) continue;

            const weight = mod.targetWeights && mod.targetWeights[layer.id] !== undefined
              ? mod.targetWeights[layer.id]
              : 1.0;

            if (mod.type === 'parallax') {
              const intensity = mod.params.intensity !== undefined ? mod.params.intensity : 50;
              const trigger = mod.params.trigger || 'page';
              const offset = (trigger === 'frame' && localOffset) ? localOffset : mouseOffset;
              tx += offset.x * intensity * weight * -1.2;
              ty += offset.y * intensity * weight * -1.2;
            } else if (mod.type === 'noise') {
              const intensity = mod.params.intensity !== undefined ? mod.params.intensity : 10;
              const speed = mod.params.speed !== undefined ? mod.params.speed : 1.0;
              const phase = time * 0.003 * speed + (parseInt(layer.id) || 0) * 0.5;
              tx += Math.sin(phase) * intensity * weight;
              ty += Math.cos(phase * 0.82) * intensity * weight;
              rotate += Math.sin(phase * 1.3) * (intensity * 0.25) * weight;
              const sMod = 1 + Math.sin(phase * 0.7) * (intensity * 0.003) * weight;
              scaleX *= sMod;
              scaleY *= sMod;
            } else if (mod.type === 'tint') {
              const intensity = mod.params.intensity !== undefined ? mod.params.intensity : 50;
              cssFilterList.push('hue-rotate(' + (intensity * 3.6 * weight) + 'deg) saturate(' + (1 + intensity * 0.012 * weight) + ')');
            } else if (mod.type === 'shadow') {
              const blur = mod.params.blur !== undefined ? mod.params.blur : 5;
              const shadowX = mod.params.shadowX !== undefined ? mod.params.shadowX : 4;
              const shadowY = mod.params.shadowY !== undefined ? mod.params.shadowY : 4;
              const color = mod.params.color !== undefined ? mod.params.color : 'rgba(0,0,0,0.5)';
              cssFilterList.push('drop-shadow(' + (shadowX * weight) + 'px ' + (shadowY * weight) + 'px ' + blur + 'px ' + color + ')');
            }
          }
        }

        return { tx, ty, scaleX, scaleY, rotate, cssFilter: cssFilterList.join(' ') };
      }

      function tick() {
        const time = Date.now() - startTime;
        
        state.pages.forEach((page, pIdx) => {
          page.frames.forEach((fr) => {
            if (fr.hidden) return;
            const frameElement = document.querySelector('[data-frame-id="' + fr.id + '"]');
            if (!frameElement) return;

            const pageAdj = getPageFrameAdjustments(fr, page, globalMouseOffset, time);
            frameElement.style.transform = 'translate(' + pageAdj.tx + 'px, ' + pageAdj.ty + 'px) rotate(' + pageAdj.rotate + 'deg) scaleX(' + pageAdj.scaleX + ') scaleY(' + pageAdj.scaleY + ')';
            frameElement.style.filter = pageAdj.cssFilter || '';

            const frameOffset = offsets[fr.id] || { dx: 0, dy: 0 };
            const layers = frameElement.querySelectorAll('.layer-item');
            layers.forEach((layerItem, lIdx) => {
              const layerId = parseInt(layerItem.dataset.layerId);
              const layer = fr.layers.find(l => l.id === layerId);
              if (!layer) return;

              const layerAdj = getFrameLayerAdjustments(layer, fr, globalMouseOffset, { x: frameOffset.dx, y: frameOffset.dy }, time);
              
              const pSpeed = parseFloat(layerItem.dataset.parallax) || 0;
              const depthCoeff = (lIdx + 1) / (layers.length + 1);

              const pxOffset = frameOffset.dx * pSpeed * depthCoeff * -1.2 + layerAdj.tx;
              const pyOffset = frameOffset.dy * pSpeed * depthCoeff * -1.2 + layerAdj.ty;

              layerItem.style.transform = 'translate(' + pxOffset + 'px, ' + pyOffset + 'px)';
              layerItem.style.filter = layerAdj.cssFilter || '';

              const innerDiv = layerItem.querySelector('.layer-inner');
              if (innerDiv) {
                const stableTx = parseFloat(layerItem.dataset.stableTx) || 0;
                const stableTy = parseFloat(layerItem.dataset.stableTy) || 0;
                const stableSx = parseFloat(layerItem.dataset.stableSx) || 1.0;
                const stableSy = parseFloat(layerItem.dataset.stableSy) || 1.0;
                const stableRot = parseFloat(layerItem.dataset.stableRot) || 0;

                const finalSx = stableSx * layerAdj.scaleX;
                const finalSy = stableSy * layerAdj.scaleY;
                const finalRot = stableRot + layerAdj.rotate;

                innerDiv.style.transform = 'translate(' + stableTx + 'px, ' + stableTy + 'px) scaleX(' + finalSx + ') scaleY(' + finalSy + ') rotate(' + finalRot + 'deg)';
              }
            });
          });
        });

        requestAnimationFrame(tick);
      }

      // Slider Navigation buttons if available
      const prevBtn = document.getElementById('prev-btn');
      const nextBtn = document.getElementById('next-btn');
      
      function updateNavUI() {
        if (!prevBtn || !nextBtn) return;
        prevBtn.classList.toggle('disabled', activePageIndex === 0);
        nextBtn.classList.toggle('disabled', activePageIndex === state.pages.length - 1);
      }

      if (prevBtn && nextBtn) {
        prevBtn.addEventListener('click', () => {
          if (activePageIndex > 0) {
            document.getElementById('page-' + activePageIndex).classList.remove('active');
            activePageIndex--;
            document.getElementById('page-' + activePageIndex).classList.add('active');
            updateNavUI();
          }
        });

        nextBtn.addEventListener('click', () => {
          if (activePageIndex < state.pages.length - 1) {
            document.getElementById('page-' + activePageIndex).classList.remove('active');
            activePageIndex++;
            document.getElementById('page-' + activePageIndex).classList.add('active');
            updateNavUI();
          }
        });
        updateNavUI();
      }

      tick();
    })();
  `;

  const fullHTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VIBECOMIX — Интерактивный Параллакс</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: #090807;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 50px;
      padding: 60px 20px;
      min-height: 100vh;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .comic-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    ${alignmentStyles}

    .page-wrapper {
      box-shadow: 0 20px 50px rgba(0,0,0,0.6);
      border-radius: 4px;
      overflow: hidden;
    }
    
    /* Floating navigation arrows */
    .side-arrow {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      width: 56px;
      height: 56px;
      background: rgba(20, 18, 16, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 50%;
      color: rgba(255, 255, 255, 0.6);
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 1000;
      transition: all 0.2s ease-in-out;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      user-select: none;
    }
    .side-arrow:hover {
      background: rgba(252, 1, 141, 0.2);
      border-color: #FC018D;
      color: #fff;
      box-shadow: 0 0 15px rgba(252, 1, 141, 0.35);
    }
    .side-arrow.left {
      left: 24px;
    }
    .side-arrow.right {
      right: 24px;
    }
    .side-arrow.disabled {
      opacity: 0.15;
      pointer-events: none;
    }
  </style>
</head>
<body>

  ${mode === 'arrows' ? `
    <button class="side-arrow left" id="prev-btn">&larr;</button>
    <button class="side-arrow right" id="next-btn">&rarr;</button>
  ` : ''}

  <div class="comic-container">
    ${pagesHTML}
  </div>

  <script>
    ${clientJS}
  </script>
</body>
</html>`;

  // Download flow
  downloadFile(fullHTML, `comic_${options.scope}_${mode}.html`, 'text/html;charset=utf-8');
  reportProgress(onProgress, 100, 'HTML-файл готов.');
}

export function isBrowserVideoFormatSupported(format: 'webm' | 'mp4'): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  try {
    return findSupportedVideoMimeType(format, (mimeType) => MediaRecorder.isTypeSupported(mimeType)) !== null;
  } catch {
    return false;
  }
}

type CanvasPoint = { x: number; y: number };
type AdjustedVertex = ReturnType<typeof getAdjustedVertices>[number];
type ImageCache = Map<string, HTMLImageElement>;

interface GifEncoderInstance {
  writeFrame(indexedPixels: Uint8Array, width: number, height: number, options: { palette: number[][]; delay: number; repeat?: number }): void;
  finish(): void;
  bytes(): Uint8Array;
}

interface GifencApi {
  GIFEncoder: () => GifEncoderInstance;
  quantize: (pixels: Uint8ClampedArray | Uint8Array, maxColors: number, options?: { format?: string }) => number[][];
  applyPalette: (pixels: Uint8ClampedArray | Uint8Array, palette: number[][], format?: string) => Uint8Array;
}

export async function loadGifencApi(): Promise<GifencApi> {
  const imported = await import('gifenc') as unknown as Record<string, unknown>;
  const defaultExport = imported.default && typeof imported.default === 'object'
    ? imported.default as Record<string, unknown>
    : {};
  const api = { ...defaultExport, ...imported };
  if (typeof api.GIFEncoder !== 'function' || typeof api.quantize !== 'function' || typeof api.applyPalette !== 'function') {
    throw new Error('Не удалось загрузить GIF-кодировщик. Обновите страницу и повторите экспорт.');
  }
  return api as unknown as GifencApi;
}

interface ImageResource {
  src: string;
  name: string;
}

interface FrameCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Motion {
  tx: number;
  ty: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
  filters: string[];
}

interface RenderTiming {
  timeSeconds: number;
  durationSeconds: number;
  globalOffset: CanvasPoint;
  localOffsetForFrame: (frame: Frame) => CanvasPoint;
}

function targetFrames(target: ExportTarget): Frame[] {
  return target.frame ? [target.frame] : target.page.frames.filter((frame) => !frame.hidden);
}

function collectImageResources(targets: ExportTarget[]): ImageResource[] {
  const sources = new Map<string, string>();
  for (const target of targets) {
    for (const frame of targetFrames(target)) {
      for (const layer of frame.layers || []) {
        if (layer.hidden) continue;
        if (!layer.src) {
          throw new Error(`У слоя «${layer.name || 'без имени'}» нет изображения для экспорта.`);
        }
        if (!sources.has(layer.src)) sources.set(layer.src, layer.name || layer.src);
      }
    }
  }
  return [...sources].map(([src, name]) => ({ src, name }));
}

async function loadImageCache(
  targets: ExportTarget[],
  onProgress: ((update: ProgressUpdate) => void) | undefined,
  progressStart: number,
  progressEnd: number,
  animationHost?: HTMLElement
): Promise<ImageCache> {
  const resources = collectImageResources(targets);
  const cache: ImageCache = new Map();
  if (resources.length === 0) {
    reportProgress(onProgress, progressEnd, 'Растровые слои не найдены.');
    return cache;
  }

  let completed = 0;
  await Promise.all(resources.map((resource) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finish(new Error(`Истекло время ожидания слоя «${resource.name}».`));
    }, 30_000);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      if (error) {
        reject(new Error(`Не удалось загрузить слой «${resource.name}». Проверьте файл и разрешение CORS. ${error.message}`));
        return;
      }
      cache.set(resource.src, image);
      completed++;
      reportProgress(
        onProgress,
        progressStart + (completed / resources.length) * (progressEnd - progressStart),
        `Загрузка изображений: ${completed} из ${resources.length}...`
      );
      resolve();
    };

    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        finish(new Error('Файл не является читаемым изображением.'));
      } else {
        finish();
      }
    };
    image.onerror = () => finish(new Error('Браузер не смог прочитать источник изображения.'));

    if (!/^data:|^blob:/i.test(resource.src)) image.crossOrigin = 'anonymous';
    try {
      image.src = resource.src;
      if (animationHost) animationHost.appendChild(image);
      if (image.complete && image.naturalWidth > 0) finish();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  })));
  return cache;
}

function traceFramePath(ctx: CanvasRenderingContext2D, vertices: AdjustedVertex[], closed: boolean) {
  if (vertices.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let index = 1; index < vertices.length; index++) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const isCurve = Boolean(previous.isCurve || current.isCurve || previous.handleOut || current.handleIn);
    if (isCurve) {
      const control1 = previous.handleOut
        ? { x: previous.x + previous.handleOut.x, y: previous.y + previous.handleOut.y }
        : previous;
      const control2 = current.handleIn
        ? { x: current.x + current.handleIn.x, y: current.y + current.handleIn.y }
        : current;
      ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, current.x, current.y);
    } else {
      ctx.lineTo(current.x, current.y);
    }
  }
  if (!closed) return;

  const last = vertices[vertices.length - 1];
  const first = vertices[0];
  const closingCurve = Boolean(last.isCurve || first.isCurve || last.handleOut || first.handleIn);
  if (closingCurve) {
    const control1 = last.handleOut
      ? { x: last.x + last.handleOut.x, y: last.y + last.handleOut.y }
      : last;
    const control2 = first.handleIn
      ? { x: first.x + first.handleIn.x, y: first.y + first.handleIn.y }
      : first;
    ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, first.x, first.y);
  } else {
    ctx.lineTo(first.x, first.y);
  }
  ctx.closePath();
}

function traceGeneratedPath(ctx: CanvasRenderingContext2D, data: string) {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
  let index = 0;
  let command = '';
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++].toUpperCase();
    if (command === 'M' || command === 'L') {
      const x = Number(tokens[index++]);
      const y = Number(tokens[index++]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (command === 'M') ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      if (command === 'M') command = 'L';
    } else if (command === 'C') {
      const values = tokens.slice(index, index + 6).map(Number);
      if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return;
      ctx.bezierCurveTo(values[0], values[1], values[2], values[3], values[4], values[5]);
      index += 6;
    } else {
      return;
    }
  }
}

function drawVectorStrokeOnCanvas(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  vertices: AdjustedVertex[],
  width: number,
  color: string,
  caps: 'round' | 'flat'
) {
  if (vertices.length < 2 || !Number.isFinite(width) || width <= 0) return;
  const primitives = generateVectorStrokePrimitives(frame, vertices, width, color, caps);
  for (const primitive of primitives) {
    ctx.save();
    if (primitive.opacity !== undefined) ctx.globalAlpha *= Math.max(0, Math.min(1, primitive.opacity));

    if (primitive.type === 'polygon' && primitive.points) {
      const points = primitive.points.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
      if (points.length > 1 && points.every((point) => point.length === 2 && point.every(Number.isFinite))) {
        ctx.beginPath();
        points.forEach(([x, y], pointIndex) => {
          if (pointIndex === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = primitive.fill || color;
        ctx.fill();
      }
    } else if (primitive.type === 'circle' && primitive.cx !== undefined && primitive.cy !== undefined && primitive.r !== undefined) {
      ctx.beginPath();
      ctx.arc(primitive.cx, primitive.cy, Math.max(0, primitive.r), 0, Math.PI * 2);
      ctx.fillStyle = primitive.fill || color;
      ctx.fill();
    } else if (primitive.type === 'line' && primitive.x1 !== undefined && primitive.y1 !== undefined && primitive.x2 !== undefined && primitive.y2 !== undefined) {
      ctx.beginPath();
      ctx.moveTo(primitive.x1, primitive.y1);
      ctx.lineTo(primitive.x2, primitive.y2);
      ctx.strokeStyle = primitive.stroke || color;
      ctx.lineWidth = primitive.strokeWidth || width;
      ctx.lineCap = primitive.strokeLinecap || (caps === 'round' ? 'round' : 'butt');
      const pattern = primitive.strokeDasharray?.split(/[ ,]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0) || [];
      ctx.setLineDash(pattern);
      ctx.stroke();
    } else if (primitive.type === 'path' && primitive.d) {
      ctx.strokeStyle = primitive.stroke || color;
      ctx.lineWidth = primitive.strokeWidth || width;
      ctx.lineCap = primitive.strokeLinecap || (caps === 'round' ? 'round' : 'butt');
      const pattern = primitive.strokeDasharray?.split(/[ ,]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0) || [];
      ctx.setLineDash(pattern);
      if (typeof Path2D !== 'undefined') {
        const path = new Path2D(primitive.d);
        if (primitive.fill && primitive.fill !== 'none') {
          ctx.fillStyle = primitive.fill;
          ctx.fill(path);
        }
        if (primitive.stroke && primitive.stroke !== 'none') ctx.stroke(path);
        else if (!primitive.fill || primitive.fill === 'none') ctx.stroke(path);
      } else {
        ctx.beginPath();
        traceGeneratedPath(ctx, primitive.d);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function modifierTargetWeight(modifier: Modifier, targetId: number): number | null {
  if (!modifier.enabled || !modifier.targetIds?.includes(targetId)) return null;
  const weight = modifier.targetWeights?.[targetId] ?? 1;
  return Number.isFinite(weight) ? weight : 1;
}

function getModifierPhase(timeSeconds: number, durationSeconds: number, speed: number, seed = 0) {
  const normalizedTime = durationSeconds > 0 ? timeSeconds / durationSeconds : 0;
  return normalizedTime * Math.PI * 2 * speed + seed;
}

function addModifierFilter(filters: string[], modifier: Modifier, weight: number) {
  const intensity = Number.isFinite(modifier.params.intensity) ? modifier.params.intensity! : 50;
  if (modifier.type === 'tint') {
    filters.push(`hue-rotate(${intensity * 3.6 * weight}deg)`);
    filters.push(`saturate(${1 + intensity * 0.012 * weight})`);
  } else if (modifier.type === 'shadow') {
    const blur = Number.isFinite(modifier.params.blur) ? modifier.params.blur! : 5;
    const shadowX = Number.isFinite(modifier.params.shadowX) ? modifier.params.shadowX! : 4;
    const shadowY = Number.isFinite(modifier.params.shadowY) ? modifier.params.shadowY! : 4;
    const color = modifier.params.color || 'rgba(0,0,0,0.5)';
    filters.push(`drop-shadow(${shadowX * weight}px ${shadowY * weight}px ${blur}px ${color})`);
  }
}

function getPageFrameMotion(frame: Frame, page: Page, timing: RenderTiming): Motion {
  const motion: Motion = { tx: 0, ty: 0, rotate: 0, scaleX: 1, scaleY: 1, filters: [] };
  for (const modifier of page.modifiers || []) {
    const weight = modifierTargetWeight(modifier, frame.id);
    if (weight === null) continue;
    const intensity = Number.isFinite(modifier.params.intensity) ? modifier.params.intensity! : 50;
    if (modifier.type === 'parallax') {
      motion.tx += timing.globalOffset.x * intensity * weight * -1.2;
      motion.ty += timing.globalOffset.y * intensity * weight * -1.2;
    } else if (modifier.type === 'noise') {
      const speed = Number.isFinite(modifier.params.speed) ? modifier.params.speed! : 1;
      const phase = getModifierPhase(timing.timeSeconds, timing.durationSeconds, speed);
      motion.tx += Math.sin(phase) * intensity * weight;
      motion.ty += Math.cos(phase * 0.8) * intensity * weight;
      motion.rotate += Math.sin(phase * 1.5) * intensity * 0.2 * weight;
    } else {
      addModifierFilter(motion.filters, modifier, weight);
    }
  }
  return motion;
}

function getLayerMotion(layer: Layer, frame: Frame, timing: RenderTiming): Motion {
  const motion: Motion = { tx: 0, ty: 0, rotate: 0, scaleX: 1, scaleY: 1, filters: [] };
  for (const modifier of frame.modifiers || []) {
    const weight = modifierTargetWeight(modifier, layer.id);
    if (weight === null) continue;
    const intensity = Number.isFinite(modifier.params.intensity) ? modifier.params.intensity! : 50;
    if (modifier.type === 'parallax') {
      const offset = modifier.params.trigger === 'frame' ? timing.localOffsetForFrame(frame) : timing.globalOffset;
      motion.tx += offset.x * intensity * weight * -1.2;
      motion.ty += offset.y * intensity * weight * -1.2;
    } else if (modifier.type === 'noise') {
      const speed = Number.isFinite(modifier.params.speed) ? modifier.params.speed! : 1;
      const phase = getModifierPhase(timing.timeSeconds, timing.durationSeconds, speed, layer.id * 0.5);
      motion.tx += Math.sin(phase) * intensity * weight;
      motion.ty += Math.cos(phase * 0.82) * intensity * weight;
      motion.rotate += Math.sin(phase * 1.3) * intensity * 0.25 * weight;
      const scale = 1 + Math.sin(phase * 0.7) * intensity * 0.003 * weight;
      motion.scaleX *= scale;
      motion.scaleY *= scale;
    } else {
      addModifierFilter(motion.filters, modifier, weight);
    }
  }
  return motion;
}

function frameBounds(state: AppState, page: Page, frame: Frame): ReturnType<typeof getPolygonBounds> {
  const { width, height } = pageSize(state, page);
  return getPolygonBounds(getAdjustedVertices(frame, width, height, state.borderWidth, page.borderWidth));
}

function getFrameCrop(state: AppState, target: ExportTarget): FrameCrop | null {
  if (!target.frame) return null;
  const { page, frame } = target;
  const bounds = frameBounds(state, page, frame);
  const fallbackWidth = page.strokeWidth !== undefined ? page.strokeWidth : state.strokeWidth;
  const strokeWidth = frame.strokeWidth !== undefined ? frame.strokeWidth : fallbackWidth;
  let translationBleed = 0;
  let rotationDegrees = 0;
  let shadowBleed = 0;
  for (const modifier of page.modifiers || []) {
    const weight = modifierTargetWeight(modifier, frame.id);
    if (weight === null) continue;
    const intensity = Math.abs(Number.isFinite(modifier.params.intensity) ? modifier.params.intensity! : 50) * Math.abs(weight);
    if (modifier.type === 'parallax') translationBleed += intensity * 1.2;
    if (modifier.type === 'noise') {
      translationBleed += intensity * 1.2;
      rotationDegrees += intensity * 0.2;
    }
    if (modifier.type === 'shadow') {
      const blur = Number.isFinite(modifier.params.blur) ? modifier.params.blur! : 5;
      const offset = Math.max(Math.abs(modifier.params.shadowX || 0), Math.abs(modifier.params.shadowY || 0));
      shadowBleed += Math.max(0, blur) + offset;
    }
  }
  const rotationBleed = Math.hypot(bounds.w, bounds.h) / 2
    * Math.sin(Math.min(180, rotationDegrees) * Math.PI / 180);
  const padding = Math.max(2, Math.max(0, strokeWidth) / 2 + 2)
    + translationBleed + Math.max(0, rotationBleed) + shadowBleed;
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.w + padding * 2,
    height: bounds.h + padding * 2,
  };
}

function getFrameAncestors(page: Page, frame: Frame): Frame[] | null {
  const byId = new Map(page.frames.map((candidate) => [candidate.id, candidate]));
  const ancestors: Frame[] = [];
  const seen = new Set<number>([frame.id]);
  let parentId = frame.parentId;
  while (parentId !== undefined) {
    if (seen.has(parentId)) throw new Error('В проекте обнаружен цикл родительских масок фреймов. Исправьте структуру слоёв.');
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.hidden) return null;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  return ancestors;
}

function applyFrameTransform(ctx: CanvasRenderingContext2D, bounds: ReturnType<typeof getPolygonBounds>, motion: Motion) {
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;
  ctx.translate(centerX + motion.tx, centerY + motion.ty);
  ctx.rotate((motion.rotate * Math.PI) / 180);
  ctx.scale(motion.scaleX, motion.scaleY);
  ctx.translate(-centerX, -centerY);
}

function setCanvasFilter(ctx: CanvasRenderingContext2D, filters: string[]) {
  if ('filter' in ctx) ctx.filter = filters.length ? filters.join(' ') : 'none';
}

function drawFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  target: ExportTarget,
  frame: Frame,
  imageCache: ImageCache,
  timing: RenderTiming
) {
  if (frame.hidden) return;
  const { page } = target;
  const { width: pageWidth, height: pageHeight } = pageSize(state, page);
  const vertices = getAdjustedVertices(frame, pageWidth, pageHeight, state.borderWidth, page.borderWidth);
  if (vertices.length < 2) return;
  const bounds = getPolygonBounds(vertices);
  const ancestors = getFrameAncestors(page, frame);
  if (ancestors === null) return;

  // Keep every frame's mask local so it cannot accidentally clip later siblings.
  ctx.save();
  const baseTransform = ctx.getTransform();
  for (const ancestor of ancestors) {
    if (ancestor.isClosed === false) continue;
    const ancestorVertices = getAdjustedVertices(ancestor, pageWidth, pageHeight, state.borderWidth, page.borderWidth);
    if (ancestorVertices.length < 3) continue;
    const ancestorBounds = getPolygonBounds(ancestorVertices);
    const ancestorMotion = getPageFrameMotion(ancestor, page, timing);
    ctx.setTransform(baseTransform);
    applyFrameTransform(ctx, ancestorBounds, ancestorMotion);
    traceFramePath(ctx, ancestorVertices, true);
    ctx.clip();
    ctx.setTransform(baseTransform);
  }

  const pageMotion = getPageFrameMotion(frame, page, timing);
  ctx.save();
  applyFrameTransform(ctx, bounds, pageMotion);
  setCanvasFilter(ctx, pageMotion.filters);

  if (frame.isClosed !== false) {
    traceFramePath(ctx, vertices, true);
    const fillColor = frame.fillColor ?? state.pageBg;
    if (fillColor && fillColor !== 'transparent' && fillColor !== 'none') {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    ctx.clip();
  }

  const visibleLayers = (frame.layers || []).filter((layer) => !layer.hidden);
  const frameCenterX = frame.x + (frame.tx || 0) + frame.w / 2;
  const frameCenterY = frame.y + (frame.ty || 0) + frame.h / 2;
  const stableOffsetX = frameCenterX - (bounds.x + bounds.w / 2);
  const stableOffsetY = frameCenterY - (bounds.y + bounds.h / 2);

  visibleLayers.forEach((layer, layerIndex) => {
    const image = imageCache.get(layer.src);
    if (!image) return;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    if (!imageWidth || !imageHeight) return;
    const imageFitScale = Math.min(1, bounds.w / imageWidth, bounds.h / imageHeight);
    const drawWidth = imageWidth * imageFitScale;
    const drawHeight = imageHeight * imageFitScale;
    const depth = (layerIndex + 1) / (visibleLayers.length + 1);
    const localOffset = timing.localOffsetForFrame(frame);
    const parallax = Number.isFinite(layer.parallax) ? layer.parallax : 0;
    const layerMotion = getLayerMotion(layer, frame, timing);
    const layerTx = layer.tx + stableOffsetX + layerMotion.tx - localOffset.x * parallax * depth * 1.2;
    const layerTy = layer.ty + stableOffsetY + layerMotion.ty - localOffset.y * parallax * depth * 1.2;
    const scaleX = (layer.scaleX !== undefined ? layer.scaleX : layer.scale) * layerMotion.scaleX;
    const scaleY = (layer.scaleY !== undefined ? layer.scaleY : layer.scale) * layerMotion.scaleY;

    ctx.save();
    setCanvasFilter(ctx, [...pageMotion.filters, ...layerMotion.filters]);
    ctx.translate(bounds.x + bounds.w / 2 + layerTx, bounds.y + bounds.h / 2 + layerTy);
    ctx.scale(scaleX, scaleY);
    ctx.rotate(((layer.rotate + layerMotion.rotate) * Math.PI) / 180);
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
  });
  ctx.restore();

  ctx.save();
  applyFrameTransform(ctx, bounds, pageMotion);
  setCanvasFilter(ctx, pageMotion.filters);
  const fallbackWidth = page.strokeWidth !== undefined ? page.strokeWidth : state.strokeWidth;
  const strokeWidth = frame.strokeWidth !== undefined ? frame.strokeWidth : fallbackWidth;
  const strokeColor = frame.strokeColor || (page.strokeColor !== undefined ? page.strokeColor : state.strokeColor);
  drawVectorStrokeOnCanvas(ctx, frame, vertices, strokeWidth, strokeColor, state.strokeCaps || 'round');
  ctx.restore();
  ctx.restore();
}

function drawPageToCanvas(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  target: ExportTarget,
  imageCache: ImageCache,
  view: { scale: number; offsetX: number; offsetY: number },
  timing: RenderTiming
) {
  const { page } = target;
  const { width, height } = pageSize(state, page);
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);

  if (!target.frame) {
    ctx.fillStyle = state.borderColor || '#141210';
    ctx.fillRect(0, 0, width, height);
  }

  const frames = target.frame ? [target.frame] : page.frames.filter((frame) => !frame.hidden);
  frames.forEach((frame) => drawFrameToCanvas(ctx, state, target, frame, imageCache, timing));

  if (!target.frame) {
    const borderWidth = page.borderWidth !== undefined ? page.borderWidth : state.borderWidth;
    if (Number.isFinite(borderWidth) && borderWidth > 0) {
      ctx.save();
      ctx.strokeStyle = page.borderColor || state.borderColor || '#141210';
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(borderWidth / 2, borderWidth / 2, width - borderWidth, height - borderWidth);
      ctx.restore();
    }
  }
  ctx.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) {
          reject(new Error('Браузер не смог создать изображение. Уменьшите масштаб или проверьте внешние изображения и CORS.'));
          return;
        }
        if (blob.type && blob.type !== mimeType) {
          reject(new Error(`Браузер вернул формат ${blob.type} вместо ${mimeType}. Файл не сохранён.`));
          return;
        }
        resolve(blob);
      }, mimeType, quality);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(new Error(`Не удалось прочитать холст для экспорта. Проверьте внешние изображения и CORS. ${detail}`));
    }
  });
}

function frameFilename(frame: Frame): string {
  return sanitizeFilename(frame.name || `frame_${frame.id}`);
}

function exportFilename(target: ExportTarget, extension: string): string {
  const pageLabel = String(target.pageIndex + 1).padStart(3, '0');
  if (target.frame) return `frame_${pageLabel}_${frameFilename(target.frame)}.${extension}`;
  const pageName = target.page.name ? `_${sanitizeFilename(target.page.name)}` : '';
  return `page_${pageLabel}${pageName}.${extension}`;
}

/** Export PNG/JPG or a ZIP sequence. All-page output is always a single ZIP download. */
export async function exportToImages(
  state: AppState,
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<void> {
  const targets = resolveExportTargets(state, options.scope, options.selectedFrameId);
  const isSequence = options.format === 'sequence';
  const imageFormat = isSequence ? 'png' : options.format;
  if (imageFormat !== 'png' && imageFormat !== 'jpg') {
    throw new Error('Для растрового экспорта выберите PNG, JPG или ZIP-последовательность.');
  }
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1;
  const mimeType = imageFormat === 'jpg' ? 'image/jpeg' : 'image/png';
  const extension = imageFormat === 'jpg' ? 'jpg' : 'png';
  const quality = Number.isFinite(options.jpgQuality)
    ? Math.max(0, Math.min(1, options.jpgQuality / 100))
    : 0.92;
  const makeZip = isSequence || options.scope === 'all';
  reportProgress(onProgress, 2, 'Подготовка растрового экспорта...');
  const zipModule = makeZip ? await import('jszip') : null;
  const zip = zipModule ? new zipModule.default() : null;
  const manifest: Array<{ file: string; page: number; frameId?: number; width: number; height: number; mimeType: string }> = [];
  const imageCache = await loadImageCache(targets, onProgress, 5, 25);

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
    const target = targets[targetIndex];
    const { width: pageWidth, height: pageHeight } = pageSize(state, target.page);
    const crop = getFrameCrop(state, target);
    const sourceWidth = crop?.width ?? pageWidth;
    const sourceHeight = crop?.height ?? pageHeight;
    const canvasWidth = Math.ceil(sourceWidth * scale);
    const canvasHeight = Math.ceil(sourceHeight * scale);
    assertCanvasSize(canvasWidth, canvasHeight);

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Браузер не смог создать Canvas 2D. Попробуйте обновить страницу.');

    // JPEG and animated containers cannot retain transparent pixels around a cropped frame.
    if (!crop || imageFormat === 'jpg') {
      ctx.fillStyle = state.borderColor || '#141210';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    const offsetX = crop ? -crop.x * scale : 0;
    const offsetY = crop ? -crop.y * scale : 0;
    drawPageToCanvas(
      ctx,
      state,
      target,
      imageCache,
      { scale, offsetX, offsetY },
      { timeSeconds: 0, durationSeconds: 1, globalOffset: { x: 0, y: 0 }, localOffsetForFrame: () => ({ x: 0, y: 0 }) }
    );

    const blob = await canvasToBlob(canvas, mimeType, imageFormat === 'jpg' ? quality : undefined);
    const filename = exportFilename(target, extension);
    manifest.push({ file: filename, page: target.pageIndex + 1, frameId: target.frame?.id, width: canvasWidth, height: canvasHeight, mimeType });
    if (zip) {
      zip.file(filename, blob);
    } else {
      downloadBlob(blob, filename);
    }
    reportProgress(
      onProgress,
      25 + ((targetIndex + 1) / targets.length) * 60,
      `Отрисован файл ${targetIndex + 1} из ${targets.length}: ${canvasWidth} × ${canvasHeight}...`
    );
  }

  if (zip) {
    zip.file('manifest.json', JSON.stringify({
      application: 'VIBECOMIX',
      format: imageFormat,
      mimeType,
      scope: options.scope,
      files: manifest,
    }, null, 2));
    reportProgress(onProgress, 88, 'Сборка ZIP-архива...');
    const archive = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      (metadata) => reportProgress(onProgress, 88 + metadata.percent * 0.11, `Архивация: ${Math.round(metadata.percent)}%...`)
    );
    downloadBlob(archive, `vibecomix_${options.scope}_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
  }

  reportProgress(onProgress, 100, 'Растровый экспорт завершён.');
}

function getResolutionLongEdge(resolution: ExportOptions['resolution']): number {
  if (resolution === '720p') return 1280;
  if (resolution === '1080p') return 1920;
  return 3840;
}

function getAnimationCanvasSize(width: number, height: number, longEdge: number) {
  const scale = longEdge / Math.max(width, height);
  const canvasWidth = Math.max(1, Math.round(width * scale));
  const canvasHeight = Math.max(1, Math.round(height * scale));
  assertCanvasSize(canvasWidth, canvasHeight);
  return { width: canvasWidth, height: canvasHeight };
}

function getRenderTiming(frameIndex: number, fps: number, duration: number, frame: Frame): RenderTiming {
  const timeSeconds = frameIndex / fps;
  const angle = (timeSeconds / duration) * Math.PI * 2;
  const phase = frame.id * 0.17;
  return {
    timeSeconds,
    durationSeconds: duration,
    globalOffset: { x: Math.sin(angle), y: Math.cos(angle) },
    localOffsetForFrame: () => ({ x: Math.sin(angle + phase), y: Math.cos(angle + phase) }),
  };
}

export function addRgbaFrameToGif(
  encoder: GifEncoderInstance,
  api: GifencApi,
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  delayMs: number,
  isFirstFrame: boolean
) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65_535 || height > 65_535) {
    throw new Error('Некорректный размер GIF-кадра.');
  }
  if (pixels.length !== width * height * 4) {
    throw new Error('Данные пикселей GIF-кадра не соответствуют его размеру.');
  }
  const palette = api.quantize(pixels, 256, { format: 'rgb565' });
  const indexed = api.applyPalette(pixels, palette, 'rgb565');
  encoder.writeFrame(indexed, width, height, {
    palette,
    delay: Math.max(10, delayMs),
    repeat: isFirstFrame ? 0 : undefined,
  });
}

function gifFrameDelayMs(frameIndex: number, fps: number): number {
  // GIF stores delays in centiseconds; alternate integer delays so the average FPS stays accurate.
  const startCentiseconds = Math.round((frameIndex * 100) / fps);
  const endCentiseconds = Math.round(((frameIndex + 1) * 100) / fps);
  return Math.max(2, endCentiseconds - startCentiseconds) * 10;
}

function fitTargetToCanvas(
  state: AppState,
  target: ExportTarget,
  canvasWidth: number,
  canvasHeight: number
): { scale: number; offsetX: number; offsetY: number } {
  const crop = getFrameCrop(state, target);
  const { width: pageWidth, height: pageHeight } = pageSize(state, target.page);
  if (crop) {
    const scale = Math.min(canvasWidth / crop.width, canvasHeight / crop.height);
    return {
      scale,
      offsetX: (canvasWidth - crop.width * scale) / 2 - crop.x * scale,
      offsetY: (canvasHeight - crop.height * scale) / 2 - crop.y * scale,
    };
  }
  const scale = Math.min(canvasWidth / pageWidth, canvasHeight / pageHeight);
  return {
    scale,
    offsetX: (canvasWidth - pageWidth * scale) / 2,
    offsetY: (canvasHeight - pageHeight * scale) / 2,
  };
}

function renderAnimatedFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  state: AppState,
  target: ExportTarget,
  imageCache: ImageCache,
  timing: RenderTiming
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = state.borderColor || '#141210';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const view = fitTargetToCanvas(state, target, canvas.width, canvas.height);
  drawPageToCanvas(ctx, state, target, imageCache, view, timing);
}

function waitForFrame(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, milliseconds)));
}

function getVideoBitrate(preset: ExportOptions['bitrate']): number {
  if (preset === 'low') return 2_000_000;
  if (preset === 'high') return 25_000_000;
  return 8_000_000;
}

/** Render a real animated GIF or record real WebM/MP4. No simulated fallback files are produced. */
export async function exportToVideoOrGif(
  state: AppState,
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<void> {
  const isGif = options.format === 'gif';
  if (!isGif && options.format !== 'webm' && options.format !== 'mp4') {
    throw new Error('Выберите GIF, WEBM или MP4 для анимированного экспорта.');
  }
  if (isGif && options.resolution === '4k') {
    throw new Error('GIF ограничен разрешением 1080p для защиты памяти браузера. Выберите 720p или 1080p.');
  }

  const targets = resolveExportTargets(state, options.scope, options.selectedFrameId);
  const fps = Math.round(options.fps);
  const secondsPerPage = Number(options.duration);
  if (!Number.isFinite(fps) || fps < 1 || fps > 60 || !Number.isFinite(secondsPerPage) || secondsPerPage <= 0 || secondsPerPage > 60) {
    throw new Error('Проверьте частоту кадров и длительность экспорта.');
  }
  const framesPerTarget = Math.max(1, Math.round(fps * secondsPerPage));
  const totalFrames = framesPerTarget * targets.length;
  const maxFrames = isGif ? 600 : 3_000;
  if (totalFrames > maxFrames) {
    throw new Error(`${isGif ? 'GIF' : 'Видео'} содержит ${totalFrames} кадров. Лимит этого браузерного экспорта — ${maxFrames}. Уменьшите FPS/длительность или экспортируйте меньше листов.`);
  }

  const referenceTarget = targets.find((target) => target.pageIndex === state.currentPage) || targets[0];
  const referenceCrop = getFrameCrop(state, referenceTarget);
  const referenceSize = referenceCrop || pageSize(state, referenceTarget.page);
  const output = getAnimationCanvasSize(referenceSize.width, referenceSize.height, getResolutionLongEdge(options.resolution));
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не смог создать Canvas 2D. Попробуйте другой браузер или уменьшите разрешение.');

  const animationHost = document.createElement('div');
  animationHost.style.position = 'fixed';
  animationHost.style.left = '-9999px';
  animationHost.style.top = '-9999px';
  animationHost.style.width = '1px';
  animationHost.style.height = '1px';
  animationHost.style.opacity = '0.01';
  animationHost.style.pointerEvents = 'none';
  animationHost.style.overflow = 'hidden';
  document.body.appendChild(animationHost);

  try {
    reportProgress(onProgress, 2, `Подготовка ${isGif ? 'GIF' : 'видео'}: ${output.width} × ${output.height}...`);
    const imageCache = await loadImageCache(targets, onProgress, 5, 18, animationHost);

    if (isGif) {
      reportProgress(onProgress, 18, 'Загрузка настоящего GIF-кодировщика...');
      const gifApi = await loadGifencApi();
      const encoder = gifApi.GIFEncoder();
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        const targetIndex = Math.floor(frameIndex / framesPerTarget);
        const localFrameIndex = frameIndex % framesPerTarget;
        const target = targets[targetIndex];
        const representativeFrame = target.frame || target.page.frames.find((frame) => !frame.hidden) || ({ id: target.pageIndex + 1 } as Frame);
        const timing = getRenderTiming(localFrameIndex, fps, secondsPerPage, representativeFrame);
        renderAnimatedFrame(canvas, ctx, state, target, imageCache, timing);

        let pixels: ImageData;
        try {
          pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Не удалось прочитать пиксели кадра GIF. Проверьте доступ к изображениям и CORS. ${detail}`);
        }
        addRgbaFrameToGif(encoder, gifApi, pixels.data, canvas.width, canvas.height, gifFrameDelayMs(frameIndex, fps), frameIndex === 0);
        reportProgress(
          onProgress,
          18 + ((frameIndex + 1) / totalFrames) * 78,
          `Кодирование GIF: лист ${target.pageIndex + 1}, кадр ${localFrameIndex + 1} из ${framesPerTarget}...`
        );
        // Let the browser update progress and process UI events between CPU-heavy frames.
        await waitForFrame(0);
      }
      encoder.finish();
      const bytes = encoder.bytes();
      if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 6)) !== 'GIF89a' || bytes[bytes.length - 1] !== 0x3b) {
        throw new Error('GIF-кодировщик вернул некорректный файл. Повторите экспорт с меньшим разрешением.');
      }
      const gifBlob = new Blob([bytes], { type: 'image/gif' });
      downloadBlob(gifBlob, `vibecomix_${options.scope}_${new Date().toISOString().replace(/[:.]/g, '-')}.gif`);
      reportProgress(onProgress, 100, 'GIF готов.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Запись видео недоступна в этом браузере. Попробуйте WEBM в актуальной версии Chrome или экспортируйте GIF.');
    }
    const format = options.format as 'webm' | 'mp4';
    let mimeType: string | null = null;
    try {
      mimeType = findSupportedVideoMimeType(format, (type) => MediaRecorder.isTypeSupported(type));
    } catch {
      mimeType = null;
    }
    if (!mimeType) {
      throw new Error(format === 'mp4'
        ? 'Этот браузер не умеет создавать настоящий MP4. Выберите WEBM или откройте проект в браузере с поддержкой MP4.'
        : 'Этот браузер не поддерживает запись WEBM через MediaRecorder. Выберите GIF или используйте актуальную версию Chrome/Edge.');
    }

    let stream: MediaStream;
    let requestFrame: (() => void) | undefined;
    try {
      const manualStream = canvas.captureStream(0);
      const videoTrack = manualStream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
      if (videoTrack?.requestFrame) {
        stream = manualStream;
        requestFrame = () => videoTrack.requestFrame?.();
      } else {
        manualStream.getTracks().forEach((track) => track.stop());
        stream = canvas.captureStream(fps);
      }
    } catch {
      try {
        stream = canvas.captureStream(fps);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Браузер не смог захватить Canvas для видеозаписи. ${detail}`);
      }
    }
    if (!stream.getVideoTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Браузер создал видеопоток без видео-дорожки. Экспорт отменён.');
    }

    const chunks: Blob[] = [];
    let resolveFinished!: (blob: Blob) => void;
    let rejectFinished!: (error: Error) => void;
    const finished = new Promise<Blob>((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });
    // Prevent a browser error event from becoming an unhandled rejection before the render loop finishes.
    void finished.catch(() => undefined);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: getVideoBitrate(options.bitrate) });
    } catch (firstError) {
      try {
        // Some browser encoders accept the container but reject an explicit bitrate hint.
        recorder = new MediaRecorder(stream, { mimeType });
      } catch (secondError) {
        stream.getTracks().forEach((track) => track.stop());
        const detail = secondError instanceof Error ? secondError.message : String(firstError);
        throw new Error(`Браузер сообщил о поддержке ${mimeType}, но не смог создать кодировщик. ${detail}`);
      }
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      const detail = (event as Event & { error?: DOMException }).error?.message;
      rejectFinished(new Error(`Ошибка кодирования видео${detail ? `: ${detail}` : '.'}`));
    };
    recorder.onstop = () => {
      const actualMimeType = recorder.mimeType || mimeType;
      const expectedContainer = format === 'mp4' ? 'video/mp4' : 'video/webm';
      if (!actualMimeType.toLowerCase().startsWith(expectedContainer)) {
        rejectFinished(new Error(`Браузер выдал ${actualMimeType || 'неизвестный MIME'} вместо ${expectedContainer}. Файл не сохранён.`));
        return;
      }
      const blob = new Blob(chunks, { type: actualMimeType });
      if (!blob.size) {
        rejectFinished(new Error('Видеокодировщик не вернул данные. Повторите экспорт или выберите другой формат.'));
        return;
      }
      resolveFinished(blob);
    };

    let recorderStarted = false;
    try {
      const firstTarget = targets[0];
      renderAnimatedFrame(
        canvas,
        ctx,
        state,
        firstTarget,
        imageCache,
        getRenderTiming(0, fps, secondsPerPage, firstTarget.frame || firstTarget.page.frames.find((frame) => !frame.hidden) || ({ id: 0 } as Frame))
      );
      recorder.start();
      recorderStarted = true;
      requestFrame?.();

      const intervalMs = 1000 / fps;
      let nextFrameAt = performance.now() + intervalMs;
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (frameIndex > 0) {
          const targetIndex = Math.floor(frameIndex / framesPerTarget);
          const localFrameIndex = frameIndex % framesPerTarget;
          const target = targets[targetIndex];
          const representativeFrame = target.frame || target.page.frames.find((frame) => !frame.hidden) || ({ id: target.pageIndex + 1 } as Frame);
          const timing = getRenderTiming(localFrameIndex, fps, secondsPerPage, representativeFrame);
          renderAnimatedFrame(canvas, ctx, state, target, imageCache, timing);
          requestFrame?.();
        }

        const targetIndex = Math.floor(frameIndex / framesPerTarget);
        const localFrameIndex = frameIndex % framesPerTarget;
        const target = targets[targetIndex];
        reportProgress(
          onProgress,
          18 + ((frameIndex + 1) / totalFrames) * 78,
          `Запись видео: лист ${target.pageIndex + 1}, кадр ${localFrameIndex + 1} из ${framesPerTarget}...`
        );
        const waitMs = nextFrameAt - performance.now();
        if (waitMs > 0) await waitForFrame(waitMs);
        nextFrameAt += intervalMs;
      }

      recorder.stop();
      const blob = await new Promise<Blob>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error('Браузер слишком долго завершает видео. Уменьшите разрешение или длительность.')), 90_000);
        finished.then(
          (recordedBlob) => {
            window.clearTimeout(timeoutId);
            resolve(recordedBlob);
          },
          (error) => {
            window.clearTimeout(timeoutId);
            reject(error);
          }
        );
      });
      const extension = blob.type.toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `vibecomix_${options.scope}_${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`);
      reportProgress(onProgress, 100, `${extension.toUpperCase()}-видео готово.`);
    } catch (error) {
      if (recorderStarted && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* The recorder may already have stopped after an encoding error. */ }
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  } finally {
    animationHost.remove();
  }
}
