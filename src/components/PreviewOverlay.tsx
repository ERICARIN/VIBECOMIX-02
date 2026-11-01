/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppState, Page, Frame, Layer } from '../types';
import { ArrowLeft, Download } from 'lucide-react';
import { getAdjustedVertices, getPolygonBounds, getSvgPathFromVertices, generateVectorStrokePrimitives } from '../utils/geometry';
import { getPageFrameAdjustments, getFrameLayerAdjustments } from '../utils/modifiers';
import { ExportPanel } from './ExportPanel';

const getFrameAncestors = (frame: Frame, framesList: Frame[]): Frame[] => {
  const list: Frame[] = [];
  const visited = new Set<number>();
  let curr = frame.parentId;
  while (curr && !visited.has(curr)) {
    visited.add(curr);
    const found = framesList.find(f => f.id === curr);
    if (!found) break;
    list.push(found);
    curr = found.parentId;
  }
  return list;
};

const getLocalVertices = (
  vSource: { x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number }; isCurve?: boolean }[],
  sourceBox: { x: number; y: number; w: number; h: number },
  sourcePageAdj: { tx: number; ty: number; rotate: number; scaleX: number; scaleY: number },
  targetBox: { x: number; y: number; w: number; h: number },
  targetPageAdj: { tx: number; ty: number; rotate: number; scaleX: number; scaleY: number },
  scale: number = 1
): { x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number }; isCurve?: boolean }[] => {
  const srcTheta = sourcePageAdj.rotate || 0;
  const srcSX = sourcePageAdj.scaleX !== undefined ? sourcePageAdj.scaleX : 1;
  const srcSY = sourcePageAdj.scaleY !== undefined ? sourcePageAdj.scaleY : 1;

  const srcRad = (srcTheta * Math.PI) / 180;
  const srcCos = Math.cos(srcRad);
  const srcSin = Math.sin(srcRad);

  const tgtTheta = targetPageAdj.rotate || 0;
  const tgtSX = targetPageAdj.scaleX !== undefined ? targetPageAdj.scaleX : 1;
  const tgtSY = targetPageAdj.scaleY !== undefined ? targetPageAdj.scaleY : 1;

  const tgtRad = (tgtTheta * Math.PI) / 180;
  const tgtCos = Math.cos(tgtRad);
  const tgtSin = Math.sin(tgtRad);

  const srcStaticCx = sourceBox.x + sourceBox.w / 2;
  const srcStaticCy = sourceBox.y + sourceBox.h / 2;

  const tgtDynamicCx = (targetBox.x + targetPageAdj.tx + targetBox.w / 2) * scale;
  const tgtDynamicCy = (targetBox.y + targetPageAdj.ty + targetBox.h / 2) * scale;

  return vSource.map(v => {
    const s1x = v.x - srcStaticCx;
    const s1y = v.y - srcStaticCy;

    const s2x = (s1x * srcCos - s1y * srcSin) * srcSX;
    const s2y = (s1x * srcSin + s1y * srcCos) * srcSY;

    const gX = (s2x + srcStaticCx + sourcePageAdj.tx) * scale;
    const gY = (s2y + srcStaticCy + sourcePageAdj.ty) * scale;

    const dx = gX - tgtDynamicCx;
    const dy = gY - tgtDynamicCy;

    const rx = dx * tgtCos + dy * tgtSin;
    const ry = -dx * tgtSin + dy * tgtCos;

    const sx = rx / tgtSX;
    const sy = ry / tgtSY;

    const localX = sx + (targetBox.w / 2) * scale;
    const localY = sy + (targetBox.h / 2) * scale;

    const mapped: any = {
      ...v,
      x: localX,
      y: localY,
    };

    if (v.handleIn) {
      const hx = v.handleIn.x;
      const hy = v.handleIn.y;

      const h2x = (hx * srcCos - hy * srcSin) * srcSX;
      const h2y = (hx * srcSin + hy * srcCos) * srcSY;

      const hrx = h2x * tgtCos + h2y * tgtSin;
      const hry = -h2x * tgtSin + h2y * tgtCos;

      mapped.handleIn = {
        x: (hrx / tgtSX) * scale,
        y: (hry / tgtSY) * scale,
      };
    }

    if (v.handleOut) {
      const hx = v.handleOut.x;
      const hy = v.handleOut.y;

      const h2x = (hx * srcCos - hy * srcSin) * srcSX;
      const h2y = (hx * srcSin + hy * srcCos) * srcSY;

      const hrx = h2x * tgtCos + h2y * tgtSin;
      const hry = -h2x * tgtSin + h2y * tgtCos;

      mapped.handleOut = {
        x: (hrx / tgtSX) * scale,
        y: (hry / tgtSY) * scale,
      };
    }

    return mapped;
  });
};

interface PreviewOverlayProps {
  state: AppState;
  onClose: () => void;
}

export const PreviewOverlay: React.FC<PreviewOverlayProps> = ({ state, onClose }) => {
  // Track mouse parallax coordinates for each frame separately
  const [offsets, setOffsets] = useState<Record<number, { dx: number; dy: number }>>({});
  const [time, setTime] = useState(Date.now());
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
  
  // Side export drawer state inside preview
  const [showExportPanel, setShowExportPanel] = useState(false);

  useEffect(() => {
    let animId: number;
    const tick = () => {
      setTime(Date.now());
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent) => {
      const mx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2 || 1);
      const my = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2 || 1);
      setMouseOffset({ x: mx, y: my });
    };
    window.addEventListener('mousemove', handleGlobalMove);
    return () => window.removeEventListener('mousemove', handleGlobalMove);
  }, []);

  const handleMouseMove = (e: React.MouseEvent, frameId: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    // Normalised factors between -1 and 1
    const dx = x / (rect.width / 2 || 1);
    const dy = y / (rect.height / 2 || 1);

    setOffsets((prev) => ({
      ...prev,
      [frameId]: { dx, dy },
    }));
  };

  const handleMouseLeave = (frameId: number) => {
    setOffsets((prev) => ({
      ...prev,
      [frameId]: { dx: 0, dy: 0 },
    }));
  };

  // Stand-alone HTML generator supporting custom polygons and styles
  const handleExportHTML = () => {
    const stateJson = JSON.stringify(state);

    const pagesHTML = state.pages
      .map((pg, pIdx) => {
        const pw = pg.w || state.width;
        const ph = pg.h || state.height;

        const framesHTML = pg.frames
          .map((fr, fIdx) => {
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
                const zIndex = 15 + lIdx;
                const sX = l.scaleX !== undefined ? l.scaleX : l.scale;
                const sY = l.scaleY !== undefined ? l.scaleY : l.scale;
                const layerTx = l.tx + stableOffsetX;
                const layerTy = l.ty + stableOffsetY;
                const transformStr = `translate(${layerTx}px, ${layerTy}px) scale(${sX}, ${sY}) rotate(${l.rotate}deg)`;
                
                return `
                <div class="layer-item" data-layer-id="${l.id}" data-parallax="${l.parallax}" data-stable-tx="${layerTx}" data-stable-ty="${layerTy}" data-stable-sx="${sX}" data-stable-sy="${sY}" data-stable-rotate="${l.rotate}" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:${zIndex};pointer-events:none;transition:transform 0.08s ease-out;will-change:transform;">
                  <div class="layer-inner" style="position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;transform:${transformStr};transform-origin:center center;pointer-events:auto;">
                    <img src="${l.src}" class="layer-image" style="max-width:100%;max-height:100%;object-fit:contain;user-select:none;" />
                  </div>
                </div>`;
              })
              .join('');

            // Stroke parameters (custom per frame or fallback)
            const fallbackSW = pg.strokeWidth !== undefined ? pg.strokeWidth : state.strokeWidth;
            const strColor = fr.strokeColor || (pg.strokeColor !== undefined ? pg.strokeColor : state.strokeColor);
            const strWidth = fr.strokeWidth !== undefined ? fr.strokeWidth : fallbackSW;

            // High-fidelity stroke rendering loop for exported HTML/SVG
            const strokeHtmlSegmentsList: string[] = [];
            const primitives = generateVectorStrokePrimitives(
              fr,
              clipVertices,
              strWidth,
              strColor,
              state.strokeCaps || 'round'
            );

            primitives.forEach((p) => {
              if (p.type === 'path') {
                const dashAttr = p.strokeDasharray && p.strokeDasharray !== 'none' ? ` stroke-dasharray="${p.strokeDasharray}"` : '';
                const opacityAttr = p.opacity !== undefined ? ` opacity="${p.opacity}"` : '';
                strokeHtmlSegmentsList.push(`<path d="${p.d}" fill="${p.fill || 'none'}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="${p.strokeLinecap || 'round'}"${dashAttr}${opacityAttr} />`);
              } else if (p.type === 'line') {
                const dashAttr = p.strokeDasharray && p.strokeDasharray !== 'none' ? ` stroke-dasharray="${p.strokeDasharray}"` : '';
                const opacityAttr = p.opacity !== undefined ? ` opacity="${p.opacity}"` : '';
                strokeHtmlSegmentsList.push(`<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="${p.strokeLinecap || 'round'}"${dashAttr}${opacityAttr} />`);
              } else if (p.type === 'polygon') {
                const opacityAttr = p.opacity !== undefined ? ` opacity="${p.opacity}"` : '';
                strokeHtmlSegmentsList.push(`<polygon points="${p.points}" fill="${p.fill}"${opacityAttr} />`);
              } else if (p.type === 'circle') {
                const opacityAttr = p.opacity !== undefined ? ` opacity="${p.opacity}"` : '';
                strokeHtmlSegmentsList.push(`<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${p.fill}"${opacityAttr} />`);
              }
            });

            const strokeHtmlSegments = strokeHtmlSegmentsList.join('\n');

            return `
            <div class="frame-box" data-frame-id="${fr.id}" style="position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;user-select:none;z-index:${10 + fIdx};transition:transform 0.08s ease-out;">
              <!-- Inline SVG clipPath definition for high-fidelity Bezier curves -->
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
              <!-- Outlined border vectors drawn on top -->
              <svg style="position:absolute;inset:0;pointer-events:none;width:100%;height:100%;z-index:99;overflow:visible;">
                ${strokeHtmlSegments}
              </svg>
            </div>`;
          })
          .join('');

        return `
        <!-- Page ${pIdx + 1} -->
        <div class="comic-page" style="position:relative;width:${pw}px;height:${ph}px;background:${state.borderColor};flex-shrink:0;box-shadow:0 12px 36px rgba(0,0,0,0.5);margin-bottom:40px;">
          ${framesHTML}
        </div>`;
      })
      .join('\n');

    // Smooth modern execution JS bundle for modifiers + parallax rendering
    const clientJS = `
      (function() {
        const state = ${stateJson};
        const offsets = {};
        let globalMouseOffset = { x: 0, y: 0 };
        const startTime = Date.now();

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
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .comic-page {
      box-shadow: 0 20px 50px rgba(0,0,0,0.6);
      border-radius: 4px;
      overflow: hidden;
    }
  </style>
</head>
<body>

  <div style="display:flex;flex-direction:column;align-items:center;width:100%;max-width:1200px;margin:0 auto;">
    ${pagesHTML}
  </div>

  <script>
    ${clientJS}
  </script>
</body>
</html>`;

    // Download flow
    const blob = new Blob([fullHTML], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'vibecomix_parallax.html';
    link.click();
  };

  // Proportional resize scale inside responsive container
  const basePage = state.pages[0];
  const pw0 = basePage.w || state.width;
  const ph0 = basePage.h || state.height;
  
  // Recalculate scale respecting side Export panel if active
  const panelWidthOffset = showExportPanel ? 320 : 0;
  const renderScale = Math.min(1, (window.innerWidth - 80 - panelWidthOffset) / pw0);

  return (
    <div className="fixed inset-0 bg-[#090807]/98 z-[9999] flex flex-row overflow-hidden select-none">
      
      {/* Principal interactive canvas window area */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto">
        
        {/* Fixed top action panel */}
        <div className="sticky top-0 left-0 right-0 bg-[#050505] h-14 border-b-4 border-[#3A3228] px-6 py-2.5 flex items-center justify-between z-[1000] shrink-0">
          <div className="flex items-center gap-2">
            <div className="font-['Unbounded'] text-sm font-black text-[#FC018D] tracking-tighter cursor-default">
              VIBE<span className="text-white">COMIX</span>
            </div>
            <span className="h-4 w-[2px] bg-[#3a3228]" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-[#7A7470]">
              Интерактивный просмотр параллакса
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 py-1.5 px-3 border-2 border-[#3A3228] hover:border-white text-[#7A7470] hover:text-white font-mono text-[9px] font-bold uppercase tracking-wider rounded transition-colors duration-150 cursor-pointer"
            >
              <ArrowLeft size={10} />
              Назад
            </button>
            
            <button
              onClick={() => setShowExportPanel(prev => !prev)}
              className={`flex items-center gap-1.5 py-1.5 px-4 font-['Unbounded'] text-[9px] font-black uppercase tracking-wider rounded border transition-all duration-150 cursor-pointer ${
                showExportPanel
                  ? 'bg-transparent border-[#FC018D] text-[#FC018D] hover:bg-[#FC018D]/10'
                  : 'bg-[#FC018D] border-[#FC018D] text-white hover:bg-[#ff2fa0]'
              }`}
              title="Открыть боковую панель экспорта"
            >
              <Download size={10} />
              ЭКСПОРТ
            </button>
          </div>
        </div>

        {/* Pages rendering container */}
        <div className="flex-1 w-full max-w-4xl mx-auto flex flex-col items-center gap-12 py-12 px-4 focus:outline-none">
          {state.pages.map((pg, pIdx) => {
            const pw = pg.w || state.width;
            const ph = pg.h || state.height;

            return (
              <div
                key={pIdx}
                className="relative rounded overflow-hidden shadow-2xl shrink-0 transition-all duration-150"
                style={{
                  width: `${pw * renderScale}px`,
                  height: `${ph * renderScale}px`,
                  backgroundColor: state.borderColor,
                }}
              >
                {pg.frames.map((fr, fIdx) => {
                  if (fr.hidden) return null;

                  const pageAdj = getPageFrameAdjustments(fr, pg, mouseOffset, time);
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

                  const visibleLayers = fr.layers.filter((l) => !l.hidden);

                  // Offset metrics from state
                  const currentOffset = offsets[fr.id] || { dx: 0, dy: 0 };

                  const frameCenterX = fr.x + (fr.tx || 0) + fr.w / 2;
                  const frameCenterY = fr.y + (fr.ty || 0) + fr.h / 2;
                  const boxCenterX = box.x + box.w / 2;
                  const boxCenterY = box.y + box.h / 2;
                  const stableOffsetX = frameCenterX - boxCenterX;
                  const stableOffsetY = frameCenterY - boxCenterY;

                  const fallbackSW = pg.strokeWidth !== undefined ? pg.strokeWidth : state.strokeWidth;
                  const strColor = fr.strokeColor || (pg.strokeColor !== undefined ? pg.strokeColor : state.strokeColor);
                  const strWidth = fr.strokeWidth !== undefined ? fr.strokeWidth : fallbackSW;
                  const strDash = fr.strokeDasharray || 'none';

                  return (
                    <div
                      key={fr.id}
                      className="absolute"
                      style={{
                        left: `${box.x * renderScale}px`,
                        top: `${box.y * renderScale}px`,
                        width: `${box.w * renderScale}px`,
                        height: `${box.h * renderScale}px`,
                        zIndex: 10 + fIdx,
                        transform: `translate(${pageAdj.tx * renderScale}px, ${pageAdj.ty * renderScale}px) rotate(${pageAdj.rotate}deg) scaleX(${pageAdj.scaleX}) scaleY(${pageAdj.scaleY})`,
                        filter: pageAdj.cssFilter || undefined,
                        clipPath: fr.parentId ? `url(#preview-clip-parent-${fr.id})` : undefined,
                      }}
                    >
                      {/* Inline local SVG clip-path for curves clipping inside Preview */}
                      <svg className="absolute w-0 h-0 pointer-events-none">
                        <defs>
                           {(() => {
                            const ancestors = getFrameAncestors(fr, pg.frames);
                            if (ancestors.length === 0) return null;
                            return ancestors.map((ancestor, i) => {
                              const ancestorAdjVertices = getAdjustedVertices(ancestor, pw, ph, state.borderWidth, pg.borderWidth);
                              const ancestorPageAdj = getPageFrameAdjustments(ancestor, pg, mouseOffset, time);
                              const ancestorBox = getPolygonBounds(ancestorAdjVertices);
                              const relVertices = getLocalVertices(
                                ancestorAdjVertices,
                                ancestorBox,
                                ancestorPageAdj,
                                box,
                                pageAdj,
                                1
                              );
                              const ancestorRelD = getSvgPathFromVertices(relVertices, ancestor.isClosed !== false);
                              const clipId = i === 0 ? `preview-clip-parent-${fr.id}` : `preview-clip-ancestor-${i}-${fr.id}`;
                              const nextClipId = i < ancestors.length - 1 ? `url(#preview-clip-ancestor-${i + 1}-${fr.id})` : undefined;
                              return (
                                <clipPath key={clipId} id={clipId} clipPath={nextClipId} transform={`scale(${renderScale})`}>
                                  <path d={ancestorRelD} />
                                </clipPath>
                              );
                            });
                          })()}
                          <clipPath id={`preview-clip-${fr.id}`} transform={`scale(${renderScale})`}>
                            <path d={clipPathD} />
                          </clipPath>
                        </defs>
                      </svg>

                      <div
                        onMouseMove={(e) => handleMouseMove(e, fr.id, e.currentTarget)}
                        onMouseLeave={() => handleMouseLeave(fr.id)}
                        className="absolute inset-0 overflow-hidden"
                        style={{
                          clipPath: `url(#preview-clip-${fr.id})`,
                          WebkitClipPath: `url(#preview-clip-${fr.id})`,
                          backgroundColor: fr.fillColor || state.pageBg,
                        }}
                      >
                        {/* Interactive Parallax depth */}
                        {visibleLayers.map((layer, lIdx) => {
                          const layerAdj = getFrameLayerAdjustments(layer, fr, mouseOffset, { x: currentOffset.dx, y: currentOffset.dy }, time);
                          const pSpeed = layer.parallax;
                          const depthCoeff = (lIdx + 1) / (visibleLayers.length + 1);

                          // Calculate translation based on depth coefficient and parallax speed
                          const pxOffset = currentOffset.dx * pSpeed * depthCoeff * -1.2 + layerAdj.tx;
                          const pyOffset = currentOffset.dy * pSpeed * depthCoeff * -1.2 + layerAdj.ty;

                          const sX = (layer.scaleX !== undefined ? layer.scaleX : layer.scale) * layerAdj.scaleX;
                          const sY = (layer.scaleY !== undefined ? layer.scaleY : layer.scale) * layerAdj.scaleY;

                          const layerTx = layer.tx + stableOffsetX;
                          const layerTy = layer.ty + stableOffsetY;
                          const layerRot = layer.rotate + layerAdj.rotate;

                          return (
                            <div
                              key={layer.id}
                              style={{
                                zIndex: 10 + lIdx,
                                transform: `translate(${pxOffset}px, ${pyOffset}px)`,
                                transition: 'transform 0.08s ease-out',
                                filter: layerAdj.cssFilter || undefined,
                              }}
                              className="absolute inset-0 flex items-center justify-center pointer-events-none will-change-transform"
                            >
                              <div
                                style={{
                                  transform: `translate(${layerTx * renderScale}px, ${layerTy * renderScale}px) scaleX(${sX}) scaleY(${sY}) rotate(${layerRot}deg)`,
                                  transformOrigin: 'center center',
                                }}
                                className="relative pointer-events-auto shrink-0 flex items-center justify-center"
                              >
                                <img
                                  src={layer.src}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  className="max-w-full max-h-full object-contain filter drop-shadow-md select-none"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Vector outline border drawn on top in preview using relative clipVertices & renderScale */}
                      <svg className="absolute inset-0 pointer-events-none w-full h-full z-[99] overflow-visible">
                        {(() => {
                          const scaledVertices = clipVertices.map(v => ({
                            x: v.x * renderScale,
                            y: v.y * renderScale,
                            handleIn: v.handleIn ? { x: v.handleIn.x * renderScale, y: v.handleIn.y * renderScale } : undefined,
                            handleOut: v.handleOut ? { x: v.handleOut.x * renderScale, y: v.handleOut.y * renderScale } : undefined,
                            isCurve: v.isCurve
                          }));

                          const primitives = generateVectorStrokePrimitives(
                            fr,
                            scaledVertices,
                            strWidth * renderScale,
                            strColor,
                            state.strokeCaps || 'round'
                          );

                          return primitives.map((p, idx) => {
                            const key = p.key || `stroke-primitive-${fr.id}-${idx}`;
                            if (p.type === 'path') {
                              return (
                                <path
                                  key={key}
                                  d={p.d}
                                  fill={p.fill}
                                  stroke={p.stroke}
                                  strokeWidth={p.strokeWidth}
                                  strokeLinecap={p.strokeLinecap}
                                  strokeDasharray={p.strokeDasharray}
                                  opacity={p.opacity}
                                />
                              );
                            } else if (p.type === 'line') {
                              return (
                                <line
                                  key={key}
                                  x1={p.x1}
                                  y1={p.y1}
                                  x2={p.x2}
                                  y2={p.y2}
                                  stroke={p.stroke}
                                  strokeWidth={p.strokeWidth}
                                  strokeLinecap={p.strokeLinecap}
                                  strokeDasharray={p.strokeDasharray}
                                  opacity={p.opacity}
                                />
                              );
                            } else if (p.type === 'polygon') {
                              return (
                                <polygon
                                  key={key}
                                  points={p.points}
                                  fill={p.fill}
                                  opacity={p.opacity}
                                />
                              );
                            } else if (p.type === 'circle') {
                              return (
                                <circle
                                  key={key}
                                  cx={p.cx}
                                  cy={p.cy}
                                  r={p.r}
                                  fill={p.fill}
                                  opacity={p.opacity}
                                />
                              );
                            }
                            return null;
                          });
                        })()}
                      </svg>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Slide-out side settings panel inside viewing mode identical to editor */}
      {showExportPanel && (
        <div className="w-[320px] h-full border-l-2 border-[#3A3228] z-[1010] shrink-0 bg-[#141210] shadow-2xl flex flex-col animate-[slideLeft_0.2s_ease-out]">
          <ExportPanel
            state={state}
            activeLayers={null}
            onClose={() => setShowExportPanel(false)}
          />
        </div>
      )}
    </div>
  );
};
