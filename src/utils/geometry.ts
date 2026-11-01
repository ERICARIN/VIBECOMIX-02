/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Frame, Modifier } from '../types';

export interface Point {
  x: number;
  y: number;
}

/**
 * Calculates the bounding box of an array of vertices
 */
export const getPolygonBounds = (vertices: {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}[]) => {
  if (vertices.length === 0) {
    return { x: 0, y: 0, w: 100, h: 100 };
  }
  const xs: number[] = [];
  const ys: number[] = [];

  vertices.forEach((v) => {
    xs.push(v.x);
    ys.push(v.y);
    if (v.handleIn) {
      xs.push(v.x + v.handleIn.x);
      ys.push(v.y + v.handleIn.y);
    }
    if (v.handleOut) {
      xs.push(v.x + v.handleOut.x);
      ys.push(v.y + v.handleOut.y);
    }
  });

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.max(10, Math.round(maxX - minX)),
    h: Math.max(10, Math.round(maxY - minY)),
  };
};

/**
 * Checks which side of the line p1->p2 a point p lies on.
 * Returns > 0 for left side, < 0 for right side, 0 if collinear.
 */
export const getSide = (p: Point, p1: Point, p2: Point): number => {
  return (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x);
};

/**
 * Find intersection of line segment AB with the infinite line p1->p2.
 */
export const getLineIntersection = (A: Point, B: Point, p1: Point, p2: Point): Point | null => {
  const dRefX = p2.x - p1.x;
  const dRefY = p2.y - p1.y;

  const dSegX = B.x - A.x;
  const dSegY = B.y - A.y;

  const denom = dSegX * dRefY - dSegY * dRefX;
  if (Math.abs(denom) < 1e-8) return null; // parallel

  // t is the parameter along segment AB (should be 0..1)
  const t = ((p1.x - A.x) * dRefY - (p1.y - A.y) * dRefX) / denom;
  if (t < 0 || t > 1) return null; // outside segment AB

  // u is the parameter along segment p1p2 (should be 0..1 to be segment-based)
  // We use a slight tolerance (-0.05 to 1.05) so snapping to edges works reliably
  const u = ((A.x - p1.x) * dSegY - (A.y - p1.y) * dSegX) / -denom;
  if (u < -0.05 || u > 1.05) return null; // outside segment p1p2

  return {
    x: A.x + t * dSegX,
    y: A.y + t * dSegY,
  };
};

/**
 * Splits a polygon defined by vertices into two polygons by the cutting line p1->p2.
 * Returns an array of two new vertex arrays, or null if no robust split occurs.
 * Applies a gutter shift along the normal vector of the cut line.
 */
export const splitPolygon = (
  vertices: {
    x: number;
    y: number;
    handleIn?: { x: number; y: number };
    handleOut?: { x: number; y: number };
    isCurve?: boolean;
  }[],
  p1: Point,
  p2: Point,
  gutter: number = 0
): [typeof vertices, typeof vertices] | null => {
  const n = vertices.length;
  if (n < 3) return null;

  const list1: { pt: typeof vertices[0]; isIntersect: boolean }[] = [];
  const list2: { pt: typeof vertices[0]; isIntersect: boolean }[] = [];

  let intersectionCount = 0;

  for (let i = 0; i < n; i++) {
    const A = vertices[i];
    const B = vertices[(i + 1) % n];

    // Classify point A
    const sideA = getSide(A, p1, p2);
    if (sideA >= 0) {
      list1.push({ pt: { ...A }, isIntersect: false });
    } else {
      list2.push({ pt: { ...A }, isIntersect: false });
    }

    // Check edge AB crossing the line p1-p2
    const intersect = getLineIntersection(A, B, p1, p2);
    if (intersect) {
      intersectionCount++;
      const intersectVertex = {
        x: intersect.x,
        y: intersect.y,
        handleIn: undefined,
        handleOut: undefined,
        isCurve: false
      };
      list1.push({ pt: intersectVertex, isIntersect: true });
      list2.push({ pt: intersectVertex, isIntersect: true });
    }
  }

  // A valid slicing cut of a simple polygon must cross exactly twice
  if (intersectionCount < 2) {
    return null;
  }

  // Calculate cut line direction & normalized normal
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return null;

  // nx, ny points to Left side (sideA >= 0)
  const nx = -dy / len;
  const ny = dx / len;

  const halfGutter = gutter / 2;

  // Apply gutter shift to intersection points to create spacing
  const pts1 = list1.map((item) => {
    if (item.isIntersect && halfGutter > 0) {
      return {
        ...item.pt,
        x: Math.round(item.pt.x + nx * halfGutter),
        y: Math.round(item.pt.y + ny * halfGutter),
      };
    }
    return { ...item.pt, x: Math.round(item.pt.x), y: Math.round(item.pt.y) };
  });

  const pts2 = list2.map((item) => {
    if (item.isIntersect && halfGutter > 0) {
      // right side gets shifted in the opposite direction
      return {
        ...item.pt,
        x: Math.round(item.pt.x - nx * halfGutter),
        y: Math.round(item.pt.y - ny * halfGutter),
      };
    }
    return { ...item.pt, x: Math.round(item.pt.x), y: Math.round(item.pt.y) };
  });

  // Filter out immediate duplicates
  const cleanPts = (pts: typeof vertices) => {
    const res: typeof vertices = [];
    for (let i = 0; i < pts.length; i++) {
      const curr = pts[i];
      const prev = res[res.length - 1];
      if (!prev || Math.hypot(curr.x - prev.x, curr.y - prev.y) > 1.5) {
        res.push(curr);
      }
    }
    // check start/end wrap
    if (res.length > 2) {
      const first = res[0];
      const last = res[res.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1.5) {
        res.pop();
      }
    }
    return res;
  };

  const final1 = cleanPts(pts1);
  const final2 = cleanPts(pts2);

  if (final1.length < 3 || final2.length < 3) {
    return null;
  }

  return [final1, final2];
};

/**
 * Checks if a point is inside a polygon (Ray-casting method)
 */
export const isPointInPolygon = (p: Point, polygon: Point[]): boolean => {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

/**
 * Snaps a vector (dx, dy) to 0, 45 or 90 degrees if Shift is held
 */
export const snapAngle = (dx: number, dy: number): Point => {
  const angle = Math.atan2(dy, dx);
  const octant = Math.round(8 * angle / (2 * Math.PI) + 8) % 8;
  const snappedAngle = octant * (2 * Math.PI / 8);
  const len = Math.hypot(dx, dy);
  return {
    x: len * Math.cos(snappedAngle),
    y: len * Math.sin(snappedAngle),
  };
};

export const getTransformedVertices = (fr: Frame): {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  isCurve?: boolean;
}[] => {
  const vertices = fr.vertices || [
    { x: fr.x, y: fr.y },
    { x: fr.x + fr.w, y: fr.y },
    { x: fr.x + fr.w, y: fr.y + fr.h },
    { x: fr.x, y: fr.y + fr.h },
  ];

  const tx = fr.tx || 0;
  const ty = fr.ty || 0;
  const scaleX = fr.scaleX !== undefined ? fr.scaleX : (fr.scale !== undefined ? fr.scale : 1.0);
  const scaleY = fr.scaleY !== undefined ? fr.scaleY : (fr.scale !== undefined ? fr.scale : 1.0);
  const rotate = fr.rotate || 0;

  if (tx === 0 && ty === 0 && scaleX === 1.0 && scaleY === 1.0 && rotate === 0) {
    return vertices;
  }

  // Calculate geometric center of bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  vertices.forEach((v) => {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return vertices.map((v) => {
    // 1. Scale relative to center
    let x = cx + (v.x - cx) * scaleX;
    let y = cy + (v.y - cy) * scaleY;

    // 2. Rotate relative to center
    const rx = x - cx;
    const ry = y - cy;
    x = cx + rx * cos - ry * sin;
    y = cy + rx * sin + ry * cos;

    // 3. Translate
    x += tx;
    y += ty;

    // Scale and rotate control handles
    let nextHandleIn = v.handleIn;
    let nextHandleOut = v.handleOut;

    if (nextHandleIn) {
      nextHandleIn = {
        x: nextHandleIn.x * scaleX,
        y: nextHandleIn.y * scaleY,
      };
    }
    if (nextHandleOut) {
      nextHandleOut = {
        x: nextHandleOut.x * scaleX,
        y: nextHandleOut.y * scaleY,
      };
    }

    if (nextHandleIn && rotate !== 0) {
      nextHandleIn = {
        x: nextHandleIn.x * cos - nextHandleIn.y * sin,
        y: nextHandleIn.x * sin + nextHandleIn.y * cos,
      };
    }
    if (nextHandleOut && rotate !== 0) {
      nextHandleOut = {
        x: nextHandleOut.x * cos - nextHandleOut.y * sin,
        y: nextHandleOut.x * sin + nextHandleOut.y * cos,
      };
    }

    return {
      x,
      y,
      handleIn: nextHandleIn,
      handleOut: nextHandleOut,
      isCurve: v.isCurve,
    };
  });
};

export const getSvgPathFromVertices = (vertices: {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  isCurve?: boolean;
}[], isClosed: boolean = true): string => {
  if (vertices.length === 0) return '';

  let d = '';
  const n = vertices.length;

  d += `M ${vertices[0].x} ${vertices[0].y}`;

  const endLimit = isClosed ? n : n - 1;

  for (let i = 0; i < endLimit; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const h1 = curr.handleOut;
    const h2 = next.handleIn;

    if (h1 || h2) {
      const c1x = curr.x + (h1 ? h1.x : 0);
      const c1y = curr.y + (h1 ? h1.y : 0);
      const c2x = next.x + (h2 ? h2.x : 0);
      const c2y = next.y + (h2 ? h2.y : 0);

      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${next.x} ${next.y}`;
    } else {
      d += ` L ${next.x} ${next.y}`;
    }
  }

  if (isClosed) {
    d += ' Z';
  }
  return d;
};

/**
 * Calculates perpendicular distance from a point to a line segment
 */
export const getPerpendicularDistance = (pt: Point, lineStart: Point, lineEnd: Point): number => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  }
  const area = Math.abs(dy * pt.x - dx * pt.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return area / len;
};

/**
 * Ramer-Douglas-Peucker (RDP) algorithm for path simplification
 */
export const ramerDouglasPeucker = <T extends Point>(
  points: T[],
  epsilon: number
): T[] => {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = getPerpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const results1 = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const results2 = ramerDouglasPeucker(points.slice(index), epsilon);
    return results1.slice(0, results1.length - 1).concat(results2);
  } else {
    return [points[0], points[end]];
  }
};

/**
 * Exponential moving average smoothing for dynamic brush input
 */
export const exponentialSmooth = (
  current: Point,
  prev: Point,
  alpha: number
): Point => {
  return {
    x: prev.x * (1 - alpha) + current.x * alpha,
    y: prev.y * (1 - alpha) + current.y * alpha,
  };
};

/**
 * Computes smooth Bezier control handles for an array of vertices
 */
export const computeBezierHandles = (
  points: Point[],
  isClosed: boolean
): { handleIn?: Point; handleOut?: Point }[] => {
  const n = points.length;
  if (n < 2) return points.map(() => ({}));
  if (n === 2) {
    // simple straight line handles
    return [
      { handleOut: { x: (points[1].x - points[0].x) * 0.25, y: (points[1].y - points[0].y) * 0.25 } },
      { handleIn: { x: (points[0].x - points[1].x) * 0.25, y: (points[0].y - points[1].y) * 0.25 } }
    ];
  }

  const handles: { handleIn?: Point; handleOut?: Point }[] = Array.from({ length: n }, () => ({}));

  for (let i = 0; i < n; i++) {
    const pCurrent = points[i];
    let pPrev = points[i - 1];
    let pNext = points[i + 1];

    if (isClosed) {
      if (i === 0) pPrev = points[n - 1];
      if (i === n - 1) pNext = points[0];
    } else {
      if (i === 0) {
        const dx = points[1].x - pCurrent.x;
        const dy = points[1].y - pCurrent.y;
        handles[i] = {
          handleOut: { x: dx * 0.25, y: dy * 0.25 }
        };
        continue;
      }
      if (i === n - 1) {
        const dx = pCurrent.x - points[n - 2].x;
        const dy = pCurrent.y - points[n - 2].y;
        handles[i] = {
          handleIn: { x: -dx * 0.25, y: -dy * 0.25 }
        };
        continue;
      }
    }

    const dx = pNext.x - pPrev.x;
    const dy = pNext.y - pPrev.y;

    const dPrev = Math.hypot(pCurrent.x - pPrev.x, pCurrent.y - pPrev.y);
    const dNext = Math.hypot(pNext.x - pCurrent.x, pNext.y - pCurrent.y);
    const dTotal = dPrev + dNext;

    if (dTotal < 1e-6) continue;

    const scale = 0.28; // standard smooth curvature factor
    const prevScale = dPrev / dTotal;
    const nextScale = dNext / dTotal;

    handles[i] = {
      handleIn: {
        x: -dx * scale * prevScale,
        y: -dy * scale * prevScale
      },
      handleOut: {
        x: dx * scale * nextScale,
        y: dy * scale * nextScale
      }
    };
  }

  return handles;
};

/**
 * Erase vector segments that intersect with eraser point/radius
 */
export const eraseFrameSegments = (
  frame: Frame,
  eraserPoint: Point,
  eraserRadius: number
): Frame[] => {
  if (!frame.vertices || frame.vertices.length === 0) return [frame];

  const vertices = frame.vertices;
  const n = vertices.length;
  let anyClose = false;

  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const dist = Math.hypot(v.x - eraserPoint.x, v.y - eraserPoint.y);
    if (dist <= eraserRadius) {
      anyClose = true;
      break;
    }

    const isClosed = frame.isClosed !== false;
    if (i < n - 1 || isClosed) {
      const nextV = vertices[(i + 1) % n];
      const { dist: segDist } = getClosestPointOnSegment(eraserPoint, v, nextV);
      if (segDist <= eraserRadius) {
        anyClose = true;
        break;
      }
    }
  }

  if (!anyClose) return [frame];

  const isClosed = frame.isClosed !== false;
  const runs: { x: number; y: number; handleIn?: {x:number,y:number}; handleOut?: {x:number,y:number}; isCurve?: boolean; pressure?: number }[][] = [];
  let currentRun: typeof runs[0] = [];
  const vertexPressures = frame.vertexPressures || Array(n).fill(1.0);

  let startIndex = 0;
  if (isClosed) {
    let foundErased = -1;
    for (let i = 0; i < n; i++) {
      const dist = Math.hypot(vertices[i].x - eraserPoint.x, vertices[i].y - eraserPoint.y);
      if (dist <= eraserRadius) {
        foundErased = i;
        break;
      }
    }
    if (foundErased !== -1) {
      startIndex = (foundErased + 1) % n;
    }
  }

  for (let step = 0; step < n; step++) {
    const idx = (startIndex + step) % n;
    const v = vertices[idx];
    const dist = Math.hypot(v.x - eraserPoint.x, v.y - eraserPoint.y);
    const isErased = dist <= eraserRadius;

    if (!isErased) {
      currentRun.push({
        x: v.x,
        y: v.y,
        handleIn: v.handleIn,
        handleOut: v.handleOut,
        isCurve: v.isCurve,
        pressure: vertexPressures[idx] !== undefined ? vertexPressures[idx] : 1.0
      });
    } else {
      if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    }
  }
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  if (runs.length === 1 && runs[0].length === n && isClosed) {
    return [{
      ...frame,
      isClosed: false
    }];
  }

  const newFrames: Frame[] = [];
  runs.forEach((run, rIdx) => {
    if (run.length < 2) return;
    
    const newVertices = run.map(item => ({
      x: item.x,
      y: item.y,
      handleIn: item.handleIn,
      handleOut: item.handleOut,
      isCurve: item.isCurve
    }));
    const newPressures = run.map(item => item.pressure ?? 1.0);

    newFrames.push({
      ...frame,
      id: Number(Math.floor(Math.random() * 10000000) + rIdx),
      vertices: newVertices,
      vertexPressures: newPressures,
      isClosed: false,
    });
  });

  return newFrames;
};

/**
 * Resolves frame polygon coordinates adjusted for outer margins and gutters.
 * It is used globally to render frame boundaries accurately.
 */
export const getAdjustedVertices = (
  fr: Frame,
  pw: number,
  ph: number,
  stateBorderWidth: number,
  pageBorderWidth?: number
): {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  isCurve?: boolean;
}[] => {
  const hasCustomVertices = !!fr.vertices;

  const vertices = getTransformedVertices(fr);

  const fallbackBW = pageBorderWidth !== undefined ? pageBorderWidth : stateBorderWidth;

  const bTop = fr.borderWidths?.top !== undefined ? fr.borderWidths.top : fallbackBW;
  const bBottom = fr.borderWidths?.bottom !== undefined ? fr.borderWidths.bottom : fallbackBW;
  const bLeft = fr.borderWidths?.left !== undefined ? fr.borderWidths.left : fallbackBW;
  const bRight = fr.borderWidths?.right !== undefined ? fr.borderWidths.right : fallbackBW;

  return vertices.map((v) => {
    let x = v.x;
    let y = v.y;

    if (!hasCustomVertices) {
      if (Math.abs(v.x - (fr.tx || 0) - fr.x) <= 8.5) {
        x = v.x + bLeft;
      } else if (Math.abs(v.x - (fr.tx || 0) - (fr.x + fr.w)) <= 8.5) {
        x = v.x - bRight;
      }

      if (Math.abs(v.y - (fr.ty || 0) - fr.y) <= 8.5) {
        y = v.y + bTop;
      } else if (Math.abs(v.y - (fr.ty || 0) - (fr.y + fr.h)) <= 8.5) {
        y = v.y - bBottom;
      }
    } else {
      if (Math.abs(v.x) <= 8.5) {
        x = bLeft;
      } else if (Math.abs(v.x - pw) <= 8.5) {
        x = pw - bRight;
      }

      if (Math.abs(v.y) <= 8.5) {
        y = bTop;
      } else if (Math.abs(v.y - ph) <= 8.5) {
        y = ph - bBottom;
      }
    }

    x = Math.max(0, Math.min(pw, x));
    y = Math.max(0, Math.min(ph, y));

    return {
      x,
      y,
      handleIn: v.handleIn,
      handleOut: v.handleOut,
      isCurve: v.isCurve,
    };
  });
};

/**
 * Find the closest point on a line segment AB to a point P.
 */
export const getClosestPointOnSegment = (P: Point, A: Point, B: Point): { pt: Point; dist: number } => {
  const abX = B.x - A.x;
  const abY = B.y - A.y;
  const apX = P.x - A.x;
  const apY = P.y - A.y;

  const abLen2 = abX * abX + abY * abY;
  if (abLen2 < 1e-6) {
    const dist = Math.hypot(apX, apY);
    return { pt: { ...A }, dist };
  }

  // Projection ratio t (clamped to 0..1)
  let t = (apX * abX + apY * abY) / abLen2;
  t = Math.max(0, Math.min(1, t));

  const closest = {
    x: A.x + t * abX,
    y: A.y + t * abY,
  };
  const dist = Math.hypot(P.x - closest.x, P.y - closest.y);
  return { pt: closest, dist };
};

/**
 * Snaps a local coordinate point P dynamically to the nearest boundary edge, vertex or frame outline.
 */
export const getSnappedPoint = (
  P: Point,
  frames: Frame[],
  pw: number,
  ph: number,
  snapDist: number = 18
): Point => {
  let bestPt = { ...P };
  let bestDist = snapDist;

  // 1. Snap to page boundaries: x=0, y=0, x=pw, y=ph
  const pageSegs = [
    [{ x: 0, y: 0 }, { x: pw, y: 0 }],
    [{ x: pw, y: 0 }, { x: pw, y: ph }],
    [{ x: pw, y: ph }, { x: 0, y: ph }],
    [{ x: 0, y: ph }, { x: 0, y: 0 }],
  ];
  pageSegs.forEach(([A, B]) => {
    const { pt, dist } = getClosestPointOnSegment(P, A, B);
    if (dist < bestDist) {
      bestDist = dist;
      bestPt = pt;
    }
  });

  // 2. Snap to frames vertices and edge segments
  frames.forEach((fr) => {
    const pts = fr.vertices || [
      { x: fr.x, y: fr.y },
      { x: fr.x + fr.w, y: fr.y },
      { x: fr.x + fr.w, y: fr.y + fr.h },
      { x: fr.x, y: fr.y + fr.h },
    ];
    // Vertices snap first (higher priority)
    pts.forEach((v) => {
      const d = Math.hypot(P.x - v.x, P.y - v.y);
      if (d < bestDist) {
        bestDist = d;
        bestPt = { ...v };
      }
    });

    // Edges snap
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const A = pts[i];
      const B = pts[(i + 1) % n];
      const { pt, dist } = getClosestPointOnSegment(P, A, B);
      if (dist < bestDist - 2) { // slight bias to anchor vertices over middle segments
        bestDist = dist;
        bestPt = pt;
      }
    }
  });

  return bestPt;
};

export interface StrokePrimitive {
  type: 'path' | 'polygon' | 'circle' | 'line';
  d?: string;
  points?: string;
  cx?: number;
  cy?: number;
  r?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeLinecap?: 'round' | 'butt' | 'square';
  opacity?: number;
  key?: string;
}

const pseudoRandom = (seed: number): number => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const preprocessVertices = (
  fr: { id: number; strokeType?: string; modifiers?: Modifier[]; vertexPressures?: number[] },
  vertices: { x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number }; isCurve?: boolean }[],
  isClosed: boolean
): {
  processedVertices: typeof vertices;
  processedPressures: number[];
} => {
  const velocities = vertices.length;
  if (velocities === 0) return { processedVertices: [], processedPressures: [] };

  const strokeType = fr.strokeType || 'solid';
  const isArtistic = strokeType === 'rough' || strokeType === 'brush' || strokeType === 'calligraphy' || strokeType === 'wiggly';
  
  // Find active stroke-noise modifier
  const noiseMod = fr.modifiers?.find((m: any) => m.type === 'stroke-noise' && m.enabled);

  // Determine standard pressures
  const initPressures = fr.vertexPressures && fr.vertexPressures.length === velocities
    ? fr.vertexPressures
    : Array(velocities).fill(1.0);

  // If NOT artistic and NO noise modifier, we do NOT need to subdivide
  if (!isArtistic && !noiseMod) {
    return { processedVertices: [...vertices], processedPressures: [...initPressures] };
  }

  // Subdivide vertices to have maximum segment length (e.g. 15px - 25px)
  let maxSegmentLen = isArtistic ? 20 : 35;
  if (noiseMod && noiseMod.params.segmentLength !== undefined) {
    maxSegmentLen = noiseMod.params.segmentLength;
  }

  const subVerts: typeof vertices = [];
  const subPressures: number[] = [];
  const endLimit = isClosed ? velocities : velocities - 1;

  for (let i = 0; i < velocities; i++) {
    const curr = vertices[i];
    const p1 = initPressures[i] ?? 1.0;

    subVerts.push(curr);
    subPressures.push(p1);

    if (i >= endLimit) continue;

    const next = vertices[(i + 1) % velocities];
    const p2 = initPressures[(i + 1) % velocities] ?? 1.0;

    const isSegmentCurve = !!curr.isCurve || !!next.isCurve || !!curr.handleOut || !!next.handleIn;
    const control1 = curr.handleOut ? { x: curr.x + curr.handleOut.x, y: curr.y + curr.handleOut.y } : curr;
    const control2 = next.handleIn ? { x: next.x + next.handleIn.x, y: next.y + next.handleIn.y } : next;

    const getCurvePt = (t: number) => {
      if (isSegmentCurve) {
        const mt = 1 - t;
        return {
          x: mt * mt * mt * curr.x + 3 * mt * mt * t * control1.x + 3 * mt * t * t * control2.x + t * t * t * next.x,
          y: mt * mt * mt * curr.y + 3 * mt * mt * t * control1.y + 3 * mt * t * t * control2.y + t * t * t * next.y,
        };
      } else {
        return {
          x: curr.x + t * (next.x - curr.x),
          y: curr.y + t * (next.y - curr.y),
        };
      }
    };

    // Calculate length approximately
    let approxLen = 0;
    let prevPt = getCurvePt(0);
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const pt = getCurvePt(s / steps);
      approxLen += Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
      prevPt = pt;
    }

    if (approxLen > maxSegmentLen) {
      const divisions = Math.ceil(approxLen / maxSegmentLen);
      for (let d = 1; d < divisions; d++) {
        const t = d / divisions;
        const pt = getCurvePt(t);
        const interpP = p1 + t * (p2 - p1);

        subVerts.push({
          x: pt.x,
          y: pt.y,
          isCurve: isSegmentCurve
        });
        subPressures.push(interpP);
      }
    }
  }

  // Now, if there is an active stroke-noise modifier, apply coordinate + thickness drift
  if (noiseMod) {
    const intensity = noiseMod.params.intensity ?? 15;
    const scale = noiseMod.params.noiseScale ?? 1.0;
    const speed = noiseMod.params.speed ?? 0;
    const tNoiseIntensity = noiseMod.params.thicknessNoise ?? 10;
    const fps = noiseMod.params.fps ?? 0;

    // Use global timer in milliseconds
    let time = typeof performance !== 'undefined' ? performance.now() : Date.now();
    
    // Lock to FPS if specified
    if (fps > 0) {
      const frameDuration = 1000 / fps;
      time = Math.floor(time / frameDuration) * frameDuration;
    }

    const phase = speed > 0 ? (time * 0.0012 * speed) : (fr.id * 1.37);

    // Multi-octave wave noise generator
    const sampleNoise = (k: number, sc: number, ph: number): number => {
      const val = k * sc * 0.35 + ph;
      return Math.sin(val) * 0.65 + Math.sin(val * 2.1 + 0.8) * 0.25 + Math.cos(val * 0.55 + 2.5) * 0.1;
    };

    for (let k = 0; k < subVerts.length; k++) {
      const nX = sampleNoise(k, scale, phase);
      const nY = sampleNoise(k + 120, scale, phase + 3.1);
      const nP = sampleNoise(k + 240, scale * 1.5, phase + 6.2);

      subVerts[k] = {
        ...subVerts[k],
        x: subVerts[k].x + nX * intensity,
        y: subVerts[k].y + nY * intensity,
      };

      subPressures[k] = Math.max(0.1, subPressures[k] * (1.0 + nP * (tNoiseIntensity / 100)));
    }
  }

  const bakedVerts = subVerts.map(v => ({
    ...v,
    isCurve: false,
    handleIn: undefined,
    handleOut: undefined
  }));

  return {
    processedVertices: bakedVerts,
    processedPressures: subPressures
  };
};

export const generateVectorStrokePrimitives = (
  fr: { id: number; strokeType?: 'solid' | 'dashed' | 'dotted' | 'dashdot' | 'rough' | 'brush' | 'calligraphy' | 'wiggly'; strokeDasharray?: string; isClosed?: boolean; vertexPressures?: number[]; modifiers?: Modifier[] },
  mappedVertices: { x: number; y: number; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number }; isCurve?: boolean }[],
  strWidth: number,
  strColor: string,
  strokeCaps: 'round' | 'flat' = 'round'
): StrokePrimitive[] => {
  const primitives: StrokePrimitive[] = [];
  if (mappedVertices.length === 0) return primitives;

  const { processedVertices, processedPressures } = preprocessVertices(fr, mappedVertices, fr.isClosed !== false);
  const velocities = processedVertices.length;
  if (velocities === 0) return primitives;

  const strokeType = fr.strokeType || 'solid';
  const strDash = fr.strokeDasharray || 'none';
  const endLimit = fr.isClosed !== false ? velocities : velocities - 1;

  for (let idx = 0; idx < endLimit; idx++) {
    const v = processedVertices[idx];
    const nextV = processedVertices[(idx + 1) % velocities];

    const p1 = processedPressures[idx] !== undefined ? processedPressures[idx] : 1.0;
    const p2 = processedPressures[(idx + 1) % velocities] !== undefined ? processedPressures[(idx + 1) % velocities] : 1.0;

    const isSegmentCurve = !!v.isCurve || !!nextV.isCurve || !!v.handleOut || !!nextV.handleIn;
    const control1 = v.handleOut ? { x: v.x + v.handleOut.x, y: v.y + v.handleOut.y } : v;
    const control2 = nextV.handleIn ? { x: nextV.x + nextV.handleIn.x, y: nextV.y + nextV.handleIn.y } : nextV;

    // Helper to evaluate Bezier cubic curve point at t
    const getCurvePt = (t: number) => {
      if (isSegmentCurve) {
        const mt = 1 - t;
        return {
          x: mt * mt * mt * v.x + 3 * mt * mt * t * control1.x + 3 * mt * t * t * control2.x + t * t * t * nextV.x,
          y: mt * mt * mt * v.y + 3 * mt * mt * t * control1.y + 3 * mt * t * t * control2.y + t * t * t * nextV.y,
        };
      } else {
        return {
          x: v.x + t * (nextV.x - v.x),
          y: v.y + t * (nextV.y - v.y),
        };
      }
    };

    // Helper to evaluate normal vector at t
    const getNormal = (t: number) => {
      const delta = 0.01;
      const t1 = Math.max(0, t - delta);
      const t2 = Math.min(1, t + delta);
      const pA = getCurvePt(t1);
      const pB = getCurvePt(t2);
      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        return { x: -dy / len, y: dx / len };
      }
      return { x: 0, y: 0 };
    };

    if (strokeType === 'solid' || strokeType === 'dashed' || strokeType === 'dotted' || strokeType === 'dashdot') {
      const isDashed = strDash !== 'none' || strokeType === 'dashed' || strokeType === 'dotted' || strokeType === 'dashdot';
      const activeDash = strokeType === 'dashed' ? '5,5' : strokeType === 'dotted' ? '2,5' : strokeType === 'dashdot' ? '15,10,2,10' : strDash || 'none';

      if (isDashed) {
        const avgPressure = (p1 + p2) / 2;
        if (isSegmentCurve) {
          const d = `M ${v.x} ${v.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${nextV.x} ${nextV.y}`;
          primitives.push({
            type: 'path',
            d,
            fill: 'none',
            stroke: strColor,
            strokeWidth: strWidth * avgPressure,
            strokeLinecap: 'round',
            strokeDasharray: activeDash,
            key: `stroke-dash-${fr.id}-${idx}`,
          });
        } else {
          primitives.push({
            type: 'line',
            x1: v.x,
            y1: v.y,
            x2: nextV.x,
            y2: nextV.y,
            fill: 'none',
            stroke: strColor,
            strokeWidth: strWidth * avgPressure,
            strokeLinecap: 'round',
            strokeDasharray: activeDash,
            key: `stroke-seg-${fr.id}-${idx}`,
          });
        }
      } else {
        // Smooth tapered path (pressure stroke)
        const numSamples = isSegmentCurve ? 16 : 1;
        const pathPoints: { x: number; y: number; w: number }[] = [];

        for (let s = 0; s <= numSamples; s++) {
          const t = s / numSamples;
          const pt = getCurvePt(t);
          const curPressure = p1 + t * (p2 - p1);
          pathPoints.push({ x: pt.x, y: pt.y, w: (strWidth * curPressure) / 2 });
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

        primitives.push({
          type: 'polygon',
          points: pointsStr,
          fill: strColor,
          key: `stroke-poly-${fr.id}-${idx}`,
        });

        if (strokeCaps === 'round') {
          if (idx === 0) {
            primitives.push({
              type: 'circle',
              cx: v.x,
              cy: v.y,
              r: pathPoints[0].w,
              fill: strColor,
              key: `stroke-cap-start-${fr.id}-${idx}`,
            });
          }
          primitives.push({
            type: 'circle',
            cx: nextV.x,
            cy: nextV.y,
            r: pathPoints[pathPoints.length - 1].w,
            fill: strColor,
            key: `stroke-cap-end-${fr.id}-${idx}`,
          });
        }
      }
    } else if (strokeType === 'rough') {
      // Rough sketching stroke: 3 overlapping jittery lines
      const numSamples = 20;
      const avgPressure = (p1 + p2) / 2;

      for (let p = 0; p < 3; p++) {
        let d = '';
        const seedShift = fr.id * 50 + idx * p + p * 13;

        for (let s = 0; s <= numSamples; s++) {
          const t = s / numSamples;
          const pt = getCurvePt(t);
          const norm = getNormal(t);
          const curPressure = p1 + t * (p2 - p1);

          const rSeed = seedShift + s;
          const jitter = (pseudoRandom(rSeed) - 0.5) * strWidth * curPressure * 0.15;
          const wave = Math.sin(t * Math.PI * 4 + p * 1.5) * strWidth * curPressure * 0.08;
          const offsetNorm = jitter + wave;
          const offsetTangent = (pseudoRandom(rSeed * 7) - 0.5) * strWidth * curPressure * 0.1;

          // Normal direction unit vector
          const dxNorm = norm.x;
          const dyNorm = norm.y;
          // Tangent direction unit vector
          const dxTan = -norm.y;
          const dyTan = norm.x;

          const finalX = pt.x + dxNorm * offsetNorm + dxTan * offsetTangent;
          const finalY = pt.y + dyNorm * offsetNorm + dyTan * offsetTangent;

          if (s === 0) {
            d += `M ${finalX} ${finalY}`;
          } else {
            d += ` L ${finalX} ${finalY}`;
          }
        }

        primitives.push({
          type: 'path',
          d,
          fill: 'none',
          stroke: strColor,
          strokeWidth: Math.max(0.7, strWidth * avgPressure * 0.35),
          opacity: 0.75,
          strokeLinecap: 'round',
          key: `stroke-rough-${fr.id}-${idx}-${p}`,
        });
      }
    } else if (strokeType === 'brush') {
      // Artistic brush stroke: 5 thin parallel tapered lines showing bristles
      const numSamples = 24;
      const numBristles = 5;
      const avgPressure = (p1 + p2) / 2;

      for (let p = 0; p < numBristles; p++) {
        let d = '';
        // start and end offsets to make some bristles shorter (artistic start/end dry paint)
        const bristleSeed = fr.id * 100 + idx * 22 + p * 89;
        const tStart = 0.0 + 0.12 * pseudoRandom(bristleSeed);
        const tEnd = 1.0 - 0.12 * pseudoRandom(bristleSeed * 3);

        const bristleOffsetPercent = (p - (numBristles - 1) / 2) * 0.32; // span from -0.6 to 0.6 of strokeWidth

        for (let s = 0; s <= numSamples; s++) {
          const sampleT = s / numSamples;
          const t = tStart + sampleT * (tEnd - tStart);
          const pt = getCurvePt(t);
          const norm = getNormal(t);
          const curPressure = p1 + t * (p2 - p1);

          const bristleOffsetDistance = bristleOffsetPercent * strWidth * curPressure;

          // taper bristle at start and end
          const taper = Math.sin(sampleT * Math.PI);
          const dynamicOffset = bristleOffsetDistance * taper;

          // add micro-friction texture to bristle
          const frictionSeed = bristleSeed + s;
          const friction = (pseudoRandom(frictionSeed) - 0.5) * strWidth * curPressure * 0.05 * taper;

          const finalX = pt.x + norm.x * (dynamicOffset + friction);
          const finalY = pt.y + norm.y * (dynamicOffset + friction);

          if (s === 0) {
            d += `M ${finalX} ${finalY}`;
          } else {
            d += ` L ${finalX} ${finalY}`;
          }
        }

        primitives.push({
          type: 'path',
          d,
          fill: 'none',
          stroke: strColor,
          strokeWidth: Math.max(0.5, strWidth * avgPressure * 0.18),
          opacity: 0.65 + 0.25 * pseudoRandom(bristleSeed * 5),
          strokeLinecap: 'round',
          key: `stroke-brush-${fr.id}-${idx}-${p}`,
        });
      }
    } else if (strokeType === 'calligraphy') {
      // Calligraphy chisel stroke: width controlled by absolute angle of pen
      const numSamples = 24;
      const angle = (45 * Math.PI) / 180; // Calligraphy slant 45 degrees
      const chiselX = Math.cos(angle);
      const chiselY = Math.sin(angle);

      const leftSide: { x: number; y: number }[] = [];
      const rightSide: { x: number; y: number }[] = [];

      for (let s = 0; s <= numSamples; s++) {
        const t = s / numSamples;
        const pt = getCurvePt(t);
        const curPressure = p1 + t * (p2 - p1);
        const halfW = (strWidth * curPressure) / 2;

        leftSide.push({
          x: pt.x + chiselX * halfW,
          y: pt.y + chiselY * halfW,
        });
        rightSide.unshift({
          x: pt.x - chiselX * halfW,
          y: pt.y - chiselY * halfW,
        });
      }

      const pointsStr = [...leftSide, ...rightSide].map(p => `${p.x},${p.y}`).join(' ');

      primitives.push({
        type: 'polygon',
        points: pointsStr,
        fill: strColor,
        key: `stroke-calligraphy-${fr.id}-${idx}`,
      });

      // Simple calligraphic serif/endcap caps if requested
      if (strokeCaps === 'round') {
        const startPt = getCurvePt(0);
        const endPt = getCurvePt(1);
        primitives.push({
          type: 'line',
          x1: startPt.x - chiselX * (strWidth * p1) / 2,
          y1: startPt.y - chiselY * (strWidth * p1) / 2,
          x2: startPt.x + chiselX * (strWidth * p1) / 2,
          y2: startPt.y + chiselY * (strWidth * p1) / 2,
          stroke: strColor,
          strokeWidth: 2,
          key: `stroke-calligraphy-cap-s-${fr.id}-${idx}`,
        });
        primitives.push({
          type: 'line',
          x1: endPt.x - chiselX * (strWidth * p2) / 2,
          y1: endPt.y - chiselY * (strWidth * p2) / 2,
          x2: endPt.x + chiselX * (strWidth * p2) / 2,
          y2: endPt.y + chiselY * (strWidth * p2) / 2,
          stroke: strColor,
          strokeWidth: 2,
          key: `stroke-calligraphy-cap-e-${fr.id}-${idx}`,
        });
      }
    } else if (strokeType === 'wiggly') {
      // Wavy cartoon "live" stroke line with variable thickness
      const numSamples = 24;
      const leftSide: { x: number; y: number }[] = [];
      const rightSide: { x: number; y: number }[] = [];

      for (let s = 0; s <= numSamples; s++) {
        const t = s / numSamples;
        const pt = getCurvePt(t);
        const norm = getNormal(t);

        const wave = Math.sin(t * Math.PI * 6 + fr.id * 1.7 + idx) * strWidth * 0.14;
        const curPressure = p1 + t * (p2 - p1);
        const thicknessWave = 1.0 + 0.28 * Math.sin(t * Math.PI * 10 + fr.id * 3 + idx * 2);
        const halfW = (strWidth * curPressure * thicknessWave) / 2;

        const centerX = pt.x + norm.x * wave;
        const centerY = pt.y + norm.y * wave;

        leftSide.push({
          x: centerX + norm.x * halfW,
          y: centerY + norm.y * halfW,
        });
        rightSide.unshift({
          x: centerX - norm.x * halfW,
          y: centerY - norm.y * halfW,
        });
      }

      const pointsStr = [...leftSide, ...rightSide].map(p => `${p.x},${p.y}`).join(' ');

      primitives.push({
        type: 'polygon',
        points: pointsStr,
        fill: strColor,
        key: `stroke-wiggly-${fr.id}-${idx}`,
      });
    }
  }

  return primitives;
};

