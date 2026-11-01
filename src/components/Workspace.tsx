/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Page, Frame, Layer, AppState } from '../types';
import {
  Image as ImageIcon,
  Sparkles,
  Trash2,
  Sliders,
  Maximize,
  Scissors,
  MousePointer,
  Square,
  PenTool,
  Brush,
  Eraser,
} from 'lucide-react';
import {
  Point,
  getPolygonBounds,
  splitPolygon,
  isPointInPolygon,
  snapAngle,
  getAdjustedVertices,
  getSnappedPoint,
  getSvgPathFromVertices,
  getTransformedVertices,
  ramerDouglasPeucker,
  computeBezierHandles,
  eraseFrameSegments,
  generateVectorStrokePrimitives,
  getLineIntersection,
} from '../utils/geometry';
import { getPageFrameAdjustments, getFrameLayerAdjustments, getFrameAncestors, getLocalVertices } from '../utils/modifiers';

interface WorkspaceProps {
  state: AppState;
  selectedLayerId: number | null;
  selectedLayerIds: number[];
  onSelectLayerIds: (layerIds: number[]) => void;
  activeLayers: number | null; // active frame ID for layers panel
  selectedFrameIds: number[];
  onSelectFrameIds: (frameIds: number[]) => void;
  selVertices: { frameId: number; vIdx: number }[];
  onSetSelVertices: (verts: { frameId: number; vIdx: number }[]) => void;
  onSelectLayer: (layerId: number | null) => void;
  onToggleLayersPanel: (frameId: number | null) => void;
  onModifyFrame: (frameId: number, modifications: Partial<Frame>) => void;
  onModifyFrames?: (updates: { id: number; modifications: Partial<Frame> }[]) => void;
  onModifyLayer: (layerId: number, modifications: Partial<Layer>) => void;
  onSplitFrame: (frameId: number, direction: 'h' | 'v') => void;
  onDeleteFrame: (frameId: number) => void;
  onUpdatePageState: (modifications: { w?: number; h?: number; frames?: Frame[] }) => void;
  onAddLayerTrigger: (frameId: number) => void;
  onAddLayerToFrame: (frameId: number, src: string, name: string) => void;
  onSnapshot: () => void;
  
  // Lifted from App
  activeTool: 'select' | 'vertex' | 'knife' | 'add-rect' | 'add-poly' | 'pressure' | 'brush' | 'eraser';
  setActiveTool: (tool: 'select' | 'vertex' | 'knife' | 'add-rect' | 'add-poly' | 'pressure' | 'brush' | 'eraser') => void;
  knifeGutter: number;

  brushColor: string;
  brushFillColor: string;
  brushSize: number;
  brushSmoothing: number;
  brushFillEnabled: boolean;
  eraserSize: number;
  onionEnabled: boolean;
  onionPrevCount: number;
  onionNextCount: number;
  brushStabilizer: 'smooth' | 'lazy';
  lazyRadius: number;
  editingFrameId?: number | null;
  onSetEditingFrameId?: (fid: number | null) => void;
}

export const Workspace: React.FC<WorkspaceProps> = ({
  state,
  selectedLayerId,
  selectedLayerIds,
  onSelectLayerIds,
  activeLayers,
  selectedFrameIds,
  onSelectFrameIds,
  selVertices,
  onSetSelVertices,
  onSelectLayer,
  onToggleLayersPanel,
  onModifyFrame,
  onModifyFrames,
  onModifyLayer,
  onSplitFrame,
  onDeleteFrame,
  onUpdatePageState,
  onAddLayerTrigger,
  onAddLayerToFrame,
  onSnapshot,
  activeTool,
  setActiveTool,
  knifeGutter,
  brushColor,
  brushFillColor,
  brushSize,
  brushSmoothing,
  brushFillEnabled,
  eraserSize,
  onionEnabled,
  onionPrevCount,
  onionNextCount,
  brushStabilizer,
  lazyRadius,
  editingFrameId = null,
  onSetEditingFrameId = (_fid: number | null) => {},
}) => {
  const page = state.pages[state.currentPage];
  const pw = page.w || state.width;
  const ph = page.h || state.height;
  const editingFrame = editingFrameId ? page.frames.find((f) => f.id === editingFrameId) : null;

  // Track global normalized mouse offset relative to viewport
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
  const [time, setTime] = useState(Date.now());

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent) => {
      const mx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2 || 1);
      const my = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2 || 1);
      setMouseOffset({ x: mx, y: my });
    };
    window.addEventListener('mousemove', handleGlobalMove);
    return () => window.removeEventListener('mousemove', handleGlobalMove);
  }, []);

  useEffect(() => {
    let animId: number;
    const tick = () => {
      setTime(Date.now());
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Viewport navigation & zooming
  const areaRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOffsetStart = useRef({ x: 0, y: 0 });

  // Vertex multi-select selection state (props)
  const setSelVertices = onSetSelVertices;
  const [isSelectingVertices, setIsSelectingVertices] = useState(false);
  const [selectStart, setSelectStart] = useState<Point | null>(null);
  const [selectEnd, setSelectEnd] = useState<Point | null>(null);

  // Drag multi-vertex positioning memory
  const dragStartMouse = useRef<Point | null>(null);
  const dragStartVertices = useRef<{ frameId: number; vIdx: number; x: number; y: number }[]>([]);

  // Local stroke pressure tuning (SAI style)
  const [draggedPressureVertex, setDraggedPressureVertex] = useState<{ frameId: number; vIdx: number } | null>(null);
  const dragStartPressureMouse = useRef<Point | null>(null);
  const dragStartPressureVal = useRef<number>(1.0);
  const dragStartPressureValues = useRef<{ frameId: number; vIdx: number; val: number }[]>([]);

  // Drag over frame feedback
  const [dragOverFrameId, setDragOverFrameId] = useState<number | null>(null);
  const [isDraggingFrameActive, setIsDraggingFrameActive] = useState<boolean>(false);
  const [draggedFrameId, setDraggedFrameId] = useState<number | null>(null);
  const [draggingFrameIds, setDraggingFrameIds] = useState<number[]>([]);

  // Geometric editing states
  const [draggedVertex, setDraggedVertex] = useState<{ frameId: number; vIdx: number } | null>(null);
  const [draggedHandle, setDraggedHandle] = useState<{
    frameId: number;
    vIdx: number;
    type: 'in' | 'out';
  } | null>(null);

  // Knife tool states
  const [isDrawingKnife, setIsDrawingKnife] = useState(false);
  const [knifeStart, setKnifeStart] = useState<Point | null>(null);
  const [knifeEnd, setKnifeEnd] = useState<Point | null>(null);

  // Add rectangle states
  const [isDrawingRect, setIsDrawingRect] = useState(false);
  const [rectStart, setRectStart] = useState<Point | null>(null);
  const [rectEnd, setRectEnd] = useState<Point | null>(null);

  // Add polygon states
  const [polyPoints, setPolyPoints] = useState<Point[]>([]);
  const [currentMouse, setCurrentMouse] = useState<Point | null>(null);

  // Brush & Eraser states
  const [brushPoints, setBrushPoints] = useState<{ x: number; y: number; pressure: number }[]>([]);
  const [isDrawingBrush, setIsDrawingBrush] = useState(false);
  const [isDrawingEraser, setIsDrawingEraser] = useState(false);
  const [eraserCursorPos, setEraserCursorPos] = useState<Point | null>(null);
  const [rawCursorPos, setRawCursorPos] = useState<Point | null>(null);
  const [lazyAnchor, setLazyAnchor] = useState<Point | null>(null);

  // Automatic Viewport scale fitter
  const handleFitScreen = () => {
    if (!areaRef.current) return;
    const padding = 80;
    const cw = areaRef.current.clientWidth - padding;
    const ch = areaRef.current.clientHeight - padding;
    const scale = Math.min(cw / pw, ch / ph, 1.2);
    setZoom(scale);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    handleFitScreen();
  }, [state.currentPage, pw, ph]);

  useEffect(() => {
    const handleResize = () => handleFitScreen();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [pw, ph]);

  // Viewport scrollwheel scaling
  const handleAreaWheel = (e: React.WheelEvent) => {
    if (isDrawingKnife || isDrawingRect || draggedVertex) return;
    if (e.ctrlKey || e.metaKey) return; 

    // Intercept scroll wheel if in vertex edit mode and we have selected vertices (requires Alt key to prevent blocking zoom)
    if ((activeTool === 'vertex' || activeTool === 'pressure') && selVertices.length > 0 && e.altKey) {
      e.preventDefault();
      e.stopPropagation();

      const pointsList: { frameId: number; vIdx: number; x: number; y: number }[] = [];
      selVertices.forEach((item) => {
        const fr = page.frames.find((f) => f.id === item.frameId);
        if (fr) {
          const vertices = fr.vertices || [
            { x: fr.x, y: fr.y },
            { x: fr.x + fr.w, y: fr.y },
            { x: fr.x + fr.w, y: fr.y + fr.h },
            { x: fr.x, y: fr.y + fr.h },
          ];
          const v = vertices[item.vIdx];
          if (v) {
            pointsList.push({ ...item, x: v.x, y: v.y });
          }
        }
      });

      if (pointsList.length > 0) {
        let sumX = 0, sumY = 0;
        pointsList.forEach((p) => { sumX += p.x; sumY += p.y; });
        const cx = sumX / pointsList.length;
        const cy = sumY / pointsList.length;

        // Shift + Wheel -> Rotate; No-Shift + Wheel -> Scale
        const angle = (e.deltaY > 0 ? 5 : -5) * Math.PI / 180;
        const factor = e.deltaY > 0 ? 0.95 : 1.05;

        const updatedFrames = page.frames.map((fr) => {
          const matches = pointsList.filter((m) => m.frameId === fr.id);
          if (matches.length > 0) {
            const oldVertices = [...(fr.vertices || [
              { x: fr.x, y: fr.y },
              { x: fr.x + fr.w, y: fr.y },
              { x: fr.x + fr.w, y: fr.y + fr.h },
              { x: fr.x, y: fr.y + fr.h },
            ])];

            matches.forEach((item) => {
              const dx = item.x - cx;
              const dy = item.y - cy;
              let rx = item.x;
              let ry = item.y;

              if (e.shiftKey) {
                rx = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
                ry = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
              } else {
                rx = cx + dx * factor;
                ry = cy + dy * factor;
              }

              oldVertices[item.vIdx] = {
                x: Math.max(0, Math.min(pw, Math.round(rx))),
                y: Math.max(0, Math.min(ph, Math.round(ry))),
              };
            });

            const bounds = getPolygonBounds(oldVertices);
            return {
              ...fr,
              vertices: oldVertices,
              ...bounds,
            };
          }
          return fr;
        });

        onUpdatePageState({ frames: updatedFrames });
        onSnapshot();
      }
      return;
    }

    e.preventDefault();
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.0015);
    const newZoom = Math.max(0.08, Math.min(8, zoom * factor));

    if (areaRef.current) {
      const rect = areaRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const rx = mx - rect.width / 2;
      const ry = my - rect.height / 2;

      const ratio = newZoom / zoom;
      setPan({
        x: rx - (rx - pan.x) * ratio,
        y: ry - (ry - pan.y) * ratio,
      });
    }
    setZoom(newZoom);
  };

  // Convert screen pixels to local sheet coordinate points
  const screenToSheetCoords = (clientX: number, clientY: number): Point => {
    if (!sheetRef.current) return { x: 0, y: 0 };
    const rect = sheetRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  };

  const performEraseAction = (pt: Point) => {
    let modified = false;
    const nextFrames: Frame[] = [];

    page.frames.forEach((fr) => {
      // Import the eraser from geometric utils
      const outcomes = eraseFrameSegments(fr, pt, eraserSize);
      if (outcomes.length !== 1 || outcomes[0] !== fr) {
        modified = true;
        nextFrames.push(...outcomes);
      } else {
        nextFrames.push(fr);
      }
    });

    if (modified) {
      onUpdatePageState({ frames: nextFrames });
    }
  };

  const handleFinishBrushStroke = (pts: typeof brushPoints) => {
    if (pts.length < 2) return;

    // Apply RDP simplification
    const epsilon = Math.max(0.2, brushSmoothing * 15);
    const simplified = ramerDouglasPeucker(pts, epsilon);

    if (simplified.length < 2) return;

    // Smooth Bezier handles
    const handles = computeBezierHandles(simplified, false);

    // Map simplified points to vertices
    const vertices = simplified.map((pt, idx) => ({
      x: Math.round(pt.x),
      y: Math.round(pt.y),
      handleIn: handles[idx].handleIn ? { x: Math.round(handles[idx].handleIn!.x), y: Math.round(handles[idx].handleIn!.y) } : undefined,
      handleOut: handles[idx].handleOut ? { x: Math.round(handles[idx].handleOut!.x), y: Math.round(handles[idx].handleOut!.y) } : undefined,
      isCurve: true,
    }));

    const finalPressures = simplified.map((pt) => {
      const orig = pts.find((p) => Math.abs(p.x - pt.x) < 0.1 && Math.abs(p.y - pt.y) < 0.1);
      return orig ? parseFloat(orig.pressure.toFixed(3)) : 1.0;
    });

    const bounds = getPolygonBounds(vertices);

    const newFr: Frame = {
      id: Date.now() + Math.round(Math.random() * 100000),
      ...bounds,
      parentId: editingFrameId || undefined,
      name: `Мазок ${page.frames.length + 1}`,
      vertices,
      vertexPressures: finalPressures,
      isClosed: false,
      fillColor: brushFillEnabled ? brushFillColor : 'transparent',
      strokeColor: brushColor,
      strokeWidth: brushSize,
      layers: [],
      borderWidths: {},
      strokeWidths: {},
    };

    onUpdatePageState({ frames: [...page.frames, newFr] });
    onSnapshot();
  };

  const handleAreaPointerDown = (e: React.PointerEvent) => {
    // Only intercept if we are in brush or eraser tool
    if (activeTool !== 'brush' && activeTool !== 'eraser') return;
    if (e.button !== 0) return; // ignore non-primary clicks

    e.preventDefault();
    e.stopPropagation();

    const localPt = screenToSheetCoords(e.clientX, e.clientY);

    if (activeTool === 'brush') {
      setIsDrawingBrush(true);
      const press = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 1.0;
      
      const initialIntPt = { x: Math.round(localPt.x), y: Math.round(localPt.y) };
      setRawCursorPos(initialIntPt);
      setLazyAnchor(initialIntPt);

      const initialPts = [{ x: initialIntPt.x, y: initialIntPt.y, pressure: press }];
      setBrushPoints(initialPts);

      let ptsRef = [...initialPts];
      let currentAnchor = { x: localPt.x, y: localPt.y };

      const handlePointerMove = (mv: PointerEvent) => {
        mv.preventDefault();
        const curPt = screenToSheetCoords(mv.clientX, mv.clientY);
        setRawCursorPos(curPt);

        const pressVal = mv.pressure !== undefined && mv.pressure > 0 ? mv.pressure : 1.0;

        if (brushStabilizer === 'lazy') {
          const dist = Math.hypot(curPt.x - currentAnchor.x, curPt.y - currentAnchor.y);
          if (dist > lazyRadius) {
            const ratio = (dist - lazyRadius) / dist;
            const nextPt = {
              x: currentAnchor.x + (curPt.x - currentAnchor.x) * ratio,
              y: currentAnchor.y + (curPt.y - currentAnchor.y) * ratio
            };
            currentAnchor = nextPt;
            setLazyAnchor(nextPt);

            const smoothedPt = {
              x: Math.round(nextPt.x),
              y: Math.round(nextPt.y),
              pressure: pressVal
            };
            const nextPts = [...ptsRef, smoothedPt];
            ptsRef = nextPts;
            setBrushPoints(nextPts);
          }
        } else {
          // Exponential smoothing
          const last = ptsRef[ptsRef.length - 1];
          const alpha = brushSmoothing !== undefined ? brushSmoothing : 0.15;
          const smoothed = {
            x: last.x * (1 - alpha) + curPt.x * alpha,
            y: last.y * (1 - alpha) + curPt.y * alpha,
          };
          setLazyAnchor(smoothed);

          const nextPts = [...ptsRef, { x: Math.round(smoothed.x), y: Math.round(smoothed.y), pressure: pressVal }];
          ptsRef = nextPts;
          setBrushPoints(nextPts);
        }
      };

      const handlePointerUp = (upEv: PointerEvent) => {
        upEv.preventDefault();
        setIsDrawingBrush(false);
        setRawCursorPos(null);
        setLazyAnchor(null);
        handleFinishBrushStroke(ptsRef);
        setBrushPoints([]);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp, { passive: false });
    } else if (activeTool === 'eraser') {
      setIsDrawingEraser(true);
      setEraserCursorPos(localPt);
      performEraseAction(localPt);

      const handlePointerMove = (mv: PointerEvent) => {
        mv.preventDefault();
        const curPt = screenToSheetCoords(mv.clientX, mv.clientY);
        setEraserCursorPos(curPt);
        performEraseAction(curPt);
      };

      const handlePointerUp = (upEv: PointerEvent) => {
        upEv.preventDefault();
        setIsDrawingEraser(false);
        setEraserCursorPos(null);
        onSnapshot();
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp, { passive: false });
    }
  };

  const handleEraserHoverMove = (e: React.PointerEvent) => {
    if (activeTool === 'eraser') {
      const localPt = screenToSheetCoords(e.clientX, e.clientY);
      setEraserCursorPos(localPt);
    } else {
      if (eraserCursorPos) {
        setEraserCursorPos(null);
      }
    }
  };

  const handleAreaMouseDown = (e: React.MouseEvent) => {
    // Prevent normal mouse downs if we are using brush/eraser (processed in PointerDown)
    if (activeTool === 'brush' || activeTool === 'eraser') {
      e.preventDefault();
      return;
    }
    // 1. Page canvas pan triggering: Middle-mouse or Shift+Left-mouse click ALWAYS takes precedence
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      panOffsetStart.current = { ...pan };
      return;
    }

    // 2. Click in Vertex tool: RMB triggers a knife slice line to insert vertices
    if (e.button === 2 && activeTool === 'vertex') {
      e.preventDefault();
      e.stopPropagation();
      const localPt = screenToSheetCoords(e.clientX, e.clientY);
      const snappedPt = getSnappedPoint(localPt, page.frames, pw, ph);
      setIsDrawingKnife(true);
      setKnifeStart(snappedPt);
      setKnifeEnd(snappedPt);
      return;
    }

    // 3. Click on empty space in Vertex or Pressure mode (Left-Mouse button) starts marquee selection
    if (e.button === 0 && (activeTool === 'vertex' || activeTool === 'pressure')) {
      e.preventDefault();
      e.stopPropagation();
      const localPt = screenToSheetCoords(e.clientX, e.clientY);
      setIsSelectingVertices(true);
      setSelectStart(localPt);
      setSelectEnd(localPt);
      return;
    }

    if (e.button !== 0) return; // only left click triggers other tools

    const localPt = screenToSheetCoords(e.clientX, e.clientY);

    // Knife Tool
    if (activeTool === 'knife') {
      e.preventDefault();
      const snappedPt = getSnappedPoint(localPt, page.frames, pw, ph);
      setIsDrawingKnife(true);
      setKnifeStart(snappedPt);
      setKnifeEnd(snappedPt);
      return;
    }

    // Add Rect Tool
    if (activeTool === 'add-rect') {
      e.preventDefault();
      setIsDrawingRect(true);
      setRectStart(localPt);
      setRectEnd(localPt);
      return;
    }

    // Add Poly Tool
    if (activeTool === 'add-poly') {
      e.preventDefault();
      // If click is close to the start coordinate of polyLine: close the path loop
      if (polyPoints.length >= 3) {
        const dist = Math.hypot(localPt.x - polyPoints[0].x, localPt.y - polyPoints[0].y);
        if (dist < 15) {
          handleClosePoly();
          return;
        }
      }

      const newVertex = { x: localPt.x, y: localPt.y };
      const nextPoints = [...polyPoints, newVertex];
      setPolyPoints(nextPoints);

      const activeIdx = nextPoints.length - 1;
      const startX = e.clientX;
      const startY = e.clientY;

      const handlePolyDragMove = (mv: MouseEvent) => {
        const dx = (mv.clientX - startX) / zoom;
        const dy = (mv.clientY - startY) / zoom;
        if (Math.hypot(dx, dy) > 3) {
          setPolyPoints((prev) => {
            const copy = [...prev];
            if (copy[activeIdx]) {
              copy[activeIdx] = {
                ...copy[activeIdx],
                isCurve: true,
                handleOut: { x: dx, y: dy },
                handleIn: { x: -dx, y: -dy }
              };
            }
            return copy;
          });
        }
      };

      const handlePolyDragUp = () => {
        window.removeEventListener('mousemove', handlePolyDragMove);
        window.removeEventListener('mouseup', handlePolyDragUp);
      };

      window.addEventListener('mousemove', handlePolyDragMove);
      window.addEventListener('mouseup', handlePolyDragUp);
      return;
    }

    // Default select tool actions inside workspace
    if (activeTool === 'select') {
      const targetElement = e.target as HTMLElement;
      const isToolbarOrPanel = targetElement.closest('.floating-toolbar') || targetElement.closest('[data-settings-panel]');
      if (!isToolbarOrPanel) {
        onSelectLayer(null);
        onSelectLayerIds([]);
        if (!editingFrameId) {
          onToggleLayersPanel(null);
          onSelectFrameIds([]);
        }
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isPanning) {
        setPan({
          x: panOffsetStart.current.x + (e.clientX - panStart.current.x),
          y: panOffsetStart.current.y + (e.clientY - panStart.current.y),
        });
        return;
      }

      if (isSelectingVertices && selectStart) {
        const localPt = screenToSheetCoords(e.clientX, e.clientY);
        setSelectEnd(localPt);
        return;
      }

      if (isDrawingKnife && knifeStart) {
        let localPt = screenToSheetCoords(e.clientX, e.clientY);
        localPt = getSnappedPoint(localPt, page.frames, pw, ph);
        if (e.shiftKey) {
          // Snap angle
          const dx = localPt.x - knifeStart.x;
          const dy = localPt.y - knifeStart.y;
          const snapped = snapAngle(dx, dy);
          localPt = { x: knifeStart.x + snapped.x, y: knifeStart.y + snapped.y };
        }
        setKnifeEnd(localPt);
        return;
      }

      if (isDrawingRect && rectStart) {
        const localPt = screenToSheetCoords(e.clientX, e.clientY);
        setRectEnd(localPt);
        return;
      }

      if (activeTool === 'add-poly' && polyPoints.length > 0) {
        const localPt = screenToSheetCoords(e.clientX, e.clientY);
        setCurrentMouse(localPt);
        return;
      }

      if (draggedHandle) {
        const localPt = screenToSheetCoords(e.clientX, e.clientY);
        const fr = page.frames.find((f) => f.id === draggedHandle.frameId);
        if (fr) {
          const vertices = fr.vertices ? JSON.parse(JSON.stringify(fr.vertices)) : [
            { x: fr.x, y: fr.y },
            { x: fr.x + fr.w, y: fr.y },
            { x: fr.x + fr.w, y: fr.y + fr.h },
            { x: fr.x, y: fr.y + fr.h },
          ];

          const v = vertices[draggedHandle.vIdx];
          if (v) {
            // Relative coordinates of handle offset from parent vertex position
            const rx = localPt.x - v.x;
            const ry = localPt.y - v.y;

            if (draggedHandle.type === 'in') {
              v.handleIn = { x: rx, y: ry };
            } else {
              v.handleOut = { x: rx, y: ry };
            }

            const updatedFrames = page.frames.map((f) => {
              if (f.id === draggedHandle.frameId) {
                return {
                  ...f,
                  vertices,
                };
              }
              return f;
            });

            onUpdatePageState({ frames: updatedFrames });
          }
        }
        return;
      }

      if (draggedVertex && dragStartMouse.current) {
        const localPt = screenToSheetCoords(e.clientX, e.clientY);
        const dx = localPt.x - dragStartMouse.current.x;
        const dy = localPt.y - dragStartMouse.current.y;

        const updatedFrames = page.frames.map((fr) => {
          const matches = dragStartVertices.current.filter((d) => d.frameId === fr.id);
          if (matches.length > 0) {
            const oldVertices = [...(fr.vertices || [
              { x: fr.x, y: fr.y },
              { x: fr.x + fr.w, y: fr.y },
              { x: fr.x + fr.w, y: fr.y + fr.h },
              { x: fr.x, y: fr.y + fr.h },
            ])];

            matches.forEach((item) => {
              const original = oldVertices[item.vIdx];
              oldVertices[item.vIdx] = {
                ...original,
                x: Math.max(0, Math.min(pw, Math.round(item.x + dx))),
                y: Math.max(0, Math.min(ph, Math.round(item.y + dy))),
              };
            });

            const bounds = getPolygonBounds(oldVertices);
            return {
              ...fr,
              vertices: oldVertices,
              ...bounds,
            };
          }
          return fr;
        });

        onUpdatePageState({ frames: updatedFrames });
        return;
      }

      if (draggedPressureVertex && dragStartPressureMouse.current) {
        const localPt = screenToSheetCoords(e.clientX, e.clientY);
        const dx = localPt.x - dragStartPressureMouse.current.x;
        const deltaPressure = dx / 150.0; // Smooth multiplier adjustment

        const updatedFrames = page.frames.map((fr) => {
          const matches = dragStartPressureValues.current.filter((sp) => sp.frameId === fr.id);
          if (matches.length > 0) {
            const count = (fr.vertices || [
              { x: fr.x, y: fr.y },
              { x: fr.x + fr.w, y: fr.y },
              { x: fr.x + fr.w, y: fr.y + fr.h },
              { x: fr.x, y: fr.y + fr.h },
            ]).length;
            const nextPressures = [...(fr.vertexPressures && fr.vertexPressures.length === count 
              ? fr.vertexPressures 
              : Array(count).fill(1.0))];

            matches.forEach((item) => {
              const newVal = Math.max(0.1, Math.min(6.0, item.val + deltaPressure));
              nextPressures[item.vIdx] = parseFloat(newVal.toFixed(3));
            });

            return {
              ...fr,
              vertexPressures: nextPressures,
            };
          }
          return fr;
        });

        onUpdatePageState({ frames: updatedFrames });
        return;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isPanning) {
        setIsPanning(false);
      }

      if (isSelectingVertices && selectStart && selectEnd) {
        setIsSelectingVertices(false);
        const xMin = Math.min(selectStart.x, selectEnd.x);
        const xMax = Math.max(selectStart.x, selectEnd.x);
        const yMin = Math.min(selectStart.y, selectEnd.y);
        const yMax = Math.max(selectStart.y, selectEnd.y);

        const found: { frameId: number; vIdx: number }[] = [];
        page.frames.forEach((fr) => {
          const adjustedVertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, page.borderWidth);
          adjustedVertices.forEach((pt, idx) => {
            if (pt.x >= xMin && pt.x <= xMax && pt.y >= yMin && pt.y <= yMax) {
              found.push({ frameId: fr.id, vIdx: idx });
            }
          });
        });

        if (e.shiftKey) {
          const combined = [...selVertices];
          found.forEach((item) => {
            if (!combined.some(c => c.frameId === item.frameId && c.vIdx === item.vIdx)) {
              combined.push(item);
            }
          });
          setSelVertices(combined);
        } else {
          setSelVertices(found);
        }

        setSelectStart(null);
        setSelectEnd(null);
      } else if (isSelectingVertices) {
        setIsSelectingVertices(false);
        setSelectStart(null);
        setSelectEnd(null);
      }

      if (isDrawingKnife && knifeStart && knifeEnd) {
        setIsDrawingKnife(false);
        if (activeTool === 'vertex') {
          handleVertexKnifeCut(knifeStart, knifeEnd);
        } else {
          handleKnifeCut(knifeStart, knifeEnd);
        }
        setKnifeStart(null);
        setKnifeEnd(null);
      }

      if (isDrawingRect && rectStart && rectEnd) {
        setIsDrawingRect(false);
        handleCreateRectFrame(rectStart, rectEnd);
        setRectStart(null);
        setRectEnd(null);
      }

      if (draggedVertex) {
        setDraggedVertex(null);
        onSnapshot();
      }

      if (draggedHandle) {
        setDraggedHandle(null);
        onSnapshot();
      }

      if (draggedPressureVertex) {
        setDraggedPressureVertex(null);
        onSnapshot();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isPanning,
    isSelectingVertices,
    selectStart,
    selectEnd,
    isDrawingKnife,
    knifeStart,
    knifeEnd,
    isDrawingRect,
    rectStart,
    rectEnd,
    activeTool,
    polyPoints,
    draggedVertex,
    draggedHandle,
    draggedPressureVertex,
    selVertices,
    page,
  ]);

  const handleVertexKnifeCut = (p1: Point, p2: Point) => {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist < 10) return; // ignore short tiny clicks

    let anyChange = false;
    const updatedFrames = page.frames.map((fr) => {
      if (fr.locked) return fr;

      const vertices = fr.vertices || [
        { x: fr.x, y: fr.y },
        { x: fr.x + fr.w, y: fr.y },
        { x: fr.x + fr.w, y: fr.y + fr.h },
        { x: fr.x, y: fr.y + fr.h },
      ];

      const n = vertices.length;
      if (n < 3) return fr;

      const newVertices: typeof vertices = [];
      const newPressures: number[] = [];
      const currentPressures = fr.vertexPressures && fr.vertexPressures.length === n
        ? fr.vertexPressures
        : Array(n).fill(1.0);

      let frameChange = false;

      for (let i = 0; i < n; i++) {
        const A = vertices[i];
        const B = vertices[(i + 1) % n];

        newVertices.push(A);
        newPressures.push(currentPressures[i]);

        const pt = getLineIntersection(A, B, p1, p2);
        if (pt) {
          // Calculate t (0 to 1) for pressure interpolation
          const distAB = Math.hypot(B.x - A.x, B.y - A.y);
          let t = 0.5;
          if (distAB > 1e-4) {
            t = Math.hypot(pt.x - A.x, pt.y - A.y) / distAB;
          }
          const pA = currentPressures[i];
          const pB = currentPressures[(i + 1) % n];
          const pIntersect = pA + (pB - pA) * t;

          newVertices.push({
            x: Math.round(pt.x),
            y: Math.round(pt.y),
            isCurve: A.isCurve || B.isCurve,
          });
          newPressures.push(parseFloat(pIntersect.toFixed(3)));
          frameChange = true;
          anyChange = true;
        }
      }

      if (frameChange) {
        // Dedup consecutive vertices
        const cleanVerts: typeof vertices = [];
        const cleanPressures: number[] = [];
        for (let k = 0; k < newVertices.length; k++) {
          const curr = newVertices[k];
          const prev = cleanVerts[cleanVerts.length - 1];
          if (!prev || Math.hypot(curr.x - prev.x, curr.y - prev.y) > 1.5) {
            cleanVerts.push(curr);
            cleanPressures.push(newPressures[k]);
          }
        }
        // Wrapping check
        if (cleanVerts.length > 2) {
          const first = cleanVerts[0];
          const last = cleanVerts[cleanVerts.length - 1];
          if (Math.hypot(first.x - last.x, first.y - last.y) < 1.5) {
            cleanVerts.pop();
            cleanPressures.pop();
          }
        }

        const bounds = getPolygonBounds(cleanVerts);
        return {
          ...fr,
          vertices: cleanVerts,
          vertexPressures: cleanPressures,
          ...bounds,
        };
      }
      return fr;
    });

    if (anyChange) {
      onUpdatePageState({ frames: updatedFrames });
      onSnapshot();
    }
  };

  // Slices frames that intersect the drawn slice path
  const handleKnifeCut = (p1: Point, p2: Point) => {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist < 10) return; // ignore short tiny clicks

    let splitHappened = false;
    const nextFrames: Frame[] = [];

    page.frames.forEach((fr) => {
      const vertices = fr.vertices || [
        { x: fr.x, y: fr.y },
        { x: fr.x + fr.w, y: fr.y },
        { x: fr.x + fr.w, y: fr.y + fr.h },
        { x: fr.x, y: fr.y + fr.h },
      ];

      // Split utilizing our geometry helper
      const splitResult = splitPolygon(vertices, p1, p2, knifeGutter);
      if (splitResult) {
        splitHappened = true;
        const [polyA, polyB] = splitResult;

        const boundsA = getPolygonBounds(polyA);
        const boundsB = getPolygonBounds(polyB);

        // Frame A
        const frameA: Frame = {
          ...fr,
          id: Date.now() + Math.floor(Math.random() * 1000),
          vertices: polyA,
          ...boundsA,
          layers: JSON.parse(JSON.stringify(fr.layers)), // clones layer stack nicely
        };

        // Frame B
        const frameB: Frame = {
          ...fr,
          id: Date.now() + Math.floor(Math.random() * 2000) + 1000,
          vertices: polyB,
          ...boundsB,
          layers: JSON.parse(JSON.stringify(fr.layers)),
        };

        nextFrames.push(frameA, frameB);
      } else {
        nextFrames.push(fr);
      }
    });

    if (splitHappened) {
      onUpdatePageState({ frames: nextFrames });
      onSnapshot();
    }
  };

  // Creates standard rectangular vector panel frame
  const handleCreateRectFrame = (p1: Point, p2: Point) => {
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);

    if (w < 20 || h < 20) return; // avoid placeholder frames on accidental tiny drags

    const newFr: Frame = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      vertices: [
        { x: Math.round(x), y: Math.round(y) },
        { x: Math.round(x + w), y: Math.round(y) },
        { x: Math.round(x + w), y: Math.round(y + h) },
        { x: Math.round(x), y: Math.round(y + h) },
      ],
      layers: [],
      borderWidths: {},
      strokeWidths: {},
    };

    onUpdatePageState({ frames: [...page.frames, newFr] });
    onSnapshot();
  };

  // Closes polygon loop creation & instantiates a polygonal frame
  const handleClosePoly = () => {
    if (polyPoints.length < 3) return;

    const bounds = getPolygonBounds(polyPoints);

    const newFr: Frame = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      ...bounds,
      vertices: [...polyPoints],
      layers: [],
      borderWidths: {},
      strokeWidths: {},
    };

    onUpdatePageState({ frames: [...page.frames, newFr] });
    onSnapshot();
    setPolyPoints([]);
    setCurrentMouse(null);
  };

  // Deletes concrete single vertex handle point
  const handleDeleteVertex = (frameId: number, vIdx: number) => {
    const target = page.frames.find((f) => f.id === frameId);
    if (!target) return;

    const oldVertices = target.vertices || [
      { x: target.x, y: target.y },
      { x: target.x + target.w, y: target.y },
      { x: target.x + target.w, y: target.y + target.h },
      { x: target.x, y: target.y + target.h },
    ];

    if (oldVertices.length <= 3) return; // min vertices to contain shape is 3

    const nextVertices = oldVertices.filter((_, idx) => idx !== vIdx);
    const bounds = getPolygonBounds(nextVertices);

    const updatedFrames = page.frames.map((fr) => {
      if (fr.id === frameId) {
        return {
          ...fr,
          vertices: nextVertices,
          ...bounds,
        };
      }
      return fr;
    });

    onUpdatePageState({ frames: updatedFrames });
    onSnapshot();
  };

  // double click outline to add vertex point in-between adjacent vertices
  const handleOutlineDoubleClick = (e: React.MouseEvent, frameId: number) => {
    const target = page.frames.find((f) => f.id === frameId);
    if (!target) return;

    const oldVertices = target.vertices || [
      { x: target.x, y: target.y },
      { x: target.x + target.w, y: target.y },
      { x: target.x + target.w, y: target.y + target.h },
      { x: target.x, y: target.y + target.h },
    ];

    const clickPt = screenToSheetCoords(e.clientX, e.clientY);

    // Finding segment closest to double-click coordinate
    let closestIndex = 0;
    let minDistance = Infinity;

    const n = oldVertices.length;
    for (let i = 0; i < n; i++) {
      const A = oldVertices[i];
      const B = oldVertices[(i + 1) % n];

      // Point to segment distance calculation
      const l2 = Math.hypot(B.x - A.x, B.y - A.y);
      let t = 0;
      if (l2 > 1e-6) {
        t = ((clickPt.x - A.x) * (B.x - A.x) + (clickPt.y - A.y) * (B.y - A.y)) / l2;
        t = Math.max(0, Math.min(1, t));
      }
      const dist = Math.hypot(clickPt.x - (A.x + t * (B.x - A.x)), clickPt.y - (A.y + t * (B.y - A.y)));

      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = i;
      }
    }

    const nextVertices = [...oldVertices];
    nextVertices.splice(closestIndex + 1, 0, { x: Math.round(clickPt.x), y: Math.round(clickPt.y) });

    const bounds = getPolygonBounds(nextVertices);

    const updatedFrames = page.frames.map((fr) => {
      if (fr.id === frameId) {
        return {
          ...fr,
          vertices: nextVertices,
          ...bounds,
        };
      }
      return fr;
    });

    onUpdatePageState({ frames: updatedFrames });
    onSnapshot();
  };

  const handleVertexMouseDown = (e: React.MouseEvent, frameId: number, vIdx: number) => {
    e.preventDefault();
    e.stopPropagation();

    const parentFr = page.frames.find(f => f.id === frameId);
    if (parentFr && parentFr.locked) return;

    const isShift = e.shiftKey;
    const isAlreadySelected = selVertices.some(sv => sv.frameId === frameId && sv.vIdx === vIdx);

    let nextSel = [...selVertices];
    if (isShift) {
      if (isAlreadySelected) {
        nextSel = nextSel.filter(sv => !(sv.frameId === frameId && sv.vIdx === vIdx));
      } else {
        nextSel.push({ frameId, vIdx });
      }
    } else {
      if (!isAlreadySelected) {
        nextSel = [{ frameId, vIdx }];
      }
    }
    setSelVertices(nextSel);

    // Prepare multi-move state
    const localPt = screenToSheetCoords(e.clientX, e.clientY);
    dragStartMouse.current = localPt;

    // Gather initial coordinates
    const list: { frameId: number; vIdx: number; x: number; y: number }[] = [];
    nextSel.forEach((item) => {
      const fr = page.frames.find(f => f.id === item.frameId);
      if (fr) {
        const pts = fr.vertices || [
          { x: fr.x, y: fr.y },
          { x: fr.x + fr.w, y: fr.y },
          { x: fr.x + fr.w, y: fr.y + fr.h },
          { x: fr.x, y: fr.y + fr.h },
        ];
        const pt = pts[item.vIdx];
        if (pt) {
          list.push({ frameId: item.frameId, vIdx: item.vIdx, x: pt.x, y: pt.y });
        }
      }
    });

    dragStartVertices.current = list;
    setDraggedVertex({ frameId, vIdx });
  };

  const handlePressureVertexMouseDown = (e: React.MouseEvent, frameId: number, vIdx: number) => {
    e.preventDefault();
    e.stopPropagation();

    const parentFr = page.frames.find(f => f.id === frameId);
    if (parentFr && parentFr.locked) return;

    const isShift = e.shiftKey;
    const isAlreadySelected = selVertices.some(sv => sv.frameId === frameId && sv.vIdx === vIdx);

    let nextSel = [...selVertices];
    if (isShift) {
      if (isAlreadySelected) {
        nextSel = nextSel.filter(sv => !(sv.frameId === frameId && sv.vIdx === vIdx));
      } else {
        nextSel.push({ frameId, vIdx });
      }
    } else {
      if (!isAlreadySelected) {
        nextSel = [{ frameId, vIdx }];
      }
    }
    setSelVertices(nextSel);

    const localPt = screenToSheetCoords(e.clientX, e.clientY);
    dragStartPressureMouse.current = localPt;

    // Save starting pressures of all selected pressure nodes to our ref!
    const list: { frameId: number; vIdx: number; val: number }[] = [];
    nextSel.forEach((item) => {
      const fr = page.frames.find(f => f.id === item.frameId);
      if (fr) {
        const count = (fr.vertices || [1, 2, 3, 4]).length;
        const initialPressures = fr.vertexPressures || Array(count).fill(1.0);
        const val = initialPressures[item.vIdx] !== undefined ? initialPressures[item.vIdx] : 1.0;
        list.push({ frameId: item.frameId, vIdx: item.vIdx, val });
      }
    });
    dragStartPressureValues.current = list;
    setDraggedPressureVertex({ frameId, vIdx });
  };

  // Frame Drag/Translate handler
  const handleFrameDragStart = (e: React.MouseEvent, fr: Frame) => {
    if (e.button !== 0 || activeTool !== 'select') return;
    if (fr.locked) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    const framesToTrack = selectedFrameIds.includes(fr.id)
      ? selectedFrameIds
      : [fr.id];

    const getAllDescendants = (ids: number[]): number[] => {
      const descendants: number[] = [];
      const queue = [...ids];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const children = page.frames.filter(f => f.parentId === currentId);
        children.forEach(c => {
          if (!descendants.includes(c.id) && !ids.includes(c.id)) {
            descendants.push(c.id);
            queue.push(c.id);
          }
        });
      }
      return descendants;
    };

    const allTrackedIds = Array.from(new Set([...framesToTrack, ...getAllDescendants(framesToTrack)]));
    setDraggingFrameIds(allTrackedIds);

    const origins = allTrackedIds.map(fid => {
      const f = page.frames.find(frame => frame.id === fid);
      return { id: fid, tx: f?.tx || 0, ty: f?.ty || 0 };
    });

    const handleMouseMove = (mv: MouseEvent) => {
      const deltaX = (mv.clientX - startX) / zoom;
      const deltaY = (mv.clientY - startY) / zoom;
      if (onModifyFrames) {
        const updates = origins.map(orig => ({
          id: orig.id,
          modifications: {
            tx: orig.tx + deltaX,
            ty: orig.ty + deltaY,
          }
        }));
        onModifyFrames(updates);
      } else {
        origins.forEach(orig => {
          onModifyFrame?.(orig.id, {
            tx: orig.tx + deltaX,
            ty: orig.ty + deltaY,
          });
        });
      }

      // Find target name badge under pointer
      const targetEl = document.elementFromPoint(mv.clientX, mv.clientY);
      const nestEl = targetEl?.closest('[data-nest-target-id]');
      if (nestEl) {
        const hoverId = parseInt(nestEl.getAttribute('data-nest-target-id') || '');
        if (!isNaN(hoverId) && !allTrackedIds.includes(hoverId)) {
          setDragOverFrameId(hoverId);
          setIsDraggingFrameActive(true);
        } else {
          setDragOverFrameId(null);
          setIsDraggingFrameActive(false);
        }
      } else {
        setDragOverFrameId(null);
        setIsDraggingFrameActive(false);
      }
    };

    const handleMouseUp = (mv: MouseEvent) => {
      // Check final hovered name badge and nest
      const targetEl = document.elementFromPoint(mv.clientX, mv.clientY);
      const nestEl = targetEl?.closest('[data-nest-target-id]');
      if (nestEl) {
        const targetId = parseInt(nestEl.getAttribute('data-nest-target-id') || '');
        if (!isNaN(targetId) && !allTrackedIds.includes(targetId)) {
          const checkCycle = (childId: number, parentId: number): boolean => {
            let currId = childId;
            const watched = new Set<number>();
            while (currId) {
              if (currId === parentId) return true;
              if (watched.has(currId)) break;
              watched.add(currId);
              const currentFrame = page.frames.find(x => x.id === currId);
              if (!currentFrame || !currentFrame.parentId) break;
              currId = currentFrame.parentId;
            }
            return false;
          };

          if (onModifyFrames) {
            const nestingUpdates = allTrackedIds
              .filter(draggedId => !checkCycle(targetId, draggedId))
              .map(draggedId => ({
                id: draggedId,
                modifications: { parentId: targetId }
              }));
            if (nestingUpdates.length > 0) {
              onModifyFrames(nestingUpdates);
            } else {
              onSnapshot();
            }
          } else {
            onSnapshot();
            allTrackedIds.forEach(draggedId => {
              if (!checkCycle(targetId, draggedId)) {
                onModifyFrame?.(draggedId, { parentId: targetId });
              }
            });
          }
        } else {
          onSnapshot();
        }
      } else {
        onSnapshot();
      }

      setDraggingFrameIds([]);
      setDragOverFrameId(null);
      setIsDraggingFrameActive(false);

      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Image Layer Drag details inside selected frame
  const handleImgDragStart = (e: React.MouseEvent, layer: Layer) => {
    if (e.button !== 0) return;
    if (layer.locked) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    const layersToTrack = selectedLayerIds.includes(layer.id)
      ? selectedLayerIds
      : [layer.id];

    const origins = layersToTrack.map(lid => {
      let l: Layer | undefined;
      for (const f of page.frames) {
        l = f.layers.find(ly => ly.id === lid);
        if (l) break;
      }
      return { id: lid, tx: l?.tx || 0, ty: l?.ty || 0 };
    });

    const handleMouseMove = (mv: MouseEvent) => {
      const deltaX = (mv.clientX - startX) / zoom;
      const deltaY = (mv.clientY - startY) / zoom;
      origins.forEach(orig => {
        onModifyLayer(orig.id, {
          tx: orig.tx + deltaX,
          ty: orig.ty + deltaY,
        });
      });
    };

    const handleMouseUp = () => {
      onSnapshot();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Image Scaling and rotation
  const handleImgWheel = (e: React.WheelEvent, layer: Layer) => {
    e.preventDefault();
    e.stopPropagation();

    if (layer.locked) return;

    const layersToTrack = selectedLayerIds.includes(layer.id)
      ? selectedLayerIds
      : [layer.id];

    if (e.shiftKey) {
      const deltaDeg = e.deltaY > 0 ? -4 : 4;
      layersToTrack.forEach(lid => {
        let l: Layer | undefined;
        for (const f of page.frames) {
          l = f.layers.find(ly => ly.id === lid);
          if (l) break;
        }
        if (l && !l.locked) {
          const newRot = ((l.rotate + deltaDeg) % 360 + 360) % 360;
          onModifyLayer(lid, { rotate: newRot > 180 ? newRot - 360 : newRot });
        }
      });
    } else {
      const scaleStep = e.deltaY > 0 ? -0.05 : 0.05;
      layersToTrack.forEach(lid => {
        let l: Layer | undefined;
        for (const f of page.frames) {
          l = f.layers.find(ly => ly.id === lid);
          if (l) break;
        }
        if (l && !l.locked) {
          const curScale = l.scale;
          const newScale = Math.max(0.1, Math.min(10, curScale + scaleStep));
          const mods: Partial<Layer> = { scale: newScale };
          if (l.scaleX !== undefined) mods.scaleX = Math.max(0.1, Math.min(10, l.scaleX + scaleStep));
          if (l.scaleY !== undefined) mods.scaleY = Math.max(0.1, Math.min(10, l.scaleY + scaleStep));
          onModifyLayer(lid, mods);
        }
      });
    }
  };

  // Dotted handles scaling calculations
  const handleResizeHandleMouseDown = (
    e: React.MouseEvent,
    layer: Layer,
    corner: 'tl' | 'tr' | 'bl' | 'br'
  ) => {
    if (layer.locked) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const originScaleX = layer.scaleX !== undefined ? layer.scaleX : layer.scale;
    const originScaleY = layer.scaleY !== undefined ? layer.scaleY : layer.scale;
    const originScale = layer.scale;

    const targetEl = e.currentTarget.parentElement;
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const startDist = Math.hypot(startX - cx, startY - cy) || 1;

    // Angle variables
    const rad = (layer.rotate * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);

    const vx = startX - cx;
    const vy = startY - cy;
    const startLocalX = Math.abs(vx * ux + vy * uy) || 1;
    const startLocalY = Math.abs(-vx * uy + vy * ux) || 1;

    const isFree = layer.resizeMode === 'free';

    const handleMouseMove = (mv: MouseEvent) => {
      const curDist = Math.hypot(mv.clientX - cx, mv.clientY - cy);

      if (!isFree) {
        const newScale = Math.max(0.05, originScale * (curDist / startDist));
        onModifyLayer(layer.id, {
          scale: newScale,
          scaleX: newScale,
          scaleY: newScale,
        });
      } else {
        const cvx = mv.clientX - cx;
        const cvy = mv.clientY - cy;
        const curLocalX = Math.abs(cvx * ux + cvy * uy);
        const curLocalY = Math.abs(-cvx * uy + cvy * ux);

        const newScaleX = Math.max(0.05, originScaleX * (curLocalX / startLocalX));
        const newScaleY = Math.max(0.05, originScaleY * (curLocalY / startLocalY));

        onModifyLayer(layer.id, {
          scaleX: newScaleX,
          scaleY: newScaleY,
        });
      }
    };

    const handleMouseUp = () => {
      onSnapshot();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleFrameResizeHandleMouseDown = (
    e: React.MouseEvent,
    fr: Frame,
    corner: 'tl' | 'tr' | 'bl' | 'br'
  ) => {
    if (fr.locked) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const originScaleX = fr.scaleX !== undefined ? fr.scaleX : (fr.scale !== undefined ? fr.scale : 1.0);
    const originScaleY = fr.scaleY !== undefined ? fr.scaleY : (fr.scale !== undefined ? fr.scale : 1.0);

    const adjusted = getAdjustedVertices(fr, pw, ph, state.borderWidth, page.borderWidth);
    const box = getPolygonBounds(adjusted);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;

    const startDistX = Math.abs(startX - cx) || 1;
    const startDistY = Math.abs(startY - cy) || 1;
    const startDist = Math.hypot(startX - cx, startY - cy) || 1;

    const handleMouseMove = (mv: MouseEvent) => {
      const currDistX = Math.abs(mv.clientX - cx);
      const currDistY = Math.abs(mv.clientY - cy);
      const curDist = Math.hypot(mv.clientX - cx, mv.clientY - cy);

      if (mv.shiftKey) {
        // Proportional scale
        const uniformRatio = curDist / startDist;
        const newScaleX = Math.max(0.05, originScaleX * uniformRatio);
        const newScaleY = Math.max(0.05, originScaleY * uniformRatio);
        onModifyFrame(fr.id, {
          scaleX: newScaleX,
          scaleY: newScaleY,
          scale: (newScaleX + newScaleY) / 2,
        });
      } else {
        // Free scale (non-proportional)
        const newScaleX = Math.max(0.05, originScaleX * (currDistX / startDistX));
        const newScaleY = Math.max(0.05, originScaleY * (currDistY / startDistY));
        onModifyFrame(fr.id, {
          scaleX: newScaleX,
          scaleY: newScaleY,
          scale: (newScaleX + newScaleY) / 2,
        });
      }
    };

    const handleMouseUp = () => {
      onSnapshot();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleSheetResizeMouseDown = (e: React.MouseEvent, direction: 'r' | 'b' | 'br') => {
    e.preventDefault();
    e.stopPropagation();

    const startW = pw;
    const startH = ph;
    const startX = e.clientX;
    const startY = e.clientY;

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;

      let nextW = startW;
      let nextH = startH;

      if (direction === 'r' || direction === 'br') {
        nextW = Math.max(200, Math.min(3000, Math.round(startW + dx)));
      }
      if (direction === 'b' || direction === 'br') {
        nextH = Math.max(200, Math.min(3000, Math.round(startH + dy)));
      }

      onUpdatePageState({ w: nextW, h: nextH });
    };

    const handleMouseUp = () => {
      onSnapshot();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const renderMappedOutlineSegments = (frToRender: Frame, mappedVertices: any[]) => {
    const fallbackSW = page.strokeWidth !== undefined ? page.strokeWidth : state.strokeWidth;
    const strColor = frToRender.strokeColor || (page.strokeColor !== undefined ? page.strokeColor : state.strokeColor);
    const strWidth = frToRender.strokeWidth !== undefined ? frToRender.strokeWidth : fallbackSW;

    const primitives = generateVectorStrokePrimitives(
      frToRender,
      mappedVertices,
      strWidth,
      strColor,
      state.strokeCaps || 'round'
    );

    return primitives.map((p, idx) => {
      const key = p.key || `stroke-primitive-${frToRender.id}-${idx}`;
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
  };

  const renderFrameOutlineSegments = (frToRender: Frame, relativeToBox: { x: number; y: number }) => {
    const adjusted = getAdjustedVertices(frToRender, pw, ph, state.borderWidth, page.borderWidth);
    const clipVertices = adjusted.map((v) => ({
      x: v.x - relativeToBox.x,
      y: v.y - relativeToBox.y,
      handleIn: v.handleIn,
      handleOut: v.handleOut,
      isCurve: v.isCurve,
    }));
    return renderMappedOutlineSegments(frToRender, clipVertices);
  };

  return (
    <div
      ref={areaRef}
      onWheel={handleAreaWheel}
      onMouseDown={handleAreaMouseDown}
      onPointerDown={handleAreaPointerDown}
      onPointerMove={handleEraserHoverMove}
      onContextMenu={(e) => {
        if (activeTool === 'vertex' || activeTool === 'pressure' || activeTool === 'brush' || activeTool === 'eraser') {
          e.preventDefault();
        }
      }}
      className="canvas-backdrop-wrapper flex-1 bg-[#080706] overflow-hidden relative cursor-default select-none transition-colors duration-300"
      style={{
        backgroundColor: editingFrameId ? (editingFrame?.fillColor || state.pageBg) : undefined,
        backgroundImage: editingFrameId ? 'none' : 'radial-gradient(circle, #252018 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Floating vertical cyberpunk tools bar */}
      <div className="absolute left-4 top-4 z-[100] bg-[#141210]/95 border-2 border-[#3A3228] p-1.5 rounded-lg flex flex-col gap-1.5 shadow-2xl">
        <button
          onClick={() => {
            setActiveTool('select');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'select'
              ? 'bg-[#FC018D] border-[#FC018D] text-white shadow-[0_0_15px_rgba(252,1,141,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-white hover:border-[#FC018D]'
          }`}
          title="Слои: выбор и трансформация слоев внутри фреймов (Move, Scale, Rotate)"
        >
          <MousePointer size={15} />
        </button>

        <button
          onClick={() => {
            setActiveTool('vertex');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'vertex'
              ? 'bg-[#339EEE] border-[#339EEE] text-white shadow-[0_0_15px_rgba(51,158,238,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-[#339EEE] hover:border-[#339EEE]'
          }`}
          title="Вершины: тяните углы, двойной клик по рамке добавит узел, двойной клик по узлу удалит его"
        >
          <Maximize size={15} />
        </button>

        <button
          onClick={() => {
            setActiveTool('knife');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'knife'
              ? 'bg-[#FF9F1C] border-[#FF9F1C] text-white shadow-[0_0_15px_rgba(255,159,28,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-[#FF9F1C] hover:border-[#FF9F1C]'
          }`}
          title="Нож: проведите линию через кадр для разреза. Удерживайте Shift для ортогонального реза."
        >
          <Scissors size={15} />
        </button>

        <button
          onClick={() => {
            setActiveTool('add-rect');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'add-rect'
              ? 'bg-[#2EC4B6] border-[#2EC4B6] text-white shadow-[0_0_15px_rgba(46,196,182,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-[#2EC4B6] hover:border-[#2EC4B6]'
          }`}
          title="Добавить кадр: зажмите и тяните по холсту для создания прямоугольного кадра"
        >
          <Square size={15} />
        </button>

        <button
          onClick={() => {
            setActiveTool('add-poly');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'add-poly'
              ? 'bg-[#9B5DE5] border-[#9B5DE5] text-white shadow-[0_0_15px_rgba(155,93,229,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-[#9B5DE5] hover:border-[#9B5DE5]'
          }`}
          title="Нарисовать многоугольник: кликайте для создания углов, кликните по первому углу для закрытия контура"
        >
          <PenTool size={15} />
        </button>

        <button
          onClick={() => {
            setActiveTool('pressure');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'pressure'
              ? 'bg-[#E056FD] border-[#E056FD] text-white shadow-[0_0_15px_rgba(224,86,253,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-[#E056FD] hover:border-[#E056FD]'
          }`}
          title="Давление: зажмите вершину и тяните по горизонтали влево/вправо для изменения толщины обводки (по аналогии с вектором в Paint Tool SAI)"
        >
          <Sparkles size={15} />
        </button>

        <button
          onClick={() => {
            setActiveTool('brush');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'brush'
              ? 'bg-[#10AC84] border-[#10AC84] text-white shadow-[0_0_15px_rgba(16,172,132,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-[#10AC84] hover:border-[#10AC84]'
          }`}
          title="Кисть (Brush): свободное рисование сглаженных кривых пером (чувствительность к нажатию стилуса)"
        >
          <Brush size={15} />
        </button>

        <button
          onClick={() => {
            setActiveTool('eraser');
            setPolyPoints([]);
            setCurrentMouse(null);
          }}
          className={`p-2.5 rounded transition-all duration-150 cursor-pointer flex items-center justify-center border ${
            activeTool === 'eraser'
              ? 'bg-[#FF4757] border-[#FF4757] text-white shadow-[0_0_15px_rgba(255,71,87,0.6)]'
              : 'bg-[#1c1815] border-[#2d2620] text-[#7A7470] hover:text-[#FF4757] hover:border-[#FF4757]'
          }`}
          title="Ластик (Eraser): стирает или разрезает векторные мазки и контуры фигур по Blender Grease Pencil"
        >
          <Eraser size={15} />
        </button>
      </div>

      {/* Dynamic Screen fit Button */}
      <div className="absolute right-4 bottom-4 z-[90] flex flex-col gap-2">
        <button
          onClick={handleFitScreen}
          className="p-2.5 bg-[#141210] border-2 border-[#3A3228] hover:border-[#FC018D] text-[#7A7470] hover:text-[#FC018D] shadow-md transition-colors duration-150 rounded cursor-pointer"
          title="Вписать страницу на весь экран"
        >
          <Maximize size={16} />
        </button>
      </div>

      {/* Main Pan / Scale container viewport */}
      <div
        className="absolute top-1/2 left-1/2 select-none"
        style={{
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
          transition: 'none',
        }}
      >
        <div
          ref={sheetRef}
          className="relative shadow-2xl select-none"
          style={{
            width: `${pw}px`,
            height: `${ph}px`,
            backgroundColor: state.borderColor,
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'none',
          }}
        >
          {/* Sliced/Custom Vector frames container */}
          <div className="absolute inset-0 overflow-visible select-none pointer-events-none">
            {editingFrameId && (() => {
              const editFr = page.frames.find((f) => f.id === editingFrameId);
              if (!editFr) return null;
              if (editFr.passepartout === false) return null;

              const adjustedVertices = getAdjustedVertices(editFr, pw, ph, state.borderWidth, page.borderWidth);
              const clipPathD = getSvgPathFromVertices(adjustedVertices, editFr.isClosed !== false);

              // Use evenodd fillRule on a combined path (outer rect + inner frame shape) to cut out the hole
              const outerRectD = `M 0 0 h ${pw} v ${ph} h ${-pw} z`;
              const combinedPathD = `${outerRectD} ${clipPathD}`;

              return (
                <div className="absolute inset-0 pointer-events-none z-[19]" key="passepartout-overlay">
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ mixBlendMode: 'multiply' }}>
                    <path
                      d={combinedPathD}
                      fillRule="evenodd"
                      fill="rgba(14, 12, 10, 0.72)"
                      className="pointer-events-none"
                    />
                  </svg>
                  <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
                    <path
                      d={clipPathD}
                      fill="none"
                      stroke={editFr.strokeColor || '#FC018D'}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      opacity={0.85}
                      className="pointer-events-none"
                    />
                  </svg>
                </div>
              );
            })()}
            {/* Onion Skinning Layer */}
            {onionEnabled && (() => {
              const onionSkins: React.ReactNode[] = [];
              const prevStart = Math.max(0, state.currentPage - onionPrevCount);
              const nextEnd = Math.min(state.pages.length - 1, state.currentPage + onionNextCount);

              // 1. Preceding pages (Red Tint)
              for (let idx = prevStart; idx < state.currentPage; idx++) {
                const prevPage = state.pages[idx];
                const distance = state.currentPage - idx;
                const opacity = 0.35 / distance; // dimmer as they get older
                
                prevPage.frames.forEach((fr) => {
                  if (fr.hidden) return;
                  const adjustedVertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, prevPage.borderWidth);
                  const pathD = getSvgPathFromVertices(adjustedVertices, fr.isClosed !== false);
                  onionSkins.push(
                    <path
                      key={`onion-prev-${idx}-${fr.id}`}
                      d={pathD}
                      fill={fr.isClosed !== false ? 'rgba(255, 71, 87, 0.04)' : 'none'}
                      stroke="rgba(255, 71, 87, 0.45)"
                      strokeWidth={(fr.strokeWidth || 3) * 0.85}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={opacity}
                      className="pointer-events-none"
                    />
                  );
                });
              }

              // 2. Succeeding pages (Green Tint)
              for (let idx = state.currentPage + 1; idx <= nextEnd; idx++) {
                const nextPage = state.pages[idx];
                const distance = idx - state.currentPage;
                const opacity = 0.35 / distance; // dimmer as they get newer

                nextPage.frames.forEach((fr) => {
                  if (fr.hidden) return;
                  const adjustedVertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, nextPage.borderWidth);
                  const pathD = getSvgPathFromVertices(adjustedVertices, fr.isClosed !== false);
                  onionSkins.push(
                    <path
                      key={`onion-next-${idx}-${fr.id}`}
                      d={pathD}
                      fill={fr.isClosed !== false ? 'rgba(16, 172, 132, 0.04)' : 'none'}
                      stroke="rgba(16, 172, 132, 0.45)"
                      strokeWidth={(fr.strokeWidth || 3) * 0.85}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={opacity}
                      className="pointer-events-none"
                    />
                  );
                });
              }

              if (onionSkins.length === 0) return null;
              return (
                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-[5] opacity-80">
                  {onionSkins}
                </svg>
              );
            })()}

            {page.frames.map((fr, fIdx) => {
              if (fr.hidden) return null;
              if (editingFrameId && fr.id !== editingFrameId) return null;

              const pageAdj = getPageFrameAdjustments(fr, page, mouseOffset, time);
              const adjustedVertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, page.borderWidth);
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
              const isDragOverThis = fr.id === dragOverFrameId;

              return (
                <div
                  key={fr.id}
                  data-frame-id={fr.id}
                  className="absolute select-none pointer-events-auto"
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDragLeave={() => {
                  }}
                  onDrop={(e) => {
                    e.preventDefault();

                    const isModifier = e.dataTransfer.types.some(t => t.includes('modifier'));
                    if (isModifier) {
                      try {
                        const modJson = e.dataTransfer.getData('application/x-modifier-json');
                        if (modJson) {
                          const parsedMod = JSON.parse(modJson);
                          onSnapshot();
                          const currentModifiers = fr.modifiers || [];
                          const clonedMod = {
                            ...parsedMod,
                            id: 'mod_' + Math.random().toString(36).substring(2, 9),
                            targetIds: fr.layers.map(l => l.id)
                          };
                          onModifyFrame(fr.id, {
                            modifiers: [...currentModifiers, clonedMod]
                          });
                        }
                      } catch (err) {
                        console.error('Failed to drop modifier on canvas frame', err);
                      }
                      return;
                    }

                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      Array.from(e.dataTransfer.files).forEach((file: any) => {
                        if (file.type.startsWith('image/')) {
                          const reader = new FileReader();
                          reader.onload = (loadEvt) => {
                            if (loadEvt.target?.result) {
                              const name =
                                file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                              onAddLayerToFrame(fr.id, loadEvt.target.result as string, name);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      });
                    } else {
                      try {
                        const dataText = e.dataTransfer.getData('text/plain');
                        if (dataText) {
                          const parsed = JSON.parse(dataText);
                          if (parsed.src && parsed.name) {
                            onAddLayerToFrame(fr.id, parsed.src, parsed.name);
                          }
                        }
                      } catch (err) {
                        // ignore
                      }
                    }
                  }}
                  style={{
                    left: `${box.x}px`,
                    top: `${box.y}px`,
                    width: `${box.w}px`,
                    height: `${box.h}px`,
                    zIndex: 10 + fIdx,
                    transform: `translate(${pageAdj.tx}px, ${pageAdj.ty}px) rotate(${pageAdj.rotate}deg) scaleX(${pageAdj.scaleX}) scaleY(${pageAdj.scaleY})`,
                    filter: pageAdj.cssFilter || undefined,
                    clipPath: fr.parentId ? `url(#clip-parent-${fr.id})` : undefined,
                    pointerEvents: draggingFrameIds.includes(fr.id) ? 'none' : undefined,
                  }}
                >
                  {/* Clipped custom polygon content block */}
                  <div
                    className={`absolute inset-0 ${editingFrameId === fr.id ? 'overflow-visible' : 'overflow-hidden'}`}
                    style={{
                      clipPath: editingFrameId === fr.id ? 'none' : `url(#clip-${fr.id})`,
                      backgroundColor: fr.fillColor || state.pageBg,
                    }}
                    onMouseDown={(e) => {
                      if (editingFrameId && editingFrameId === fr.id) {
                        return; // Bypass select & drag of active frame itself
                      }
                      if (e.button === 0 && activeTool === 'select') {
                        onSelectLayer(null);
                        onSelectLayerIds([]);

                        const isShift = e.shiftKey;
                        let nextFrameIds: number[];
                        if (isShift) {
                          if (selectedFrameIds.includes(fr.id)) {
                            nextFrameIds = selectedFrameIds.filter(id => id !== fr.id);
                          } else {
                            nextFrameIds = [...selectedFrameIds, fr.id];
                          }
                        } else {
                          nextFrameIds = [fr.id];
                        }

                        onSelectFrameIds(nextFrameIds);
                        onToggleLayersPanel(fr.id);
                        handleFrameDragStart(e, fr);
                      }
                    }}
                    onWheel={(e) => {
                      if (editingFrameId && editingFrameId === fr.id) {
                        // Allow the wheel event to pass through so high level sheet panning/zooming works normally,
                        // and prevent frame itself from accidentally scaling or rotating during internal layer edit
                        return;
                      }
                      if (activeTool === 'select' && activeLayers === fr.id) {
                        e.preventDefault();
                        e.stopPropagation();

                        const getFrameCenter = (frame: Frame) => {
                          const vertices = frame.vertices || [
                            { x: frame.x, y: frame.y },
                            { x: frame.x + frame.w, y: frame.y },
                            { x: frame.x + frame.w, y: frame.y + frame.h },
                            { x: frame.x, y: frame.y + frame.h },
                          ];
                          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                          vertices.forEach((v) => {
                            minX = Math.min(minX, v.x);
                            maxX = Math.max(maxX, v.x);
                            minY = Math.min(minY, v.y);
                            maxY = Math.max(maxY, v.y);
                          });
                          const cx = (minX + maxX) / 2;
                          const cy = (minY + maxY) / 2;
                          return {
                            cx,
                            cy,
                            x: cx + (frame.tx || 0),
                            y: cy + (frame.ty || 0),
                          };
                        };

                        const getDescendants = (parentId: number): Frame[] => {
                          const descendants: Frame[] = [];
                          const queue = [parentId];
                          while (queue.length > 0) {
                            const currentId = queue.shift()!;
                            const children = page.frames.filter(f => f.parentId === currentId);
                            children.forEach(c => {
                              if (!descendants.find(d => d.id === c.id) && c.id !== parentId) {
                                descendants.push(c);
                                queue.push(c.id);
                              }
                            });
                          }
                          return descendants;
                        };

                        const descendants = getDescendants(fr.id);

                        // Scroll wheel scales or rotates (if Shift is held)
                        if (e.shiftKey) {
                          const deltaDeg = e.deltaY > 0 ? -4 : 4;
                          const newRot = (((fr.rotate || 0) + deltaDeg) % 360 + 360) % 360;
                          const finalParentRot = newRot > 180 ? newRot - 360 : newRot;

                          if (descendants.length > 0 && onModifyFrames) {
                            const parentCenter = getFrameCenter(fr);
                            const rad = (deltaDeg * Math.PI) / 180;
                            const cos = Math.cos(rad);
                            const sin = Math.sin(rad);

                            const updates = [
                              { id: fr.id, modifications: { rotate: finalParentRot } },
                              ...descendants.map(c => {
                                const childCenter = getFrameCenter(c);
                                const dx = childCenter.x - parentCenter.x;
                                const dy = childCenter.y - parentCenter.y;
                                const newDx = dx * cos - dy * sin;
                                const newDy = dx * sin + dy * cos;
                                const newCenterX = parentCenter.x + newDx;
                                const newCenterY = parentCenter.y + newDy;

                                const newChildRotRaw = (((c.rotate || 0) + deltaDeg) % 360 + 360) % 360;
                                const finalChildRot = newChildRotRaw > 180 ? newChildRotRaw - 360 : newChildRotRaw;

                                return {
                                  id: c.id,
                                  modifications: {
                                    tx: newCenterX - childCenter.cx,
                                    ty: newCenterY - childCenter.cy,
                                    rotate: finalChildRot,
                                  }
                                };
                              })
                            ];
                            onModifyFrames(updates);
                          } else {
                            onModifyFrame?.(fr.id, { rotate: finalParentRot });
                          }
                        } else {
                          const scaleStep = e.deltaY > 0 ? -0.05 : 0.05;
                          const curScale = fr.scale !== undefined ? fr.scale : 1.0;
                          const newScale = Math.max(0.1, Math.min(10, curScale + scaleStep));

                          if (descendants.length > 0 && onModifyFrames && Math.abs(curScale) > 0.001) {
                            const ratio = newScale / curScale;
                            const parentCenter = getFrameCenter(fr);

                            const updates = [
                              { id: fr.id, modifications: { scale: newScale } },
                              ...descendants.map(c => {
                                const childCenter = getFrameCenter(c);
                                const dx = childCenter.x - parentCenter.x;
                                const dy = childCenter.y - parentCenter.y;
                                const newDx = dx * ratio;
                                const newDy = dy * ratio;
                                const newCenterX = parentCenter.x + newDx;
                                const newCenterY = parentCenter.y + newDy;

                                const childScaleX = c.scaleX !== undefined ? c.scaleX : (c.scale !== undefined ? c.scale : 1.0);
                                const childScaleY = c.scaleY !== undefined ? c.scaleY : (c.scale !== undefined ? c.scale : 1.0);

                                return {
                                  id: c.id,
                                  modifications: {
                                    tx: newCenterX - childCenter.cx,
                                    ty: newCenterY - childCenter.cy,
                                    scaleX: childScaleX * ratio,
                                    scaleY: childScaleY * ratio,
                                  }
                                };
                              })
                            ];
                            onModifyFrames(updates);
                          } else {
                            onModifyFrame?.(fr.id, { scale: newScale });
                          }
                        }
                      }
                    }}
                  >
                    {/* Inline local SVG defining high-fidelity Vector mask for curves clipping */}
                    <svg className="absolute w-0 h-0 pointer-events-none">
                      <defs>
                        {(() => {
                          const ancestors = getFrameAncestors(fr, page.frames);
                          if (ancestors.length === 0) return null;
                          return ancestors.map((ancestor, i) => {
                            const ancestorAdjVertices = getAdjustedVertices(ancestor, pw, ph, state.borderWidth, page.borderWidth);
                            const ancestorPageAdj = getPageFrameAdjustments(ancestor, page, mouseOffset, time);
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
                            const clipId = i === 0 ? `clip-parent-${fr.id}` : `clip-ancestor-${i}-${fr.id}`;
                            const nextClipId = i < ancestors.length - 1 ? `url(#clip-ancestor-${i + 1}-${fr.id})` : undefined;
                            return (
                              <clipPath key={clipId} id={clipId} clipPath={nextClipId}>
                                <path d={ancestorRelD} />
                              </clipPath>
                            );
                          });
                        })()}
                        <clipPath id={`clip-${fr.id}`}>
                          <path d={clipPathD} />
                        </clipPath>
                      </defs>
                    </svg>

                     {/* Centered watermark text / nesting target */}
                    <div
                      className="absolute inset-0 flex items-center justify-center select-none z-[1] pointer-events-none"
                    >
                      <div
                        data-nest-target-id={fr.id}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverFrameId(fr.id);
                          const isFrame = e.dataTransfer.types.some(t => t.includes('frame-id') || t.includes('react-frame'));
                          setIsDraggingFrameActive(isFrame);
                        }}
                        onDragLeave={(e) => {
                          e.stopPropagation();
                          setDragOverFrameId(null);
                          setIsDraggingFrameActive(false);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverFrameId(null);
                          setIsDraggingFrameActive(false);

                          try {
                            const droppedFrameIdStr = e.dataTransfer.getData('application/x-react-frame-id');
                            if (droppedFrameIdStr) {
                              const droppedId = parseInt(droppedFrameIdStr);
                              if (!isNaN(droppedId) && droppedId !== fr.id) {
                                // Cycle prevention check
                                const checkCycle = (childId: number, parentId: number): boolean => {
                                  let currId = childId;
                                  const watched = new Set<number>();
                                  while (currId) {
                                    if (currId === parentId) return true;
                                    if (watched.has(currId)) break;
                                    watched.add(currId);
                                    const currentFrame = page.frames.find(x => x.id === currId);
                                    if (!currentFrame || !currentFrame.parentId) break;
                                    currId = currentFrame.parentId;
                                  }
                                  return false;
                                };

                                if (!checkCycle(fr.id, droppedId)) {
                                  onSnapshot();
                                  onModifyFrame(droppedId, { parentId: fr.id });
                                }
                              }
                            }
                          } catch (err) {
                            // ignore
                          }
                        }}
                        className={`font-['Unbounded'] text-[6px] font-semibold tracking-wider text-center px-2 py-1 uppercase truncate max-w-[80%] rounded-full transition-all duration-200 ${
                          draggingFrameIds.length > 0 || isDraggingFrameActive
                            ? 'pointer-events-auto cursor-pointer border border-dashed border-[#FC018D]/60 bg-[#141210]/95 text-[#FC018D] shadow-[0_0_12px_rgba(252,1,141,0.3)] scale-110'
                            : 'text-[#7A7470]/15 pointer-events-none'
                        }`}
                      >
                        {fr.name || `${fIdx + 1}`}
                      </div>
                    </div>

                    {/* Layer stack */}
                    {visibleLayers.length > 0 && (
                      <div className="relative w-full h-full select-none pointer-events-none z-[15]">
                        {visibleLayers.map((layer, idx) => {
                          const isActive = layer.id === selectedLayerId || selectedLayerIds.includes(layer.id);
                          const layerAdj = getFrameLayerAdjustments(layer, fr, mouseOffset, null, time);
                          const sX = (layer.scaleX !== undefined ? layer.scaleX : layer.scale) * layerAdj.scaleX;
                          const sY = (layer.scaleY !== undefined ? layer.scaleY : layer.scale) * layerAdj.scaleY;

                          const frameCenterX = fr.x + (fr.tx || 0) + fr.w / 2;
                          const frameCenterY = fr.y + (fr.ty || 0) + fr.h / 2;
                          const boxCenterX = box.x + box.w / 2;
                          const boxCenterY = box.y + box.h / 2;
                          const stableOffsetX = frameCenterX - boxCenterX;
                          const stableOffsetY = frameCenterY - boxCenterY;

                          const layerTx = layer.tx + stableOffsetX + layerAdj.tx;
                          const layerTy = layer.ty + stableOffsetY + layerAdj.ty;
                          const layerRot = layer.rotate + layerAdj.rotate;

                          return (
                            <div
                              key={layer.id}
                              style={{
                                zIndex: idx + 1,
                                filter: layerAdj.cssFilter || undefined,
                              }}
                              className="absolute inset-0 flex items-center justify-center pointer-events-none"
                            >
                              {/* Inner transformed container for layer scaling and layout matching */}
                              <div
                                style={{
                                  transform: `translate(${layerTx}px, ${layerTy}px) scaleX(${sX}) scaleY(${sY}) rotate(${layerRot}deg)`,
                                  transformOrigin: 'center center',
                                }}
                                className="relative pointer-events-auto shrink-0 flex items-center justify-center"
                              >
                                <img
                                  src={layer.src}
                                  alt={layer.name}
                                  referrerPolicy="no-referrer"
                                  onMouseDown={(e) => {
                                    if (e.button !== 0 || activeTool !== 'select') return;
                                    e.preventDefault();
                                    e.stopPropagation();

                                    const isShift = e.shiftKey;
                                    let nextLayerIds: number[];

                                    if (isShift) {
                                      if (selectedLayerIds.includes(layer.id)) {
                                        nextLayerIds = selectedLayerIds.filter(id => id !== layer.id);
                                      } else {
                                        nextLayerIds = [...selectedLayerIds, layer.id];
                                      }
                                    } else {
                                      nextLayerIds = [layer.id];
                                    }

                                    onSelectLayerIds(nextLayerIds);
                                    if (nextLayerIds.length > 0) {
                                      onSelectLayer(nextLayerIds[0]);
                                      onToggleLayersPanel(fr.id);
                                    } else {
                                      onSelectLayer(null);
                                    }

                                    handleImgDragStart(e, layer);
                                  }}
                                  onWheel={(e) => {
                                    if (isActive && activeTool === 'select') {
                                      handleImgWheel(e, layer);
                                    }
                                  }}
                                  className={`max-w-full max-h-full object-contain select-none transition-shadow ${
                                    isActive && activeTool === 'select'
                                      ? 'cursor-grab active:cursor-grabbing border-2 border-dashed border-[#FC018D]/70'
                                      : activeTool === 'select'
                                        ? 'cursor-pointer hover:border hover:border-dashed hover:border-[#339EEE]/30'
                                        : ''
                                  }`}
                                />

                                {isActive && activeTool === 'select' && (
                                  <>
                                    <div
                                      onMouseDown={(e) => handleResizeHandleMouseDown(e, layer, 'tl')}
                                      className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-[#141210] border-2 border-dashed border-[#FC018D] rounded-full cursor-nwse-resize z-50 hover:bg-[#FC018D]"
                                      title="Тяните для масштабирования"
                                    />
                                    <div
                                      onMouseDown={(e) => handleResizeHandleMouseDown(e, layer, 'tr')}
                                      className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-[#141210] border-2 border-dashed border-[#FC018D] rounded-full cursor-nesw-resize z-50 hover:bg-[#FC018D]"
                                      title="Тяните для масштабирования"
                                    />
                                    <div
                                      onMouseDown={(e) => handleResizeHandleMouseDown(e, layer, 'bl')}
                                      className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-[#141210] border-2 border-dashed border-[#FC018D] rounded-full cursor-nesw-resize z-50 hover:bg-[#FC018D]"
                                      title="Тяните для масштабирования"
                                    />
                                    <div
                                      onMouseDown={(e) => handleResizeHandleMouseDown(e, layer, 'br')}
                                      className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-[#141210] border-2 border-dashed border-[#FC018D] rounded-full cursor-nwse-resize z-50 hover:bg-[#FC018D]"
                                      title="Тяните для масштабирования"
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Frame local Vector Outlines SVG to respect visual stacking order */}
                  <svg className="absolute inset-0 pointer-events-none w-full h-full z-[20] overflow-visible">
                    {(() => {
                      const allOutlines: React.ReactNode[] = [];
                      
                      // 1. Own frame outline
                      allOutlines.push(...renderFrameOutlineSegments(fr, box));
                      
                      // 2. Ancestor/Parent outlines for perfect masking overlap control
                      let currParentId = fr.parentId;
                      const visited = new Set<number>();
                      while (currParentId && !visited.has(currParentId)) {
                        visited.add(currParentId);
                        const parent = page.frames.find(p => p.id === currParentId);
                        if (!parent) break;
                        
                        const parentAdjVertices = getAdjustedVertices(parent, pw, ph, state.borderWidth, page.borderWidth);
                        const parentPageAdj = getPageFrameAdjustments(parent, page, mouseOffset, time);
                        const parentBox = getPolygonBounds(parentAdjVertices);
                        
                        // Map parent vertices perfectly to child's local coordinate space
                        const mappedVerts = getLocalVertices(
                          parentAdjVertices,
                          parentBox,
                          parentPageAdj,
                          box,
                          pageAdj,
                          1
                        );
                        
                        allOutlines.push(...renderMappedOutlineSegments(parent, mappedVerts));
                        currParentId = parent.parentId;
                      }
                      
                      return allOutlines;
                    })()}
                  </svg>

                  {/* Drag drop feedback indicator highlight */}
                  {isDragOverThis && (
                    <div
                      className="absolute inset-0 bg-[#FC018D]/20 border-4 border-dashed border-[#FC018D] z-30 pointer-events-none flex items-center justify-center animate-pulse"
                      style={{ clipPath: `url(#clip-${fr.id})` }}
                    >
                      <div className="bg-[#141210] border-2 border-[#FC018D] px-2 py-1 rounded-sm text-white text-[8px] uppercase font-['Unbounded'] font-bold select-none text-center">
                        {isDraggingFrameActive ? 'Добавь внутрь фигуры' : 'Бросить слои во фрейм'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* SVG Handles & Live outlines drawn directly in absolute sheet bounds context */}
          <div className="absolute inset-0 pointer-events-none z-[80]">
            {/* 1. Drag Vertex Circle Handle indicators */}
            {(activeTool === 'vertex' || activeTool === 'pressure') &&
              page.frames.map((fr) => {
                const adjustedVertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, page.borderWidth);
                const verticesCount = fr.vertices ? fr.vertices.length : 4;
                return adjustedVertices.map((v, vIdx) => {
                  const isSelected = selVertices.some((sv) => sv.frameId === fr.id && sv.vIdx === vIdx);
                  const pressures = fr.vertexPressures || Array(verticesCount).fill(1.0);
                  const pressMultiplier = pressures[vIdx] !== undefined ? pressures[vIdx] : 1.0;

                  return (
                    <div
                      key={`${fr.id}-v-${vIdx}`}
                      onMouseDown={(e) => {
                        if (activeTool === 'pressure') {
                          handlePressureVertexMouseDown(e, fr.id, vIdx);
                        } else {
                          handleVertexMouseDown(e, fr.id, vIdx);
                        }
                      }}
                      className={`absolute rounded-full cursor-grab active:cursor-grabbing -translate-x-1/2 -translate-y-1/2 hover:scale-115 transition-all duration-100 shadow pointer-events-auto flex items-center justify-center border-2 border-white/80 ${
                        activeTool === 'pressure'
                          ? isSelected
                            ? 'bg-[#FC018D]/75 scale-110 shadow-[0_0_8px_#FC018D] z-[100]'
                            : 'bg-[#FF9F1C]/65 hover:bg-[#FC018D]/85 z-[90]'
                          : isSelected
                            ? 'bg-[#FC018D]/75 scale-115 shadow-[0_0_8px_#FC018D] z-[100]'
                            : 'bg-[#339EEE]/65 hover:bg-[#FC018D]/85 z-[90]'
                      }`}
                      style={{
                        left: `${v.x}px`,
                        top: `${v.y}px`,
                        width: `${activeTool === 'pressure' ? 18 : 15}px`,
                        height: `${activeTool === 'pressure' ? 18 : 15}px`,
                      }}
                      title={
                        activeTool === 'pressure'
                          ? `Давление: ${pressMultiplier.toFixed(2)}x. Зажмите (можно с Shift для нескольких) и тяните по горизонтали.`
                          : `Зажмите и тяните для изменения формы. Двойной клик удалит вершину.`
                      }
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (activeTool === 'vertex') {
                          handleDeleteVertex(fr.id, vIdx);
                        }
                      }}
                    >
                      {activeTool === 'pressure' ? (
                        <div className="text-[6.5px] font-mono text-white select-none pointer-events-none font-bold">
                          {Math.round(pressMultiplier * 100)}
                        </div>
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </div>
                  );
                });
              })}

            {/* Bezier control handles (tangent lines + dots) rendering for selected vertices */}
            {activeTool === 'vertex' &&
              page.frames.map((fr) => {
                const adjusted = getAdjustedVertices(fr, pw, ph, state.borderWidth, page.borderWidth);
                return adjusted.map((v, vIdx) => {
                  const isSelected = selVertices.some((sv) => sv.frameId === fr.id && sv.vIdx === vIdx);
                  if (!isSelected) return null;

                  // Get original vertex for bezier properties
                  const origV = fr.vertices?.[vIdx];
                  if (!origV) return null;

                  const hIn = origV.handleIn;
                  const hOut = origV.handleOut;

                  const hInAbs = hIn ? { x: v.x + hIn.x, y: v.y + hIn.y } : null;
                  const hOutAbs = hOut ? { x: v.x + hOut.x, y: v.y + hOut.y } : null;

                  return (
                    <div key={`bezier-controls-${fr.id}-${vIdx}`} className="absolute inset-0 pointer-events-none z-[120]">
                      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                        {/* Tangent lines */}
                        {hInAbs && (
                          <line
                            x1={v.x}
                            y1={v.y}
                            x2={hInAbs.x}
                            y2={hInAbs.y}
                            stroke="#339EEE"
                            strokeWidth="1.5"
                            strokeDasharray="2,2"
                          />
                        )}
                        {hOutAbs && (
                          <line
                            x1={v.x}
                            y1={v.y}
                            x2={hOutAbs.x}
                            y2={hOutAbs.y}
                            stroke="#339EEE"
                            strokeWidth="1.5"
                            strokeDasharray="2,2"
                          />
                        )}
                      </svg>

                      {/* Handle In point */}
                      {hInAbs && (
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDraggedHandle({
                              frameId: fr.id,
                              vIdx: vIdx,
                              type: 'in'
                            });
                          }}
                          className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#339EEE] border-2 border-white cursor-pointer hover:bg-[#FC018D] pointer-events-auto shadow-md"
                          style={{ left: `${hInAbs.x}px`, top: `${hInAbs.y}px` }}
                          title="Потяните рычаг для изменения кривизны"
                        />
                      )}

                      {/* Handle Out point */}
                      {hOutAbs && (
                        <div
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDraggedHandle({
                              frameId: fr.id,
                              vIdx: vIdx,
                              type: 'out'
                            });
                          }}
                          className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#339EEE] border-2 border-white cursor-pointer hover:bg-[#FC018D] pointer-events-auto shadow-md"
                          style={{ left: `${hOutAbs.x}px`, top: `${hOutAbs.y}px` }}
                          title="Потяните рычаг для изменения кривизны"
                        />
                      )}
                    </div>
                  );
                });
              })}

            {/* Selected Frame Glow outline on sheet */}
            {activeTool === 'select' && selectedFrameIds.map((frameId) => {
              if (editingFrameId === frameId) return null;
              const activeFr = page.frames.find((f) => f.id === frameId);
              if (!activeFr) return null;
              const adjusted = getAdjustedVertices(activeFr, pw, ph, state.borderWidth, page.borderWidth);
              const pathD = getSvgPathFromVertices(adjusted);
              return (
                <svg key={frameId} className="absolute inset-0 w-full h-full pointer-events-none z-[75] overflow-visible">
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#FC018D"
                    strokeWidth="2.5"
                    strokeDasharray="4,4"
                    className="drop-shadow-[0_0_6px_rgba(252,1,141,0.5)]"
                  />
                </svg>
              );
            })}

            {/* Selected Frame Corner Handles for Scale Transformation */}
            {activeTool === 'select' && selectedFrameIds.map((frameId) => {
              if (editingFrameId === frameId) return null;
              const activeFr = page.frames.find((f) => f.id === frameId);
              if (!activeFr) return null;
              if (activeFr.locked) return null;
              const adjusted = getAdjustedVertices(activeFr, pw, ph, state.borderWidth, page.borderWidth);
              const box = getPolygonBounds(adjusted);

              const corners = [
                { id: 'tl', x: box.x, y: box.y, cursor: 'nwse-resize' },
                { id: 'tr', x: box.x + box.w, y: box.y, cursor: 'nesw-resize' },
                { id: 'bl', x: box.x, y: box.y + box.h, cursor: 'nesw-resize' },
                { id: 'br', x: box.x + box.w, y: box.y + box.h, cursor: 'nwse-resize' },
              ];

              return (
                <React.Fragment key={`frame-resize-${frameId}`}>
                  {corners.map((corner) => (
                    <div
                      key={corner.id}
                      onMouseDown={(e) => handleFrameResizeHandleMouseDown(e, activeFr, corner.id as any)}
                      className="absolute w-3 h-3 bg-[#141210] border-2 border-dashed border-[#FC018D] rounded-full z-[98] hover:bg-[#FC018D] pointer-events-auto shadow-md"
                      style={{
                        left: `${corner.x}px`,
                        top: `${corner.y}px`,
                        transform: 'translate(-50%, -50%)',
                        cursor: corner.cursor,
                      }}
                      title="Тяните для масштабирования фигуры"
                    />
                  ))}
                </React.Fragment>
              );
            })}

            {/* Lasso / Selection Marquee Indicator */}
            {isSelectingVertices && selectStart && selectEnd && (
              <div
                className="absolute border-2 border-dashed border-[#FC018D] bg-[#FC018D]/10 pointer-events-none shadow-[0_0_8px_rgba(252,1,141,0.2)]"
                style={{
                  left: `${Math.min(selectStart.x, selectEnd.x)}px`,
                  top: `${Math.min(selectStart.y, selectEnd.y)}px`,
                  width: `${Math.abs(selectEnd.x - selectStart.x)}px`,
                  height: `${Math.abs(selectEnd.y - selectStart.y)}px`,
                }}
              />
            )}

            {/* 2. Knife slicer candidate line preview rendering */}
            {(activeTool === 'knife' || activeTool === 'vertex') && isDrawingKnife && knifeStart && knifeEnd && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <line
                  x1={knifeStart.x}
                  y1={knifeStart.y}
                  x2={knifeEnd.x}
                  y2={knifeEnd.y}
                  stroke="#FF9F1C"
                  strokeWidth="3.5"
                  strokeDasharray="6,4"
                  className="drop-shadow-[0_0_6px_rgba(255,159,28,0.8)]"
                />
                <circle cx={knifeStart.x} cy={knifeStart.y} r="5" fill="#FF9F1C" />
                <circle cx={knifeEnd.x} cy={knifeEnd.y} r="5" fill="#FF9F1C" />
              </svg>
            )}

            {/* 3. Rect Frame Candidate preview outline drawing feedback */}
            {activeTool === 'add-rect' && isDrawingRect && rectStart && rectEnd && (
              <div
                className="absolute border-3 border-[#2EC4B6]/90 border-dashed bg-[#2EC4B6]/15 pointer-events-none shadow-lg"
                style={{
                  left: `${Math.min(rectStart.x, rectEnd.x)}px`,
                  top: `${Math.min(rectStart.y, rectEnd.y)}px`,
                  width: `${Math.abs(rectEnd.x - rectStart.x)}px`,
                  height: `${Math.abs(rectEnd.y - rectStart.y)}px`,
                }}
              />
            )}

            {/* 4. Polygon Candidate outline preview drawing feedback */}
            {activeTool === 'add-poly' && polyPoints.length > 0 && (() => {
              const pathParts: string[] = [];
              polyPoints.forEach((p, idx) => {
                if (idx === 0) {
                  pathParts.push(`M ${p.x} ${p.y}`);
                } else {
                  const prev = polyPoints[idx - 1];
                  const hasHandles = prev.isCurve && (prev.handleOut || p.handleIn);
                  if (hasHandles) {
                    const cp1x = prev.x + (prev.handleOut?.x || 0);
                    const cp1y = prev.y + (prev.handleOut?.y || 0);
                    const cp2x = p.x + (p.handleIn?.x || 0);
                    const cp2y = p.y + (p.handleIn?.y || 0);
                    pathParts.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p.x} ${p.y}`);
                  } else {
                    pathParts.push(`L ${p.x} ${p.y}`);
                  }
                }
              });
              const pathD = pathParts.join(' ');

              return (
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#9B5DE5"
                    strokeWidth="3"
                    className="drop-shadow-[0_0_6px_rgba(155,93,229,0.7)]"
                  />
                  {polyPoints.map((p, idx) => (
                    <circle
                      key={`poly-v-${idx}`}
                      cx={p.x}
                      cy={p.y}
                      r={idx === 0 ? '7.5' : '5'}
                      fill={idx === 0 ? '#FC018D' : '#9B5DE5'}
                      className={
                        idx === 0
                          ? 'animate-pulse cursor-pointer pointer-events-auto stroke-white stroke-2'
                          : ''
                      }
                      title={idx === 0 ? 'Кликните на первый узел для зацикливания и создания кадра' : ''}
                      onClick={(e) => {
                        if (idx === 0 && polyPoints.length >= 3) {
                          e.stopPropagation();
                          handleClosePoly();
                        }
                      }}
                    />
                  ))}
                {currentMouse && (
                  <line
                    x1={polyPoints[polyPoints.length - 1].x}
                    y1={polyPoints[polyPoints.length - 1].y}
                    x2={currentMouse.x}
                    y2={currentMouse.y}
                    stroke="#9B5DE5"
                    strokeWidth="2"
                    strokeDasharray="3,3"
                  />
                )}
              </svg>
            );})()}

            {/* 5. Live Brush stroke preview rendering */}
            {activeTool === 'brush' && isDrawingBrush && brushPoints.length > 0 && (() => {
              const d = brushPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              return (
                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-[98]">
                  <path
                    d={d}
                    fill={brushFillEnabled ? brushFillColor : 'none'}
                    stroke={brushColor}
                    strokeWidth={brushSize}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.8}
                  />
                </svg>
              );
            })()}

            {/* Lazy mouse guiding leash */}
            {activeTool === 'brush' && isDrawingBrush && brushStabilizer === 'lazy' && rawCursorPos && lazyAnchor && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-[99]">
                <line
                  x1={rawCursorPos.x}
                  y1={rawCursorPos.y}
                  x2={lazyAnchor.x}
                  y2={lazyAnchor.y}
                  stroke="#FC018D"
                  strokeWidth="1.2"
                  strokeDasharray="3,3"
                />
                <circle
                  cx={lazyAnchor.x}
                  cy={lazyAnchor.y}
                  r={lazyRadius}
                  fill="none"
                  stroke="#FC018D"
                  strokeWidth="1"
                  opacity={0.4}
                />
                <circle
                  cx={rawCursorPos.x}
                  cy={rawCursorPos.y}
                  r="3.5"
                  fill="#FC018D"
                />
                <circle
                  cx={lazyAnchor.x}
                  cy={lazyAnchor.y}
                  r="3.5"
                  fill={brushColor}
                  stroke="#FFF"
                  strokeWidth="1"
                />
              </svg>
            )}

            {/* 6. Eraser Brush Size cursor hover preview */}
            {activeTool === 'eraser' && eraserCursorPos && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-[99]">
                <circle
                  cx={eraserCursorPos.x}
                  cy={eraserCursorPos.y}
                  r={eraserSize}
                  fill="none"
                  stroke="#FC018D"
                  strokeWidth="1.5"
                  strokeDasharray="3,3"
                  className="drop-shadow-[0_0_3px_#FC018D]"
                />
                <circle
                  cx={eraserCursorPos.x}
                  cy={eraserCursorPos.y}
                  r="3.5"
                  fill="#FC018D"
                />
              </svg>
            )}

            {/* Sheet Resize Handles - Only visible and active when activeTool is 'select' */}
            {activeTool === 'select' && (
              <>
                {/* Right Edge Handle */}
                <div
                  onMouseDown={(e) => handleSheetResizeMouseDown(e, 'r')}
                  className="absolute right-[-6px] top-0 bottom-0 w-3 hover:bg-[#FC018D]/60 cursor-ew-resize z-[95] bg-[#3A3228]/40 transition-colors pointer-events-auto"
                  title="Потяните для изменения ширины холста"
                />
                {/* Bottom Edge Handle */}
                <div
                  onMouseDown={(e) => handleSheetResizeMouseDown(e, 'b')}
                  className="absolute bottom-[-6px] left-0 right-0 h-3 hover:bg-[#FC018D]/60 cursor-ns-resize z-[95] bg-[#3A3228]/40 transition-colors pointer-events-auto"
                  title="Потяните для изменения высоты холста"
                />
                {/* Bottom Right Corner Resize Handle */}
                <div
                  onMouseDown={(e) => handleSheetResizeMouseDown(e, 'br')}
                  className="absolute right-[-8px] bottom-[-8px] w-5 h-5 bg-[#FC018D] border-2 border-white rounded-full hover:scale-120 cursor-se-resize z-[99] shadow-lg transition-transform pointer-events-auto active:scale-95 flex items-center justify-center"
                  title="Потяните для масштабирования холста"
                >
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
