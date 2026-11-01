import { Frame, Page, Layer, Modifier } from '../types';

export interface AdjustmentResult {
  tx: number;
  ty: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  cssFilter: string;
}

export function getPageFrameAdjustments(
  fr: Frame,
  page: Page,
  mouseOffset: { x: number; y: number },
  time: number
): AdjustmentResult {
  let tx = 0;
  let ty = 0;
  let scaleX = 1;
  let scaleY = 1;
  let rotate = 0;
  const cssFilterList: string[] = [];

  const modifiers = page.modifiers || [];
  for (const mod of modifiers) {
    if (!mod.enabled) continue;
    const isTargeted = mod.targetIds.includes(fr.id);
    if (!isTargeted) continue;

    const weight = mod.targetWeights && mod.targetWeights[fr.id] !== undefined
      ? mod.targetWeights[fr.id]
      : 1.0;

    if (mod.type === 'parallax') {
      const intensity = mod.params.intensity ?? 50;
      tx += mouseOffset.x * intensity * weight * -1.2;
      ty += mouseOffset.y * intensity * weight * -1.2;
    } else if (mod.type === 'noise') {
      const intensity = mod.params.intensity ?? 10;
      const speed = mod.params.speed ?? 1.0;
      const phase = time * 0.003 * speed;
      tx += Math.sin(phase) * intensity * weight;
      ty += Math.cos(phase * 0.8) * intensity * weight;
      rotate += Math.sin(phase * 1.5) * (intensity * 0.2) * weight;
    } else if (mod.type === 'tint') {
      const intensity = mod.params.intensity ?? 50;
      cssFilterList.push(`hue-rotate(${intensity * 3.6 * weight}deg) saturate(${1 + intensity * 0.012 * weight})`);
    } else if (mod.type === 'shadow') {
      const blur = mod.params.blur ?? 5;
      const shadowX = mod.params.shadowX ?? 4;
      const shadowY = mod.params.shadowY ?? 4;
      const color = mod.params.color ?? 'rgba(0,0,0,0.5)';
      cssFilterList.push(`drop-shadow(${shadowX * weight}px ${shadowY * weight}px ${blur}px ${color})`);
    }
  }

  return {
    tx,
    ty,
    scaleX,
    scaleY,
    rotate,
    cssFilter: cssFilterList.join(' ')
  };
}

export function getFrameLayerAdjustments(
  layer: Layer,
  fr: Frame,
  mouseOffset: { x: number; y: number },
  localOffset: { x: number; y: number } | null,
  time: number
): AdjustmentResult {
  let tx = 0;
  let ty = 0;
  let scaleX = 1;
  let scaleY = 1;
  let rotate = 0;
  const cssFilterList: string[] = [];

  const modifiers = fr.modifiers || [];
  if (modifiers.length === 0) {
    if (layer.parallax !== 0) {
      tx += mouseOffset.x * layer.parallax * -1.2;
      ty += mouseOffset.y * layer.parallax * -1.2;
    }
  } else {
    for (const mod of modifiers) {
      if (!mod.enabled) continue;
      const isTargeted = mod.targetIds.includes(layer.id);
      if (!isTargeted) continue;

      const weight = mod.targetWeights && mod.targetWeights[layer.id] !== undefined
        ? mod.targetWeights[layer.id]
        : 1.0;

      if (mod.type === 'parallax') {
        const intensity = mod.params.intensity ?? 50;
        const trigger = mod.params.trigger || 'page';
        const offset = trigger === 'frame' && localOffset ? localOffset : mouseOffset;
        tx += offset.x * intensity * weight * -1.2;
        ty += offset.y * intensity * weight * -1.2;
      } else if (mod.type === 'noise') {
        const intensity = mod.params.intensity ?? 10;
        const speed = mod.params.speed ?? 1.0;
        const phase = time * 0.003 * speed + (layer.id * 0.5);
        tx += Math.sin(phase) * intensity * weight;
        ty += Math.cos(phase * 0.82) * intensity * weight;
        rotate += Math.sin(phase * 1.3) * (intensity * 0.25) * weight;
        const sMod = 1 + Math.sin(phase * 0.7) * (intensity * 0.003) * weight;
        scaleX *= sMod;
        scaleY *= sMod;
      } else if (mod.type === 'tint') {
        const intensity = mod.params.intensity ?? 50;
        cssFilterList.push(`hue-rotate(${intensity * 3.6 * weight}deg) saturate(${1 + intensity * 0.012 * weight})`);
      } else if (mod.type === 'shadow') {
        const blur = mod.params.blur ?? 5;
        const shadowX = mod.params.shadowX ?? 4;
        const shadowY = mod.params.shadowY ?? 4;
        const color = mod.params.color ?? 'rgba(0,0,0,0.5)';
        cssFilterList.push(`drop-shadow(${shadowX * weight}px ${shadowY * weight}px ${blur}px ${color})`);
      }
    }
  }

  return {
    tx,
    ty,
    scaleX,
    scaleY,
    rotate,
    cssFilter: cssFilterList.join(' ')
  };
}

export const getFrameAncestors = (frame: Frame, framesList: Frame[]): Frame[] => {
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

export const getLocalVertices = (
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
