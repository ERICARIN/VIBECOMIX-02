/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { AppState, Page, Frame, Layer } from './types';
import { DialogOverlay } from './components/DialogOverlay';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { SettingsPanel } from './components/SettingsPanel';
import { PreviewOverlay } from './components/PreviewOverlay';
import { ExportPanel } from './components/ExportPanel';
import { getInitialPages, createFrame, createLayer } from './utils/presets';
import { getPolygonBounds } from './utils/geometry';
import { Undo, Redo, Eye, Download, Sparkles, SlidersHorizontal, BookOpen, Plus, Settings, FileText, Layers } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'vibeco_app_state_v1';

const NeobrutalistTooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  return (
    <div className="relative group flex items-center">
      {children}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 hidden group-hover:block bg-[#141210] border-2 border-[#FC018D] text-white text-[8px] font-mono py-1 px-2.5 rounded shadow-[4px_4px_0_0_#FC018D] whitespace-nowrap z-50 pointer-events-none uppercase font-bold tracking-wider">
        {text}
      </div>
    </div>
  );
};

export default function App() {
  // Global application variables
  const [state, setState] = useState<AppState | null>(null);

  // Active Tool state lifted from Workspace
  const [activeTool, setActiveTool] = useState<'select' | 'vertex' | 'knife' | 'add-rect' | 'add-poly' | 'pressure' | 'brush' | 'eraser'>('select');
  const [knifeGutter, setKnifeGutter] = useState<number>(12);
  const [layersPanelWidth, setLayersPanelWidth] = useState<number>(320);

  // Brush / Eraser tool config
  const [brushColor, setBrushColor] = useState<string>('#39E361');
  const [brushFillColor, setBrushFillColor] = useState<string>('rgba(57, 227, 97, 0.25)');
  const [brushSize, setBrushSize] = useState<number>(4);
  const [brushSmoothing, setBrushSmoothing] = useState<number>(0.2);
  const [brushFillEnabled, setBrushFillEnabled] = useState<boolean>(false);
  const [eraserSize, setEraserSize] = useState<number>(20);

  // Onion skinning & brush stabilizer config (Professional Features)
  const [onionEnabled, setOnionEnabled] = useState<boolean>(true);
  const [onionPrevCount, setOnionPrevCount] = useState<number>(1);
  const [onionNextCount, setOnionNextCount] = useState<number>(1);
  const [brushStabilizer, setBrushStabilizer] = useState<'smooth' | 'lazy'>('smooth');
  const [lazyRadius, setLazyRadius] = useState<number>(20);

  // Undo/Redo historical stack
  const [history, setHistory] = useState<Page[][]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  // Active user selections
  const [selectedLayerId, setSelectedLayerId] = useState<number | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<number[]>([]);
  const [activeLayers, setActiveLayers] = useState<number | null>(null); // frame ID currently inspected
  const [selectedFrameIds, setSelectedFrameIds] = useState<number[]>([]);
  const [selVertices, setSelVertices] = useState<{ frameId: number; vIdx: number }[]>([]);
  const [editingFrameId, setEditingFrameId] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [showExport, setShowExport] = useState<boolean>(false);
  const [showDialog, setShowDialog] = useState<boolean>(false);

  // Check LocalStorage on initial mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AppState;
        if (parsed.pages && parsed.pages.length > 0) {
          setState(parsed);
          // Seed initial history
          setHistory([JSON.parse(JSON.stringify(parsed.pages))]);
          setHistoryIdx(0);
          return;
        }
      }
    } catch (e) {
      console.warn('Could not read from local storage', e);
    }
    // If no storage, show setup dialog immediately
    setShowDialog(true);
  }, []);

  // Update localStorage whenever state is customized
  useEffect(() => {
    if (state) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.warn('Could not write state to local storage', e);
      }
    }
  }, [state]);

  // Handle auto-closing and clearing layers panel when leaving 'select' mode
  useEffect(() => {
    if (activeTool !== 'select') {
      setSelectedLayerId(null);
      setActiveLayers(null);
    }
  }, [activeTool]);

  // Deep snapshot history helper
  const handleSnapshot = (customPages?: Page[]) => {
    if (!state) return;
    const targetPages = customPages || state.pages;
    const pagesCopy = JSON.parse(JSON.stringify(targetPages)) as Page[];
    
    const nextHist = history.slice(0, historyIdx + 1);
    nextHist.push(pagesCopy);
    if (nextHist.length > 30) {
      nextHist.shift();
    }
    setHistory(nextHist);
    setHistoryIdx(nextHist.length - 1);
  };

  const handleUndo = () => {
    if (historyIdx <= 0 || !state) return;
    const prevIdx = historyIdx - 1;
    const prevPages = JSON.parse(JSON.stringify(history[prevIdx])) as Page[];
    setHistoryIdx(prevIdx);
    setState({
      ...state,
      pages: prevPages,
    });
    // Reset transient panels
    setSelectedLayerId(null);
    setActiveLayers(null);
  };

  const handleRedo = () => {
    if (historyIdx >= history.length - 1 || !state) return;
    const nextIdx = historyIdx + 1;
    const nextPages = JSON.parse(JSON.stringify(history[nextIdx])) as Page[];
    setHistoryIdx(nextIdx);
    setState({
      ...state,
      pages: nextPages,
    });
    setSelectedLayerId(null);
    setActiveLayers(null);
  };

  // Setup global shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        (activeEl as any).isContentEditable
      );
      if (isInput) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        if (e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        } else if (e.code === 'KeyY') {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (selectedFrameIds.length === 1) {
          const fid = selectedFrameIds[0];
          setEditingFrameId((prev) => (prev === fid ? null : fid));
        } else if (editingFrameId) {
          setEditingFrameId(null);
        }
        return;
      }

      // Instant layer or frame deletion on keypress - totally silent and responsive
      const isDeleteKey =
        e.key === 'Delete' ||
        e.key === 'Backspace' ||
        e.key === 'x' ||
        e.key === 'X' ||
        e.key === 'х' ||
        e.key === 'Х';

      if (isDeleteKey) {
        if (activeTool === 'vertex' && selVertices.length > 0) {
          e.preventDefault();
          // Group selected vertices by frameId
          const svByFrame: Record<number, number[]> = {};
          selVertices.forEach((sv) => {
            if (!svByFrame[sv.frameId]) {
              svByFrame[sv.frameId] = [];
            }
            svByFrame[sv.frameId].push(sv.vIdx);
          });

          const nextPages = [...state.pages];
          const pageToEdit = { ...nextPages[state.currentPage] };
          let hasAnyChanges = false;

          pageToEdit.frames = pageToEdit.frames.map((fr) => {
            const vIndices = svByFrame[fr.id];
            if (!vIndices || vIndices.length === 0) return fr;

            const oldVertices = fr.vertices ? [...fr.vertices] : [
              { x: fr.x, y: fr.y },
              { x: fr.x + fr.w, y: fr.y },
              { x: fr.x + fr.w, y: fr.y + fr.h },
              { x: fr.x, y: fr.y + fr.h },
            ];

            // Exclude indices to delete
            const nextVertices = oldVertices.filter((_, idx) => !vIndices.includes(idx));

            // Guard: must keep at least 3 vertices for closed shapes
            if (nextVertices.length < 3) return fr;

            const bounds = getPolygonBounds(nextVertices);
            hasAnyChanges = true;
            return {
              ...fr,
              vertices: nextVertices,
              ...bounds,
            };
          });

          if (hasAnyChanges) {
            nextPages[state.currentPage] = pageToEdit;
            setState({
              ...state,
              pages: nextPages,
            });
            handleSnapshot(nextPages);
            setSelVertices([]);
          }
          return;
        }

        if (selectedLayerIds.length > 0) {
          e.preventDefault();
          const nextPages = [...state.pages];
          const pageToEdit = nextPages[state.currentPage];
          pageToEdit.frames = pageToEdit.frames.map((fr) => {
            return {
              ...fr,
              layers: fr.layers.filter((l) => !selectedLayerIds.includes(l.id))
            };
          });
          setState({
            ...state,
            pages: nextPages,
          });
          handleSnapshot(nextPages);
          setSelectedLayerIds([]);
          setSelectedLayerId(null);
        } else if (selectedFrameIds.length > 0) {
          e.preventDefault();
          const pageToEdit = state.pages[state.currentPage];
          if (pageToEdit.frames.length > selectedFrameIds.length) {
            const nextFrames = pageToEdit.frames.filter((fr) => !selectedFrameIds.includes(fr.id));
            const updatedPages = state.pages.map((pg, i) =>
              i === state.currentPage ? { ...pg, frames: nextFrames } : pg
            );
            setState({
              ...state,
              pages: updatedPages,
            });
            handleSnapshot(updatedPages);
            setSelectedFrameIds([]);
            setActiveLayers(null);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIdx, history, state, selectedLayerId, selectedLayerIds, activeLayers, selectedFrameIds, activeTool, selVertices, setSelVertices, editingFrameId]);

  // Project initialization
  const handleStartProject = (config: {
    width: number;
    height: number;
    borderWidth: number;
    borderColor: string;
    strokeWidth: number;
    strokeColor: string;
    pageBg: string;
    pagesCount: number;
  }) => {
    // Generate beautiful initial Pages styled dynamically
    const initialPages = getInitialPages(config.width, config.height);

    // If starting pagesCount > 2, add simpler default pages
    while (initialPages.length < config.pagesCount) {
      initialPages.push({
        frames: [createFrame(0, 0, config.width, config.height)],
        w: config.width,
        h: config.height,
      });
    }
    // Truncate if user requested less
    if (initialPages.length > config.pagesCount) {
      initialPages.splice(config.pagesCount);
    }

    const appState: AppState = {
      width: config.width,
      height: config.height,
      borderWidth: config.borderWidth,
      borderColor: config.borderColor,
      strokeWidth: config.strokeWidth,
      strokeColor: config.strokeColor,
      pageBg: config.pageBg,
      pages: initialPages,
      currentPage: 0,
    };

    setState(appState);
    setHistory([JSON.parse(JSON.stringify(initialPages))]);
    setHistoryIdx(0);
    setSelectedLayerId(null);
    setActiveLayers(null);
    setShowDialog(false);
  };

  if (!state) {
    return (
      <div className="h-screen bg-[#0d0d0d] flex items-center justify-center">
        {showDialog && <DialogOverlay onStart={handleStartProject} />}
      </div>
    );
  }

  const activePage = state.pages[state.currentPage];
  const pw = activePage.w || state.width;
  const ph = activePage.h || state.height;

  // Global Page, border and stroke override adjusters inside topbar
  const handleGlobalLayoutSubmit = (overrideAll: boolean = false) => {
    const wInp = document.getElementById('tb-w') as HTMLInputElement | null;
    const hInp = document.getElementById('tb-h') as HTMLInputElement | null;
    const bwInp = document.getElementById('tb-border-w') as HTMLInputElement | null;
    const bcInp = document.getElementById('tb-border-c') as HTMLInputElement | null;
    const swInp = document.getElementById('tb-stroke-w') as HTMLInputElement | null;
    const scInp = document.getElementById('tb-stroke-c') as HTMLInputElement | null;

    const nw = wInp ? Math.max(100, parseInt(wInp.value) || state.width) : state.width;
    const nh = hInp ? Math.max(100, parseInt(hInp.value) || state.height) : state.height;
    const nbw = bwInp ? Math.max(0, parseInt(bwInp.value) || 0) : state.borderWidth;
    const nbc = bcInp ? bcInp.value : state.borderColor;
    const nsw = swInp ? Math.max(0, parseInt(swInp.value) || 0) : state.strokeWidth;
    const nsc = scInp ? scInp.value : state.strokeColor;

    if (overrideAll) {
      const nextPages = state.pages.map((pg) => {
        const ow = pg.w || state.width;
        const oh = pg.h || state.height;
        const sx = nw / ow;
        const sy = nh / oh;

        const nextFrames = pg.frames.map((fr) => ({
          ...fr,
          x: Math.round(fr.x * sx),
          y: Math.round(fr.y * sy),
          w: Math.round(fr.w * sx),
          h: Math.round(fr.h * sy),
          vertices: fr.vertices ? fr.vertices.map((v) => ({
            ...v,
            x: Math.round(v.x * sx),
            y: Math.round(v.y * sy),
            handleIn: v.handleIn ? {
              x: v.handleIn.x * sx,
              y: v.handleIn.y * sy,
            } : undefined,
            handleOut: v.handleOut ? {
              x: v.handleOut.x * sx,
              y: v.handleOut.y * sy,
            } : undefined,
          })) : undefined,
        }));

        return {
          ...pg,
          w: nw,
          h: nh,
          borderWidth: nbw,
          borderColor: nbc,
          strokeWidth: nsw,
          strokeColor: nsc,
          frames: nextFrames,
        };
      });

      setState({
        ...state,
        width: nw,
        height: nh,
        borderWidth: nbw,
        borderColor: nbc,
        strokeWidth: nsw,
        strokeColor: nsc,
        pages: nextPages,
      });
      handleSnapshot(nextPages);
    } else {
      const ow = activePage.w || state.width;
      const oh = activePage.h || state.height;
      const sx = nw / ow;
      const sy = nh / oh;

      const nextFrames = activePage.frames.map((fr) => ({
        ...fr,
        x: Math.round(fr.x * sx),
        y: Math.round(fr.y * sy),
        w: Math.round(fr.w * sx),
        h: Math.round(fr.h * sy),
        vertices: fr.vertices ? fr.vertices.map((v) => ({
          ...v,
          x: Math.round(v.x * sx),
          y: Math.round(v.y * sy),
          handleIn: v.handleIn ? {
            x: v.handleIn.x * sx,
            y: v.handleIn.y * sy,
          } : undefined,
          handleOut: v.handleOut ? {
            x: v.handleOut.x * sx,
            y: v.handleOut.y * sy,
          } : undefined,
        })) : undefined,
      }));

      const nextPages = [...state.pages];
      nextPages[state.currentPage] = {
        ...activePage,
        w: nw,
        h: nh,
        borderWidth: nbw,
        borderColor: nbc,
        strokeWidth: nsw,
        strokeColor: nsc,
        frames: nextFrames,
      };

      setState({
        ...state,
        pages: nextPages,
      });
      handleSnapshot(nextPages);
    }
  };

  // State modification delegates
  const handleSelectPage = (idx: number) => {
    setState({
      ...state,
      currentPage: idx,
    });
    setSelectedLayerId(null);
    setActiveLayers(null);
  };

  const handleAddPage = (customPage?: Page) => {
    const freshPage: Page = customPage || {
      frames: [createFrame(0, 0, state.width, state.height)],
      w: state.width,
      h: state.height,
    };
    const nextPages = [...state.pages, freshPage];
    setState({
      ...state,
      pages: nextPages,
      currentPage: nextPages.length - 1,
    });
    setSelectedLayerId(null);
    setActiveLayers(null);
    handleSnapshot(nextPages);
  };

  const handleDeletePage = (idx: number) => {
    if (state.pages.length <= 1) return;
    const nextPages = state.pages.filter((_, i) => i !== idx);
    const nextActive = Math.min(state.currentPage, nextPages.length - 1);
    setState({
      ...state,
      pages: nextPages,
      currentPage: nextActive,
    });
    setSelectedLayerId(null);
    setActiveLayers(null);
    handleSnapshot(nextPages);
  };

  const handleReorderPages = (fromIdx: number, toIdx: number) => {
    const nextPages = [...state.pages];
    const [moved] = nextPages.splice(fromIdx, 1);
    nextPages.splice(toIdx, 0, moved);

    setState({
      ...state,
      pages: nextPages,
      currentPage: toIdx,
    });
    handleSnapshot(nextPages);
  };

  const handleUpdatePageState = (modifications: { w?: number; h?: number; frames?: Frame[] }) => {
    const nextPages = [...state.pages];
    const prevPage = nextPages[state.currentPage];
    
    let nextFrames = modifications.frames || prevPage.frames;
    if ((modifications.w !== undefined && modifications.w !== prevPage.w) || 
        (modifications.h !== undefined && modifications.h !== prevPage.h)) {
      const ow = prevPage.w || state.width;
      const oh = prevPage.h || state.height;
      const nw = modifications.w !== undefined ? modifications.w : ow;
      const nh = modifications.h !== undefined ? modifications.h : oh;
      const sx = nw / ow;
      const sy = nh / oh;
      
      nextFrames = nextFrames.map((fr) => ({
        ...fr,
        x: Math.round(fr.x * sx),
        y: Math.round(fr.y * sy),
        w: Math.round(fr.w * sx),
        h: Math.round(fr.h * sy),
        vertices: fr.vertices ? fr.vertices.map((v) => ({
          ...v,
          x: Math.round(v.x * sx),
          y: Math.round(v.y * sy),
          handleIn: v.handleIn ? {
            x: v.handleIn.x * sx,
            y: v.handleIn.y * sy,
          } : undefined,
          handleOut: v.handleOut ? {
            x: v.handleOut.x * sx,
            y: v.handleOut.y * sy,
          } : undefined,
        })) : undefined,
      }));
    }

    nextPages[state.currentPage] = {
      ...prevPage,
      ...modifications,
      frames: nextFrames,
    };
    setState({
      ...state,
      pages: nextPages,
    });
  };

  const handleModifyFrame = (frameId: number, modifications: Partial<Frame>) => {
    const nextPages = [...state.pages];
    const pageToEdit = { ...nextPages[state.currentPage] };
    pageToEdit.frames = pageToEdit.frames.map((fr) => {
      if (fr.id === frameId) {
        return { ...fr, ...modifications };
      }
      return fr;
    });
    nextPages[state.currentPage] = pageToEdit;
    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const handleModifyFrames = (updates: { id: number; modifications: Partial<Frame> }[]) => {
    if (updates.length === 0) return;
    const nextPages = [...state.pages];
    const pageToEdit = { ...nextPages[state.currentPage] };
    const updateMap = new Map(updates.map(u => [u.id, u.modifications]));
    pageToEdit.frames = pageToEdit.frames.map((fr) => {
      if (updateMap.has(fr.id)) {
        return { ...fr, ...updateMap.get(fr.id)! };
      }
      return fr;
    });
    nextPages[state.currentPage] = pageToEdit;
    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const handleModifyLayer = (layerId: number, modifications: Partial<Layer>) => {
    const nextPages = [...state.pages];
    const pageToEdit = { ...nextPages[state.currentPage] };
    pageToEdit.frames = pageToEdit.frames.map((fr) => {
      const layerExists = fr.layers.some((l) => l.id === layerId);
      if (layerExists) {
        const nextLayers = fr.layers.map((l) => {
          if (l.id === layerId) {
            return { ...l, ...modifications };
          }
          return l;
        });
        return { ...fr, layers: nextLayers };
      }
      return fr;
    });
    nextPages[state.currentPage] = pageToEdit;
    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const handleSplitFrame = (frameId: number, direction: 'h' | 'v') => {
    const nextPages = [...state.pages];
    const pageToEdit = nextPages[state.currentPage];
    const targetIdx = pageToEdit.frames.findIndex((f) => f.id === frameId);
    if (targetIdx === -1) return;

    const fr = pageToEdit.frames[targetIdx];
    const halfB = state.borderWidth / 2;

    if (direction === 'h') {
      const halfH = Math.floor(fr.h / 2);
      const splitA = {
        ...fr,
        h: halfH,
        borderWidths: {
          top: fr.borderWidths.top ?? state.borderWidth,
          bottom: halfB,
          left: fr.borderWidths.left ?? state.borderWidth,
          right: fr.borderWidths.right ?? state.borderWidth,
        },
      };

      const splitB = createFrame(fr.x, fr.y + halfH, fr.w, fr.h - halfH);
      splitB.borderWidths = {
        top: halfB,
        bottom: fr.borderWidths.bottom ?? state.borderWidth,
        left: fr.borderWidths.left ?? state.borderWidth,
        right: fr.borderWidths.right ?? state.borderWidth,
      };

      pageToEdit.frames.splice(targetIdx, 1, splitA, splitB);
    } else {
      const halfW = Math.floor(fr.w / 2);
      const splitA = {
        ...fr,
        w: halfW,
        borderWidths: {
          top: fr.borderWidths.top ?? state.borderWidth,
          bottom: fr.borderWidths.bottom ?? state.borderWidth,
          left: fr.borderWidths.left ?? state.borderWidth,
          right: halfB,
        },
      };

      const splitB = createFrame(fr.x + halfW, fr.y, fr.w - halfW, fr.h);
      splitB.borderWidths = {
        top: fr.borderWidths.top ?? state.borderWidth,
        bottom: fr.borderWidths.bottom ?? state.borderWidth,
        left: halfB,
        right: fr.borderWidths.right ?? state.borderWidth,
      };

      pageToEdit.frames.splice(targetIdx, 1, splitA, splitB);
    }

    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const handleDeleteFrame = (frameId: number) => {
    const pageToEdit = activePage;

    const nextFrames = pageToEdit.frames.filter((fr) => fr.id !== frameId);

    if (activeLayers === frameId) {
      setActiveLayers(null);
    }

    const updatedPages = state.pages.map((pg, i) =>
      i === state.currentPage ? { ...pg, frames: nextFrames } : pg
    );

    setState({
      ...state,
      pages: updatedPages,
    });
    handleSnapshot(updatedPages);
  };

  const handleAddLayer = (src: string, name: string) => {
    if (activeLayers === null) return;
    handleAddLayerToFrame(activeLayers, src, name);
  };

  const handleAddLayerToFrame = (frameId: number, src: string, name: string) => {
    const nextPages = [...state.pages];
    const pageToEdit = nextPages[state.currentPage];

    pageToEdit.frames = pageToEdit.frames.map((fr) => {
      if (fr.id === frameId) {
        const nextL = createLayer(src, name);
        setSelectedLayerId(nextL.id);
        return {
          ...fr,
          layers: [...fr.layers, nextL],
        };
      }
      return fr;
    });

    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const handleDeleteLayer = (layerId: number) => {
    const nextPages = [...state.pages];
    const pageToEdit = nextPages[state.currentPage];

    pageToEdit.frames = pageToEdit.frames.map((fr) => {
      const hasL = fr.layers.some((l) => l.id === layerId);
      if (hasL) {
        if (selectedLayerId === layerId) setSelectedLayerId(null);
        return {
          ...fr,
          layers: fr.layers.filter((l) => l.id !== layerId),
        };
      }
      return fr;
    });

    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const handleReorderLayers = (fromIdx: number, toIdx: number) => {
    if (activeLayers === null) return;
    const nextPages = [...state.pages];
    const pageToEdit = nextPages[state.currentPage];

    pageToEdit.frames = pageToEdit.frames.map((fr) => {
      if (fr.id === activeLayers) {
        const nextLayers = [...fr.layers];
        const [moved] = nextLayers.splice(fromIdx, 1);
        nextLayers.splice(toIdx, 0, moved);
        return { ...fr, layers: nextLayers };
      }
      return fr;
    });

    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const handleReorderFrames = (fromIdx: number, toIdx: number) => {
    if (!state) return;
    const nextPages = [...state.pages];
    const pageToEdit = nextPages[state.currentPage];
    const nextFrames = [...pageToEdit.frames];
    const [moved] = nextFrames.splice(fromIdx, 1);
    nextFrames.splice(toIdx, 0, moved);
    pageToEdit.frames = nextFrames;
    setState({
      ...state,
      pages: nextPages,
    });
    handleSnapshot(nextPages);
  };

  const activeInspectedFrame = activePage.frames.find((f) => f.id === activeLayers);

  const handleWheelStep = (e: React.WheelEvent<HTMLInputElement>, step: number = 1, min?: number, max?: number) => {
    e.preventDefault();
    const isDown = e.deltaY > 0;
    const val = parseFloat(e.currentTarget.value) || 0;
    let newVal = val + (isDown ? -step : step);
    if (min !== undefined) newVal = Math.max(min, newVal);
    if (max !== undefined) newVal = Math.min(max, newVal);
    
    e.currentTarget.value = String(newVal);
    const evt = new Event('input', { bubbles: true });
    e.currentTarget.dispatchEvent(evt);
  };

  return (
    <div className="h-screen bg-[#0D0D0D] text-[#F5F0E8] flex flex-col overflow-hidden select-none">
      {/* Dynamic top info & operational bar */}
      <header className="h-[52px] bg-[#141210] border-b-4 border-[#3A3228] flex items-center justify-between shrink-0 select-none px-4 z-50">
        {/* Left Side branding & settings */}
        <div className="flex items-center gap-2">
          <div className="font-['Unbounded'] font-extrabold text-[#FC018D] text-xs tracking-tighter uppercase mr-1">
            VIBE<span className="text-white">COMIX</span>
          </div>
          
          <div className="font-mono text-[9.5px] text-[#7A7470] flex items-center gap-1 mr-2">
            <span>стр.</span>
            <b className="text-[#F5F0E8]">{state.currentPage + 1}</b>
            <span>/</span>
            <span>{state.pages.length}</span>
          </div>

          {/* Dynamic page resolution and style overrides form */}
          <div className="hidden lg:flex items-center gap-2 border-l border-[#3A3228] pl-3.5 mx-1.5 h-full">
            {/* Page Size Fields */}
            <NeobrutalistTooltip text="Размер страницы (Ширина × Высота)">
              <div className="flex items-center gap-1 text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2 py-1 rounded border border-[#3A3228]">
                <span className="text-[9px] font-bold uppercase mr-1 text-[#FC018D]">sz</span>
                <input
                  id="tb-w"
                  type="number"
                  defaultValue={pw}
                  key={`tb-w-${pw}`}
                  onWheel={(e) => handleWheelStep(e, 50, 100, 4000)}
                  min="100"
                  max="4000"
                  className="w-11 bg-transparent text-white text-[10px] font-bold outline-none text-center focus:text-[#FC018D]"
                />
                <span className="text-[#3A3228]">×</span>
                <input
                  id="tb-h"
                  type="number"
                  defaultValue={ph}
                  key={`tb-h-${ph}`}
                  onWheel={(e) => handleWheelStep(e, 50, 100, 4000)}
                  min="100"
                  max="4000"
                  className="w-11 bg-transparent text-white text-[10px] font-bold outline-none text-center focus:text-[#FC018D]"
                />
              </div>
            </NeobrutalistTooltip>

            {/* Border Width Field */}
            <NeobrutalistTooltip text="Ширина внешней рамки листа px">
              <div className="flex items-center gap-1 text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2 py-1 rounded border border-[#3A3228]">
                <span className="text-[9px] font-bold uppercase text-[#339EEE]">rm</span>
                <input
                  id="tb-border-w"
                  type="number"
                  defaultValue={activePage.borderWidth !== undefined ? activePage.borderWidth : state.borderWidth}
                  key={`tb-border-w-${activePage.borderWidth !== undefined ? activePage.borderWidth : state.borderWidth}`}
                  onWheel={(e) => handleWheelStep(e, 2, 0, 100)}
                  min="0"
                  max="100"
                  className="w-7 bg-transparent text-white text-[10px] font-bold outline-none text-center focus:text-[#339EEE]"
                />
              </div>
            </NeobrutalistTooltip>

            {/* Border Color Field */}
            <NeobrutalistTooltip text="Цвет внешней рамки листа">
              <div className="flex items-center bg-[#1a1815] px-1 py-1 rounded border border-[#3A3228] h-[22px]">
                <input
                  id="tb-border-c"
                  type="color"
                  defaultValue={activePage.borderColor !== undefined ? activePage.borderColor : state.borderColor}
                  key={`tb-border-c-${activePage.borderColor !== undefined ? activePage.borderColor : state.borderColor}`}
                  className="w-5 h-full bg-transparent border-0 cursor-pointer outline-none"
                />
              </div>
            </NeobrutalistTooltip>

            {/* Stroke Width Field */}
            <NeobrutalistTooltip text="Толщина обводки фигур px">
              <div className="flex items-center gap-1 text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2 py-1 rounded border border-[#3A3228]">
                <span className="text-[9px] font-bold uppercase text-[#FF9F1C]">ob</span>
                <input
                  id="tb-stroke-w"
                  type="number"
                  defaultValue={activePage.strokeWidth !== undefined ? activePage.strokeWidth : state.strokeWidth}
                  key={`tb-stroke-w-${activePage.strokeWidth !== undefined ? activePage.strokeWidth : state.strokeWidth}`}
                  onWheel={(e) => handleWheelStep(e, 1, 0, 30)}
                  min="0"
                  max="30"
                  className="w-7 bg-transparent text-white text-[10px] font-bold outline-none text-center focus:text-[#FF9F1C]"
                />
              </div>
            </NeobrutalistTooltip>

            {/* Stroke Color Field */}
            <NeobrutalistTooltip text="Цвет обводки фигур">
              <div className="flex items-center bg-[#1a1815] px-1 py-1 rounded border border-[#3A3228] h-[22px]">
                <input
                  id="tb-stroke-c"
                  type="color"
                  defaultValue={activePage.strokeColor !== undefined ? activePage.strokeColor : state.strokeColor}
                  key={`tb-stroke-c-${activePage.strokeColor !== undefined ? activePage.strokeColor : state.strokeColor}`}
                  className="w-5 h-full bg-transparent border-0 cursor-pointer outline-none"
                />
              </div>
            </NeobrutalistTooltip>

            {/* Action trigger: Page specific */}
            <NeobrutalistTooltip text="Применить настройки к ТЕКУЩЕЙ странице">
              <button
                onClick={() => handleGlobalLayoutSubmit(false)}
                className="p-1.5 bg-[#1a1815] border border-[#3A3228] hover:border-[#FC018D] text-[#7A7470] hover:text-[#FC018D] rounded cursor-pointer transition-colors duration-150"
              >
                <FileText size={11} />
              </button>
            </NeobrutalistTooltip>

            {/* Action trigger: All pages */}
            <NeobrutalistTooltip text="Применить настройки ко ВСЕМ страницам">
              <button
                onClick={() => handleGlobalLayoutSubmit(true)}
                className="p-1.5 bg-[#FC018D]/10 hover:bg-[#FC018D]/20 border border-[#FC018D]/30 hover:border-[#FC018D] text-[#FC018D] rounded cursor-pointer transition-colors duration-150"
              >
                <Layers size={11} />
              </button>
            </NeobrutalistTooltip>
          </div>

          {/* Active Tool Settings Form */}
          <div className="flex items-center gap-1.5 h-full pl-2 select-none">
            {activeTool === 'knife' && (
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2.5 py-1 rounded border border-[#FC018D]/45">
                <span className="text-[9px] font-extrabold uppercase text-[#FC018D]">Нож: перегородка</span>
                <input
                  type="number"
                  value={knifeGutter}
                  onChange={(e) => setKnifeGutter(Math.max(1, Math.min(100, parseInt(e.target.value) || 0)))}
                  onWheel={(e) => {
                    e.preventDefault();
                    const isDown = e.deltaY > 0;
                    setKnifeGutter(prev => Math.max(1, Math.min(100, prev + (isDown ? -2 : 2))));
                  }}
                  min="1"
                  max="100"
                  className="w-10 bg-transparent text-white text-[10px] font-bold outline-none text-center focus:text-[#FC018D]"
                />
                <span className="text-[#554c41] font-bold">px</span>
              </div>
            )}
            {activeTool === 'vertex' && (
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2.5 py-1 rounded border border-[#339EEE]/40">
                <span className="text-[#339EEE] font-bold">Узлы:</span>
                <span className="text-white ml-1">Края обводки:</span>
                <div className="flex bg-[#141210] p-0.5 border border-[#3A3228] rounded">
                  <button
                    onClick={() => {
                      setState(prev => prev ? { ...prev, strokeCaps: 'round' } : null);
                      handleSnapshot();
                    }}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-colors pointer-events-auto cursor-pointer ${
                      (state.strokeCaps || 'round') === 'round'
                        ? 'bg-[#FC018D] text-white shadow'
                        : 'text-[#7A7470] hover:text-white'
                    }`}
                  >
                    Круглые
                  </button>
                  <button
                    onClick={() => {
                      setState(prev => prev ? { ...prev, strokeCaps: 'flat' } : null);
                      handleSnapshot();
                    }}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-colors pointer-events-auto cursor-pointer ${
                      (state.strokeCaps || 'round') === 'flat'
                        ? 'bg-[#FC018D] text-white shadow'
                        : 'text-[#7A7470] hover:text-white'
                    }`}
                  >
                    Острые
                  </button>
                </div>
                <span className="mx-1 opacity-45">|</span>
                <span>dblclick по рамке добавит узел, на узле - удалит</span>
              </div>
            )}
            {activeTool === 'pressure' && (
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2.5 py-1 rounded border border-[#FF9F1C]/40">
                <span className="text-[#FF9F1C] font-bold">Рельеф:</span>
                <span className="text-white ml-1">Края обводки:</span>
                <div className="flex bg-[#141210] p-0.5 border border-[#3A3228] rounded">
                  <button
                    onClick={() => {
                      setState(prev => prev ? { ...prev, strokeCaps: 'round' } : null);
                      handleSnapshot();
                    }}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-colors pointer-events-auto cursor-pointer ${
                      (state.strokeCaps || 'round') === 'round'
                        ? 'bg-[#FC018D] text-white shadow'
                        : 'text-[#7A7470] hover:text-white'
                    }`}
                  >
                    Круглые
                  </button>
                  <button
                    onClick={() => {
                      setState(prev => prev ? { ...prev, strokeCaps: 'flat' } : null);
                      handleSnapshot();
                    }}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase transition-colors pointer-events-auto cursor-pointer ${
                      (state.strokeCaps || 'round') === 'flat'
                        ? 'bg-[#FC018D] text-white shadow'
                        : 'text-[#7A7470] hover:text-white'
                    }`}
                  >
                    Острые
                  </button>
                </div>
                <span className="mx-1 opacity-45">|</span>
                <span>тяните по горизонтали или крутите колесо мыши</span>
              </div>
            )}
            {activeTool === 'add-poly' && (
              <div className="text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2.5 py-1 rounded border border-[#FC018D]/40">
                <span className="text-[#FC018D] font-bold">Полигон:</span> кликайте точки на холсте, dblclick - завершить
              </div>
            )}
            {activeTool === 'add-rect' && (
              <div className="text-[9px] font-mono text-[#7A7470] bg-[#1a1815] px-2.5 py-1 rounded border border-[#FC018D]/40">
                <span className="text-[#FC018D] font-bold">Рамка:</span> растяните прямоугольник мышкой на холсте
              </div>
            )}
          </div>
        </div>

        {/* Global Toolbar actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleUndo}
            disabled={historyIdx <= 0}
            className="p-1 px-2.5 hover:bg-neutral-800 border border-transparent rounded text-xs select-none hover:text-white disabled:opacity-35 transition cursor-pointer"
            title="Назад (Ctrl+Z)"
          >
            <Undo size={14} />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIdx >= history.length - 1}
            className="p-1 px-2.5 hover:bg-neutral-800 border border-transparent rounded text-xs select-none hover:text-white disabled:opacity-35 transition cursor-pointer"
            title="Вперед (Ctrl+Y/Ctrl+Shift+Z)"
          >
            <Redo size={14} />
          </button>

          <button
            onClick={() => setShowDialog(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[#3A3228] hover:border-[#339EEE] text-[#7A7470] hover:text-[#339EEE] font-mono text-[9px] uppercase tracking-wider rounded select-none cursor-pointer transition-colors duration-150"
            title="Создать полностью новый проект комикса"
          >
            <Settings size={10} />
            Новый
          </button>

          <button
            onClick={() => setShowExport(prev => !prev)}
            className={`p-2 border rounded shadow cursor-pointer select-none transition-all duration-150 flex items-center justify-center ${
              showExport 
                ? 'bg-transparent border-[#FC018D] hover:bg-[#FC018D]/15 text-[#FC018D]'
                : 'bg-[#FC018D]/10 border-[#FC018D]/30 hover:border-[#FC018D] text-[#FC018D]'
            }`}
            title="Панель настроек экспорта (Download)"
          >
            <Download size={13} />
          </button>

          <button
            onClick={() => setShowPreview(true)}
            className="p-2 bg-[#FC018D] border border-[#FC018D] hover:bg-[#ff2fa0] text-white rounded shadow cursor-pointer select-none flex items-center justify-center"
            title="Запустить презентационный просмотр (Превью)"
          >
            <Eye size={13} />
          </button>
        </div>
      </header>

      {/* Main split viewport workspace pane */}
      <div className="flex-1 flex overflow-hidden relative bg-[#0D0D0D]">
        {/* Pages left sidebar control panel */}
        <Sidebar
          state={state}
          onSelectPage={handleSelectPage}
          onAddPage={handleAddPage}
          onDeletePage={handleDeletePage}
          onReorderPages={handleReorderPages}
          onUpdatePages={(updatedPages) => {
            setState({ ...state, pages: updatedPages });
            handleSnapshot(updatedPages);
          }}
        />

        {/* Full vector canvas area & Right Docked LayerControls */}
        <div className="flex-1 relative flex overflow-hidden">
          <div className="flex-1 h-full relative flex overflow-hidden">
            <Workspace
              state={state}
              selectedLayerId={selectedLayerId}
              selectedLayerIds={selectedLayerIds}
              onSelectLayerIds={setSelectedLayerIds}
              activeLayers={activeLayers}
              selectedFrameIds={selectedFrameIds}
              onSelectFrameIds={setSelectedFrameIds}
              selVertices={selVertices}
              onSetSelVertices={setSelVertices}
              onSelectLayer={setSelectedLayerId}
              onToggleLayersPanel={setActiveLayers}
              onModifyFrame={handleModifyFrame}
              onModifyFrames={handleModifyFrames}
              onModifyLayer={handleModifyLayer}
              onSplitFrame={handleSplitFrame}
              onDeleteFrame={handleDeleteFrame}
              onUpdatePageState={handleUpdatePageState}
              onSnapshot={() => handleSnapshot()}
              onAddLayerTrigger={(fid) => {
                setActiveLayers(fid);
              }}
              onAddLayerToFrame={handleAddLayerToFrame}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              knifeGutter={knifeGutter}
              brushColor={brushColor}
              brushFillColor={brushFillColor}
              brushSize={brushSize}
              brushSmoothing={brushSmoothing}
              brushFillEnabled={brushFillEnabled}
              eraserSize={eraserSize}
              onionEnabled={onionEnabled}
              onionPrevCount={onionPrevCount}
              onionNextCount={onionNextCount}
              brushStabilizer={brushStabilizer}
              lazyRadius={lazyRadius}
              editingFrameId={editingFrameId}
              onSetEditingFrameId={setEditingFrameId}
            />
          </div>

          {/* Right docked resizable sidebar layer menu */}
          <div 
            style={{ width: `${layersPanelWidth}px` }}
            className="h-full relative shrink-0 flex flex-col bg-[#141210] border-l-2 border-[#3A3228] z-30"
          >
            {/* Vertical draggable resize gutter bar */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const startWidth = layersPanelWidth;
                const startX = e.clientX;

                const handleMouseMove = (mv: MouseEvent) => {
                  const delta = mv.clientX - startX;
                  const nextWidth = Math.max(240, Math.min(600, startWidth - delta));
                  setLayersPanelWidth(nextWidth);
                };

                const handleMouseUp = () => {
                  window.removeEventListener('mousemove', handleMouseMove);
                  window.removeEventListener('mouseup', handleMouseUp);
                };

                window.addEventListener('mousemove', handleMouseMove);
                window.addEventListener('mouseup', handleMouseUp);
              }}
              className="absolute left-[-4px] top-0 bottom-0 w-2 hover:bg-[#FC018D]/50 cursor-[#FC018D]/30 cursor-ew-resize z-50 transition-colors"
              title="Перетяните для регулировки размеров панели настроек"
            />

            <div className="flex-1 h-full flex flex-col overflow-hidden">
              {showExport ? (
                <ExportPanel
                  state={state}
                  activeLayers={activeLayers}
                  onClose={() => setShowExport(false)}
                />
              ) : (
                <SettingsPanel
                  state={state}
                  selectedLayerId={selectedLayerId}
                  selectedLayerIds={selectedLayerIds}
                  activeLayers={activeLayers}
                  selectedFrameIds={selectedFrameIds}
                  activeTool={activeTool}
                  selVertices={selVertices}
                  brushColor={brushColor}
                  setBrushColor={setBrushColor}
                  brushFillColor={brushFillColor}
                  setBrushFillColor={setBrushFillColor}
                  brushSize={brushSize}
                  setBrushSize={setBrushSize}
                  brushSmoothing={brushSmoothing}
                  setBrushSmoothing={setBrushSmoothing}
                  brushFillEnabled={brushFillEnabled}
                  setBrushFillEnabled={setBrushFillEnabled}
                  eraserSize={eraserSize}
                  setEraserSize={setEraserSize}
                  onionEnabled={onionEnabled}
                  setOnionEnabled={setOnionEnabled}
                  onionPrevCount={onionPrevCount}
                  setOnionPrevCount={setOnionPrevCount}
                  onionNextCount={onionNextCount}
                  setOnionNextCount={setOnionNextCount}
                  brushStabilizer={brushStabilizer}
                  setBrushStabilizer={setBrushStabilizer}
                  lazyRadius={lazyRadius}
                  setLazyRadius={setLazyRadius}
                  onSelectLayer={setSelectedLayerId}
                  onSelectLayerIds={setSelectedLayerIds}
                  onModifyLayer={handleModifyLayer}
                  onDeleteLayer={handleDeleteLayer}
                  onAddLayerToFrame={handleAddLayerToFrame}
                  onReorderLayers={handleReorderLayers}
                  onModifyFrame={handleModifyFrame}
                  onDeleteFrame={handleDeleteFrame}
                  onReorderFrames={handleReorderFrames}
                  onSelectFrame={setActiveLayers}
                  onSelectFrameIds={setSelectedFrameIds}
                  onUpdatePageState={handleUpdatePageState}
                  onUpdateGlobalConfig={(mods) => setState((prev) => (prev ? { ...prev, ...mods } : prev))}
                  onSnapshot={() => handleSnapshot()}
                  viewportEditFrameId={editingFrameId}
                  onSetViewportEditFrameId={setEditingFrameId}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-screen animated Preview parallax */}
      {showPreview && <PreviewOverlay state={state} onClose={() => setShowPreview(false)} />}

      {/* Modals project settings setups overlay */}
      {showDialog && (
        <DialogOverlay
          onStart={handleStartProject}
          onClose={() => setShowDialog(false)}
        />
      )}
    </div>
  );
}
