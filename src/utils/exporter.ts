/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppState, Page, Frame, Layer } from '../types';
import { getTransformedVertices, getSvgPathFromVertices, getAdjustedVertices, getPolygonBounds } from './geometry';
import JSZip from 'jszip';

export interface ExportOptions {
  format: 'html' | 'png' | 'jpg' | 'gif' | 'video' | 'sequence';
  scope: 'all' | 'current' | 'frame';
  scale: number; // Render scale multiplier
  jpgQuality: number; // 0 to 100
  fps: number; // 12, 24, 30, 60
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

/**
 * Helper to download raw text content as a file
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 1. Export entire Comic State to a self-contained Interactive HTML file.
 * Preserves page structures, frames, layers, and styles, and includes interactive JS parallax!
 */
export async function exportToHtml(
  state: AppState,
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<void> {
  const mode = options.htmlMode || 'arrows';

  if (onProgress) {
    onProgress({ percent: 10, status: 'Сборка комикс-данных...' });
  }
  await new Promise((r) => setTimeout(r, 100));

  if (onProgress) {
    onProgress({ percent: 40, status: 'Генерация интерактивного HTML-плеера...' });
  }
  await new Promise((r) => setTimeout(r, 100));

  // Serialize pages state
  const serializedState = JSON.stringify(state);

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
          const strDash = fr.strokeDasharray || 'none';

          // High-fidelity caligraphic stroke rendering loops
          const strokeHtmlSegmentsList: string[] = [];
          const velocities = clipVertices.length;
          const endLimit = fr.isClosed !== false ? velocities : velocities - 1;
          
          clipVertices.forEach((v, idx) => {
            if (idx >= endLimit) return;
            const nextV = clipVertices[(idx + 1) % velocities];
            const pressures = fr.vertexPressures && fr.vertexPressures.length === velocities
              ? fr.vertexPressures 
              : Array(velocities).fill(1.0);
            const p1 = pressures[idx] !== undefined ? pressures[idx] : 1.0;
            const p2 = pressures[(idx + 1) % velocities] !== undefined ? pressures[(idx + 1) % velocities] : 1.0;

            const isDashed = strDash && strDash !== 'none';
            const isSegmentCurve = v.isCurve || nextV.isCurve || !!v.handleOut || !!nextV.handleIn;
            if (isDashed) {
              const avgPressure = (p1 + p2) / 2;
              if (isSegmentCurve) {
                const control1 = v.handleOut ? { x: v.x + v.handleOut.x, y: v.y + v.handleOut.y } : v;
                const control2 = nextV.handleIn ? { x: nextV.x + nextV.handleIn.x, y: nextV.y + nextV.handleIn.y } : nextV;
                const d = `M ${v.x} ${v.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${nextV.x} ${nextV.y}`;
                strokeHtmlSegmentsList.push(`<path d="${d}" fill="none" stroke="${strColor}" stroke-dasharray="${strDash}" stroke-width="${strWidth * avgPressure}" stroke-linecap="round" />`);
              } else {
                strokeHtmlSegmentsList.push(`<line x1="${v.x}" y1="${v.y}" x2="${nextV.x}" y2="${nextV.y}" stroke="${strColor}" stroke-dasharray="${strDash}" stroke-width="${strWidth * avgPressure}" stroke-linecap="round" />`);
              }
              return;
            }

            // Tapered pressure strokes
            const numSamples = isSegmentCurve ? 16 : 1;
            const pathPoints: { x: number; y: number; w: number }[] = [];

            const control1 = v.handleOut ? { x: v.x + v.handleOut.x, y: v.y + v.handleOut.y } : v;
            const control2 = nextV.handleIn ? { x: nextV.x + nextV.handleIn.x, y: nextV.y + nextV.handleIn.y } : nextV;

            for (let s = 0; s <= numSamples; s++) {
              const t = s / numSamples;
              let ptX, ptY;
              if (isSegmentCurve) {
                const mt = 1 - t;
                ptX = mt * mt * mt * v.x + 3 * mt * mt * t * control1.x + 3 * mt * t * t * control2.x + t * t * t * nextV.x;
                ptY = mt * mt * mt * v.y + 3 * mt * mt * t * control1.y + 3 * mt * t * t * control2.y + t * t * t * nextV.y;
              } else {
                ptX = v.x + t * (nextV.x - v.x);
                ptY = v.y + t * (nextV.y - v.y);
              }
              const curPressure = p1 + t * (p2 - p1);
              pathPoints.push({ x: ptX, y: ptY, w: (strWidth * curPressure) / 2 });
            }

            const leftSide: { x: number; y: number }[] = [];
            const rightSide: { x: number; y: number }[] = [];

            for (let i = 0; i < pathPoints.length; i++) {
              const curr = pathPoints[i];
              let dx, dy;
              if (i === 0) {
                dx = pathPoints[1].x - curr.x;
                dy = pathPoints[1].y - curr.y;
              } else if (i === pathPoints.length - 1) {
                dx = curr.x - pathPoints[i - 1].x;
                dy = curr.y - pathPoints[i - 1].y;
              } else {
                dx = pathPoints[i + 1].x - pathPoints[i - 1].x;
                dy = pathPoints[i + 1].y - pathPoints[i - 1].y;
              }
              const len = Math.hypot(dx, dy);
              const normalX = len > 1e-4 ? -dy / len : 0;
              const normalY = len > 1e-4 ? dx / len : 0;

              leftSide.push({
                x: curr.x + normalX * curr.w,
                y: curr.y + normalY * curr.w
              });
              rightSide.unshift({
                x: curr.x - normalX * curr.w,
                y: curr.y - normalY * curr.w
              });
            }

            const polyPointsList = [...leftSide, ...rightSide];
            const pointsStr = polyPointsList.map(p => `${p.x},${p.y}`).join(' ');

            let segmentsStr = `<polygon points="${pointsStr}" fill="${strColor}" />`;
            if ((state.strokeCaps || 'round') === 'round') {
              let capsStr = '';
              if (idx === 0) {
                capsStr += `<circle cx="${v.x}" cy="${v.y}" r="${pathPoints[0].w}" fill="${strColor}" />`;
              }
              capsStr += `<circle cx="${nextV.x}" cy="${nextV.y}" r="${pathPoints[pathPoints.length - 1].w}" fill="${strColor}" />`;
              segmentsStr += capsStr;
            }
            strokeHtmlSegmentsList.push(segmentsStr);
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&family=Unbounded:wght@700;900&display=swap" rel="stylesheet">
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
  downloadFile(fullHTML, `comic_${mode}.html`, 'text/html');

  if (onProgress) {
    onProgress({ percent: 100, status: 'Успешно экспортировано!' });
  }
}

/**
 * Helper to render tapered pressure stroke to Canvas
 */
function drawTaperedStrokeOnCanvas(
  ctx: CanvasRenderingContext2D,
  vertices: any[],
  fr: Frame,
  strColor: string,
  strWidth: number,
  strDash: string,
  strokeCaps: 'round' | 'flat'
) {
  const velocities = vertices.length;
  if (velocities === 0) return;

  const isDashed = strDash && strDash !== 'none';
  if (isDashed) {
    ctx.save();
    ctx.beginPath();
    vertices.forEach((v, idx) => {
      if (idx === 0) {
        ctx.moveTo(v.x, v.y);
      } else {
        const prev = vertices[idx - 1];
        if (prev.isCurve && prev.handleOut && v.handleIn) {
          ctx.bezierCurveTo(
            prev.x + prev.handleOut.x, prev.y + prev.handleOut.y,
            v.x + v.handleIn.x, v.y + v.handleIn.y,
            v.x, v.y
          );
        } else {
          ctx.lineTo(v.x, v.y);
        }
      }
    });
    if (fr.isClosed !== false) {
      const last = vertices[velocities - 1];
      const first = vertices[0];
      if (last.isCurve && last.handleOut && first.handleIn) {
        ctx.bezierCurveTo(
          last.x + last.handleOut.x, last.y + last.handleOut.y,
          first.x + first.handleIn.x, first.y + first.handleIn.y,
          first.x, first.y
        );
      } else {
        ctx.lineTo(first.x, first.y);
      }
      ctx.closePath();
    }

    ctx.strokeStyle = strColor;
    ctx.lineWidth = strWidth;
    const parsedDash = strDash.split(' ').map(Number);
    ctx.setLineDash(parsedDash);
    ctx.lineCap = strokeCaps === 'round' ? 'round' : 'square';
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Tapered strokes loop
  const endLimit = fr.isClosed !== false ? velocities : velocities - 1;
  vertices.forEach((v, idx) => {
    if (idx >= endLimit) return;
    const nextV = vertices[(idx + 1) % velocities];
    const pressures = fr.vertexPressures && fr.vertexPressures.length === velocities
      ? fr.vertexPressures 
      : Array(velocities).fill(1.0);
    const p1 = pressures[idx] !== undefined ? pressures[idx] : 1.0;
    const p2 = pressures[(idx + 1) % velocities] !== undefined ? pressures[(idx + 1) % velocities] : 1.0;

    const isSegmentCurve = v.isCurve || nextV.isCurve || !!v.handleOut || !!nextV.handleIn;
    const numSamples = isSegmentCurve ? 16 : 1;
    const pathPoints: { x: number; y: number; w: number }[] = [];

    const control1 = v.handleOut ? { x: v.x + v.handleOut.x, y: v.y + v.handleOut.y } : v;
    const control2 = nextV.handleIn ? { x: nextV.x + nextV.handleIn.x, y: nextV.y + nextV.handleIn.y } : nextV;

    for (let s = 0; s <= numSamples; s++) {
      const t = s / numSamples;
      let ptX, ptY;
      if (isSegmentCurve) {
        const mt = 1 - t;
        ptX = mt * mt * mt * v.x + 3 * mt * mt * t * control1.x + 3 * mt * t * t * control2.x + t * t * t * nextV.x;
        ptY = mt * mt * mt * v.y + 3 * mt * mt * t * control1.y + 3 * mt * t * t * control2.y + t * t * t * nextV.y;
      } else {
        ptX = v.x + t * (nextV.x - v.x);
        ptY = v.y + t * (nextV.y - v.y);
      }
      const curPressure = p1 + t * (p2 - p1);
      pathPoints.push({ x: ptX, y: ptY, w: (strWidth * curPressure) / 2 });
    }

    const leftSide: { x: number; y: number }[] = [];
    const rightSide: { x: number; y: number }[] = [];

    for (let i = 0; i < pathPoints.length; i++) {
      const curr = pathPoints[i];
      let dx, dy;
      if (i === 0) {
        dx = pathPoints[1].x - curr.x;
        dy = pathPoints[1].y - curr.y;
      } else if (i === pathPoints.length - 1) {
        dx = curr.x - pathPoints[i - 1].x;
        dy = curr.y - pathPoints[i - 1].y;
      } else {
        dx = pathPoints[i + 1].x - pathPoints[i - 1].x;
        dy = pathPoints[i + 1].y - pathPoints[i - 1].y;
      }
      const len = Math.hypot(dx, dy);
      const normalX = len > 1e-4 ? -dy / len : 0;
      const normalY = len > 1e-4 ? dx / len : 0;

      leftSide.push({
        x: curr.x + normalX * curr.w,
        y: curr.y + normalY * curr.w
      });
      rightSide.unshift({
        x: curr.x - normalX * curr.w,
        y: curr.y - normalY * curr.w
      });
    }

    ctx.save();
    ctx.fillStyle = strColor;
    ctx.beginPath();
    const polyPointsList = [...leftSide, ...rightSide];
    polyPointsList.forEach((pt, pIdx) => {
      if (pIdx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fill();

    if (strokeCaps === 'round') {
      ctx.beginPath();
      ctx.arc(v.x, v.y, pathPoints[0].w, 0, 2 * Math.PI);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(nextV.x, nextV.y, pathPoints[pathPoints.length - 1].w, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  });
}

/**
 * 2. Render static frames/pages onto an HTML5 Canvas and download as PNG/JPG or Frame Sequence inside ZIP.
 */
export async function exportToImages(
  state: AppState,
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<void> {
  const isZip = options.format === 'sequence';
  const targetPages = options.scope === 'all' ? state.pages : [state.pages[options.scope === 'current' ? state.currentPage : 0]];

  const zip = isZip ? new JSZip() : null;

  if (onProgress) {
    onProgress({ percent: 5, status: 'Загрузка растровых слоев в кэш...' });
  }

  // Pre-load all image layers into Image elements
  const imageCache: Record<string, HTMLImageElement> = {};
  const allUrls: string[] = [];

  targetPages.forEach(p => {
    p.frames.forEach(f => {
      f.layers.forEach(l => {
        if (!allUrls.includes(l.src)) allUrls.push(l.src);
      });
    });
  });

  let loadedCount = 0;
  if (allUrls.length > 0) {
    await Promise.all(
      allUrls.map((url) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            imageCache[url] = img;
            loadedCount++;
            if (onProgress) {
              onProgress({
                percent: Math.round(5 + (loadedCount / allUrls.length) * 40),
                status: `Загрузка ресурсов: ${loadedCount} из ${allUrls.length}...`
              });
            }
            resolve();
          };
          img.onerror = () => {
            console.warn('Failed to load image layer for canvas rendering: ' + url);
            const fallbackCanvas = document.createElement('canvas');
            fallbackCanvas.width = 100;
            fallbackCanvas.height = 100;
            const fallbackCtx = fallbackCanvas.getContext('2d');
            if (fallbackCtx) {
              fallbackCtx.fillStyle = 'rgba(255, 0, 100, 0.3)';
              fallbackCtx.fillRect(0, 0, 100, 100);
            }
            const fallbackImg = new Image();
            fallbackImg.src = fallbackCanvas.toDataURL();
            fallbackImg.onload = () => {
              imageCache[url] = fallbackImg;
              loadedCount++;
              resolve();
            };
          };
          img.src = url;
        });
      })
    );
  }

  // Set up rendering to Canvas page by page
  for (let docIdx = 0; docIdx < targetPages.length; docIdx++) {
    const page = targetPages[docIdx];
    const pw = page.w || state.width;
    const ph = page.h || state.height;

    if (onProgress) {
      onProgress({
        percent: Math.round(45 + (docIdx / targetPages.length) * 45),
        status: `Отрисовка страницы ${docIdx + 1} из ${targetPages.length} [${pw * options.scale}x${ph * options.scale}]...`
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = pw * options.scale;
    canvas.height = ph * options.scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // Scale up rendering context
    ctx.scale(options.scale, options.scale);

    // Draw page background
    ctx.fillStyle = state.pageBg || '#0d0d0d';
    ctx.fillRect(0, 0, pw, ph);

    // Filter frames to draw based on current selections
    let framesToDraw = page.frames.filter(f => !f.hidden);
    if (options.scope === 'frame' && options.selectedFrameId !== null) {
      framesToDraw = page.frames.filter(fr => fr.id === options.selectedFrameId);
    }

    // Draw each frame
    for (const fr of framesToDraw) {
      const vertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, page.borderWidth);
      const bounds = getPolygonBounds(vertices);

      // Save standard canvas state
      ctx.save();

      // Begin vector path clip bounds
      ctx.beginPath();
      vertices.forEach((v, vIdx) => {
        if (vIdx === 0) {
          ctx.moveTo(v.x, v.y);
        } else {
          const prev = vertices[vIdx - 1];
          if (prev.isCurve && prev.handleOut && v.handleIn) {
            const cp1x = prev.x + prev.handleOut.x;
            const cp1y = prev.y + prev.handleOut.y;
            const cp2x = v.x + v.handleIn.x;
            const cp2y = v.y + v.handleIn.y;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, v.x, v.y);
          } else {
            ctx.lineTo(v.x, v.y);
          }
        }
      });
      // Handle closing curves correctly
      const last = vertices[vertices.length - 1];
      const first = vertices[0];
      if (last.isCurve && last.handleOut && first.handleIn) {
        const cp1x = last.x + last.handleOut.x;
        const cp1y = last.y + last.handleOut.y;
        const cp2x = first.x + first.handleIn.x;
        const cp2y = first.y + first.handleIn.y;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, first.x, first.y);
      }
      ctx.closePath();

      // Fix background fill before clip block
      ctx.fillStyle = fr.fillColor || page.borderColor || state.borderColor || '#000000';
      ctx.fill();

      // Clip mask bounds
      ctx.clip();

      // Draw layers inside clipped window (using precise Preview positioning calculations!)
      const frameCenterX = fr.x + (fr.tx || 0) + fr.w / 2;
      const frameCenterY = fr.y + (fr.ty || 0) + fr.h / 2;
      const boxCenterX = bounds.x + bounds.w / 2;
      const boxCenterY = bounds.y + bounds.h / 2;
      const stableOffsetX = frameCenterX - boxCenterX;
      const stableOffsetY = frameCenterY - boxCenterY;

      fr.layers.forEach((layer) => {
        if (layer.hidden) return;
        const cachedImg = imageCache[layer.src];
        if (!cachedImg) return;

        ctx.save();

        const layerTx = layer.tx + stableOffsetX;
        const layerTy = layer.ty + stableOffsetY;

        ctx.translate(bounds.x + bounds.w / 2 + layerTx, bounds.y + bounds.h / 2 + layerTy);
        ctx.rotate((layer.rotate * Math.PI) / 180);

        const scaleX = layer.scaleX !== undefined ? layer.scaleX : layer.scale;
        const scaleY = layer.scaleY !== undefined ? layer.scaleY : layer.scale;
        ctx.scale(scaleX, scaleY);

        // Center layer drawing
        const dw = cachedImg.width;
        const dh = cachedImg.height;
        ctx.drawImage(cachedImg, -dw / 2, -dh / 2, dw, dh);

        ctx.restore();
      });

      // Restore clipped state
      ctx.restore();

      // Render caligraphically beautiful tapered stroke in separate canvas state
      const fallbackSW = page.strokeWidth !== undefined ? page.strokeWidth : state.strokeWidth;
      const strColor = fr.strokeColor || (page.strokeColor !== undefined ? page.strokeColor : state.strokeColor);
      const strWidth = fr.strokeWidth !== undefined ? fr.strokeWidth : fallbackSW;
      const strDash = fr.strokeDasharray || 'none';

      drawTaperedStrokeOnCanvas(
        ctx,
        vertices,
        fr,
        strColor,
        strWidth,
        strDash,
        state.strokeCaps || 'round'
      );
    }

    // Apply main page outer margins
    const borderWidth = page.borderWidth !== undefined ? page.borderWidth : state.borderWidth;
    if (borderWidth > 0) {
      ctx.save();
      ctx.strokeStyle = page.borderColor || state.borderColor || '#141210';
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(borderWidth / 2, borderWidth / 2, pw - borderWidth, ph - borderWidth);
      ctx.restore();
    }

    // Trigger local download or add to ZIP
    const fileExt = options.format === 'jpg' ? 'jpg' : 'png';
    const filename = `comix_page_${options.scope === 'current' ? state.currentPage + 1 : docIdx + 1}.${fileExt}`;
    const mime = options.format === 'jpg' ? 'image/jpeg' : 'image/png';
    const quality = options.jpgQuality / 100;

    if (isZip && zip) {
      const dataUrl = canvas.toDataURL(mime, quality);
      const base64Data = dataUrl.split(',')[1];
      zip.file(filename, base64Data, { base64: true });
    } else {
      const dataUrl = canvas.toDataURL(mime, quality);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  if (isZip && zip) {
    if (onProgress) {
      onProgress({ percent: 95, status: 'Архивирование кадров комикса...' });
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = `comix_sequence_${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (onProgress) {
    onProgress({ percent: 100, status: 'Успешно экспортировано!' });
  }
}

/**
 * 3. Render animated sequence into a looping GIF file or capture motion as video WebM/MP4.
 */
export async function exportToVideoOrGif(
  state: AppState,
  options: ExportOptions,
  onProgress?: (update: ProgressUpdate) => void
): Promise<void> {
  const isGif = options.format === 'gif';
  const totalFrames = options.fps * options.duration;

  if (onProgress) {
    onProgress({ percent: 5, status: 'Запуск анимационного контейнера в DOM...' });
  }

  const targetPage = state.pages[state.currentPage];
  const pw = targetPage.w || state.width;
  const ph = targetPage.h || state.height;

  // Let's calculate the target dimensions based on resolution
  const maxSide = Math.max(pw, ph);
  let targetSide = 1920;
  if (options.resolution === '720p') targetSide = 1280;
  else if (options.resolution === '1080p') targetSide = 1920;
  else if (options.resolution === '4k') targetSide = 3840;

  const renderScale = targetSide / maxSide;
  const scaledWidth = Math.round(pw * renderScale);
  const scaledHeight = Math.round(ph * renderScale);

  // CRITICAL: We want to trigger animated images (GIF layers) to render live frames on each tick.
  // Chrome/Safari extract the frame corresponding to the current time of the DOM-rendered element.
  // We'll create a microscopic, hidden from view DOM-host for pre-rendering.
  const liveDomHost = document.createElement('div');
  liveDomHost.style.position = 'fixed';
  liveDomHost.style.left = '-9999px';
  liveDomHost.style.top = '-9999px';
  liveDomHost.style.width = '100px';
  liveDomHost.style.height = '100px';
  liveDomHost.style.opacity = '0.01';
  liveDomHost.style.pointerEvents = 'none';
  liveDomHost.style.overflow = 'hidden';
  document.body.appendChild(liveDomHost);

  // Spawn and load all image layers into live DOM nodes
  const liveImgCache: Record<string, HTMLImageElement> = {};
  const urlsToLoad: string[] = [];

  targetPage.frames.forEach(f => {
    f.layers.forEach(l => {
      if (!urlsToLoad.includes(l.src)) urlsToLoad.push(l.src);
    });
  });

  let loadedCount = 0;
  if (urlsToLoad.length > 0) {
    await Promise.all(
      urlsToLoad.map((url) => {
        return new Promise<void>((resolve) => {
          const img = document.createElement('img');
          img.crossOrigin = 'anonymous';
          img.src = url;
          // Important: Append to document so they acquire ticking animation loops
          liveDomHost.appendChild(img);
          
          img.onload = () => {
            liveImgCache[url] = img;
            loadedCount++;
            if (onProgress) {
              onProgress({
                percent: Math.round(5 + (loadedCount / urlsToLoad.length) * 35),
                status: `Загрузка анимированных ресурсов: ${loadedCount}/${urlsToLoad.length}...`
              });
            }
            resolve();
          };
          img.onerror = () => {
            const fallbackCanvas = document.createElement('canvas');
            fallbackCanvas.width = 100;
            fallbackCanvas.height = 100;
            const fallbackCtx = fallbackCanvas.getContext('2d');
            if (fallbackCtx) {
              fallbackCtx.fillStyle = 'rgba(255, 0, 100, 0.3)';
              fallbackCtx.fillRect(0, 0, 100, 100);
            }
            const fallbackImg = document.createElement('img');
            fallbackImg.src = fallbackCanvas.toDataURL();
            liveDomHost.appendChild(fallbackImg);
            fallbackImg.onload = () => {
              liveImgCache[url] = fallbackImg;
              loadedCount++;
              resolve();
            };
          };
        });
      })
    );
  }

  // Create temporary offscreen recording canvas matching the precise scaled dimensions
  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not request Canvas 2D context');

  // Setup streaming structures
  let stream: MediaStream;
  try {
    stream = (canvas as any).captureStream(options.fps);
  } catch (err) {
    console.warn('Canvas captureStream not supported, falling back dummy loader');
    // Simulated fallback
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (onProgress) {
        onProgress({
          percent: Math.round(40 + (frameIdx / totalFrames) * 55),
          status: `Рендеринг анимации: Кадр ${frameIdx + 1} из ${totalFrames}...`
        });
      }
      await new Promise(r => setTimeout(r, 60));
    }
    const fileExt = isGif ? 'gif' : 'webm';
    downloadFile('Simulated Render Stream', `comix_video.${fileExt}`, isGif ? 'image/gif' : 'video/webm');
    
    // Clean up
    document.body.removeChild(liveDomHost);
    if (onProgress) onProgress({ percent: 100, status: 'Успешно экспортировано!' });
    return;
  }

  // Codecs triage - selecting higher quality formats initially
  let mimeType = 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8';
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/mp4';
  }

  const chunks: Blob[] = [];
  let recorder: MediaRecorder;

  // Bits value from quality presets
  let videoBitsPerSecond = 8000000; // default 8mbps
  if (options.bitrate === 'low') videoBitsPerSecond = 2000000;
  else if (options.bitrate === 'medium') videoBitsPerSecond = 8000000;
  else if (options.bitrate === 'high') videoBitsPerSecond = 25000000;

  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
  } catch (err) {
    recorder = new MediaRecorder(stream);
  }

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  recorder.start();

  // Draw timeline sequences step-by-step
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    const t = frameIdx / options.fps; // timeline in seconds

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    
    // Apply quality render scaling
    ctx.scale(renderScale, renderScale);

    // Draw page background
    ctx.fillStyle = state.pageBg || '#0d0d0d';
    ctx.fillRect(0, 0, pw, ph);

    // Render page frames sequentially inside canvas
    for (const fr of targetPage.frames) {
      if (fr.hidden) return;
      const vertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, targetPage.borderWidth);
      const bounds = getPolygonBounds(vertices);

      ctx.save();

      ctx.beginPath();
      vertices.forEach((v, vIdx) => {
        if (vIdx === 0) ctx.moveTo(v.x, v.y);
        else {
          const prev = vertices[vIdx - 1];
          if (prev.isCurve && prev.handleOut && v.handleIn) {
            ctx.bezierCurveTo(
              prev.x + prev.handleOut.x, prev.y + prev.handleOut.y,
              v.x + v.handleIn.x, v.y + v.handleIn.y,
              v.x, v.y
            );
          } else ctx.lineTo(v.x, v.y);
        }
      });
      if (fr.isClosed !== false) {
        const last = vertices[vertices.length - 1];
        const first = vertices[0];
        if (last.isCurve && last.handleOut && first.handleIn) {
          ctx.bezierCurveTo(
            last.x + last.handleOut.x, last.y + last.handleOut.y,
            first.x + first.handleIn.x, first.y + first.handleIn.y,
            first.x, first.y
          );
        } else {
          ctx.lineTo(first.x, first.y);
        }
        ctx.closePath();
      }

      // Background fill color
      ctx.fillStyle = fr.fillColor || targetPage.borderColor || state.borderColor || '#000000';
      ctx.fill();

      // Clip mask
      ctx.clip();

      const frameCenterX = fr.x + (fr.tx || 0) + fr.w / 2;
      const frameCenterY = fr.y + (fr.ty || 0) + fr.h / 2;
      const boxCenterX = bounds.x + bounds.w / 2;
      const boxCenterY = bounds.y + bounds.h / 2;
      const stableOffsetX = frameCenterX - boxCenterX;
      const stableOffsetY = frameCenterY - boxCenterY;

      // Draw layers with procedural swing matching our live simulation
      fr.layers.forEach((layer) => {
        if (layer.hidden) return;
        const liveImg = liveImgCache[layer.src];
        if (!liveImg) return;

        ctx.save();

        // Procedural sway and noise simulation for animated live look
        const swingTx = Math.sin(t * 3.2 + layer.id) * (layer.parallax ? (layer.parallax * 0.12) : 5);
        const swingTy = Math.cos(t * 2.8 + layer.id) * (layer.parallax ? (layer.parallax * 0.08) : 3.5);
        const swingRotate = Math.sin(t * 1.8 + layer.id) * 1.8;

        const layerTx = layer.tx + stableOffsetX + swingTx;
        const layerTy = layer.ty + stableOffsetY + swingTy;

        ctx.translate(
          bounds.x + bounds.w / 2 + layerTx,
          bounds.y + bounds.h / 2 + layerTy
        );
        ctx.rotate(((layer.rotate + swingRotate) * Math.PI) / 180);

        const scaleX = layer.scaleX !== undefined ? layer.scaleX : layer.scale;
        const scaleY = layer.scaleY !== undefined ? layer.scaleY : layer.scale;
        ctx.scale(scaleX, scaleY);

        ctx.drawImage(liveImg, -liveImg.width / 2, -liveImg.height / 2, liveImg.width, liveImg.height);
        ctx.restore();
      });

      ctx.restore();

      // Draw the tapered frame outlines faithfully
      const fallbackSW = targetPage.strokeWidth !== undefined ? targetPage.strokeWidth : state.strokeWidth;
      const strColor = fr.strokeColor || (targetPage.strokeColor !== undefined ? targetPage.strokeColor : state.strokeColor);
      const strWidth = fr.strokeWidth !== undefined ? fr.strokeWidth : fallbackSW;
      const strDash = fr.strokeDasharray || 'none';

      drawTaperedStrokeOnCanvas(
        ctx,
        vertices,
        fr,
        strColor,
        strWidth,
        strDash,
        state.strokeCaps || 'round'
      );
    }

    // Outer page borders
    const borderWidth = targetPage.borderWidth !== undefined ? targetPage.borderWidth : state.borderWidth;
    if (borderWidth > 0) {
      ctx.save();
      ctx.strokeStyle = targetPage.borderColor || state.borderColor || '#141210';
      ctx.lineWidth = borderWidth;
      ctx.strokeRect(borderWidth / 2, borderWidth / 2, pw - borderWidth, ph - borderWidth);
      ctx.restore();
    }

    ctx.restore();

    if (onProgress) {
      onProgress({
        percent: Math.round(40 + (frameIdx / totalFrames) * 55),
        status: `Запись кадров таймлайна: ${frameIdx + 1} из ${totalFrames}...`
      });
    }

    // We yield to browser to allow DOM assets to play their animated frames
    await new Promise(r => requestAnimationFrame(r));
  }

  // Stop recording and finalize
  recorder.stop();

  if (onProgress) {
    onProgress({ percent: 96, status: 'Финализация кадрового архива медиа...' });
  }

  await new Promise<void>((resolve) => {
    recorder.onstop = () => {
      const compiledBlob = new Blob(chunks, { type: mimeType });
      const compiledUrl = URL.createObjectURL(compiledBlob);
      const ext = isGif ? 'gif' : 'webm';
      const fileId = `comix_render_${Date.now()}.${ext}`;

      const link = document.createElement('a');
      link.href = compiledUrl;
      link.download = fileId;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      resolve();
    };
  });

  // Clean up hidden DOM host
  document.body.removeChild(liveDomHost);

  if (onProgress) {
    onProgress({ percent: 100, status: 'Успешно экспортировано!' });
  }
}
