import React, { useRef, useState } from 'react';
import { Frame, Layer, AppState, Modifier } from '../types';
import {
  Trash2,
  Eye,
  EyeOff,
  RotateCcw,
  CornerDownRight,
  Plus,
  Upload,
  Sparkles,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Maximize,
  ArrowUp,
  ArrowDown,
  Settings,
  Scissors,
  Check,
  Maximize2,
  FileText,
  MousePointer,
  Sparkle,
  Lock,
  Unlock,
  Paintbrush,
  LayoutTemplate,
  Square,
  Copy
} from 'lucide-react';
import { SAMPLE_ASSETS, VECTOR_SHAPES } from '../utils/presets';
import { getPolygonBounds, getSvgPathFromVertices } from '../utils/geometry';

interface SettingsPanelProps {
  state: AppState;
  selectedLayerId: number | null;
  selectedLayerIds: number[];
  activeLayers: number | null; // active frame ID
  selectedFrameIds: number[];
  activeTool: 'select' | 'vertex' | 'knife' | 'add-rect' | 'add-poly' | 'pressure' | 'brush' | 'eraser';
  selVertices: { frameId: number; vIdx: number }[];
  
  brushColor?: string;
  setBrushColor?: (color: string) => void;
  brushFillColor?: string;
  setBrushFillColor?: (color: string) => void;
  brushSize?: number;
  setBrushSize?: (size: number) => void;
  brushSmoothing?: number;
  setBrushSmoothing?: (sm: number) => void;
  brushFillEnabled?: boolean;
  setBrushFillEnabled?: (enabled: boolean) => void;
  eraserSize?: number;
  setEraserSize?: (size: number) => void;

  // Onion skinning & brush stabilizer props
  onionEnabled?: boolean;
  setOnionEnabled?: (enabled: boolean) => void;
  onionPrevCount?: number;
  setOnionPrevCount?: (count: number) => void;
  onionNextCount?: number;
  setOnionNextCount?: (count: number) => void;
  brushStabilizer?: 'smooth' | 'lazy';
  setBrushStabilizer?: (st: 'smooth' | 'lazy') => void;
  lazyRadius?: number;
  setLazyRadius?: (rad: number) => void;

  onSelectLayer: (layerId: number | null) => void;
  onSelectLayerIds: (layerIds: number[]) => void;
  onModifyLayer: (layerId: number, modifications: Partial<Layer>) => void;
  onDeleteLayer: (layerId: number) => void;
  onAddLayerToFrame: (frameId: number, src: string, name: string) => void;
  onReorderLayers: (fromIdx: number, toIdx: number) => void;
  onModifyFrame: (frameId: number, modifications: Partial<Frame>) => void;
  onDeleteFrame: (frameId: number) => void;
  onReorderFrames: (fromIdx: number, toIdx: number) => void;
  onSelectFrame: (frameId: number | null) => void;
  onSelectFrameIds: (frameIds: number[]) => void;
  onUpdatePageState: (modifications: { w?: number; h?: number }) => void;
  onUpdateGlobalConfig: (modifications: Partial<AppState>) => void;
  onSnapshot: () => void;
  viewportEditFrameId?: number | null;
  onSetViewportEditFrameId?: (fid: number | null) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  state,
  selectedLayerId,
  selectedLayerIds,
  activeLayers,
  selectedFrameIds,
  activeTool,
  selVertices,
  brushColor = '#39E361',
  setBrushColor = (_c: string) => {},
  brushFillColor = 'rgba(57, 227, 97, 0.25)',
  setBrushFillColor = (_c: string) => {},
  brushSize = 4,
  setBrushSize = (_s: number) => {},
  brushSmoothing = 0.2,
  setBrushSmoothing = (_sm: number) => {},
  brushFillEnabled = false,
  setBrushFillEnabled = (_e: boolean) => {},
  eraserSize = 20,
  setEraserSize = (_s: number) => {},
  onionEnabled = true,
  setOnionEnabled = (_e: boolean) => {},
  onionPrevCount = 1,
  setOnionPrevCount = (_c: number) => {},
  onionNextCount = 1,
  setOnionNextCount = (_c: number) => {},
  brushStabilizer = 'smooth',
  setBrushStabilizer = (_st: 'smooth' | 'lazy') => {},
  lazyRadius = 20,
  setLazyRadius = (_r: number) => {},
  onSelectLayer,
  onSelectLayerIds,
  onModifyLayer,
  onDeleteLayer,
  onAddLayerToFrame,
  onReorderLayers,
  onModifyFrame,
  onDeleteFrame,
  onReorderFrames,
  onSelectFrame,
  onSelectFrameIds,
  onUpdatePageState,
  onUpdateGlobalConfig,
  onSnapshot,
  viewportEditFrameId = null,
  onSetViewportEditFrameId = (_fid: number | null) => {},
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activePage = state.pages[state.currentPage];
  const pw = activePage.w || state.width;
  const ph = activePage.h || state.height;

  // Local interaction states
  const [draggedLayerIdx, setDraggedLayerIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [draggedFrameIdx, setDraggedFrameIdx] = useState<number | null>(null);
  const [dragOverFrameIdx, setDragOverFrameIdx] = useState<number | null>(null);
  const [showPresetLibrary, setShowPresetLibrary] = useState(false);
  const [groupByPage, setGroupByPage] = useState(true);
  const [groupByFrame, setGroupByFrame] = useState(true);
  const [collapsedCatalogPaths, setCollapsedCatalogPaths] = useState<Record<string, boolean>>({});
  const [collapsedLayerFolders, setCollapsedLayerFolders] = useState<Record<string, boolean>>({});
  const [isLayersExpanded, setIsLayersExpanded] = useState(true);
  const [isFramesExpanded, setIsFramesExpanded] = useState(true);
  const [showVectorCatalog, setShowVectorCatalog] = useState(false);
  const [collapsedFrameFolders, setCollapsedFrameFolders] = useState<Record<string, boolean>>({});
  const [collapsedModFolders, setCollapsedModFolders] = useState<Record<string, boolean>>({});
  const [draggedModId, setDraggedModId] = useState<string | null>(null);
  const [dragAllowedId, setDragAllowedId] = useState<string | null>(null);

  // Frame and Frame Folder renaming states
  const [editingFrameId, setEditingFrameId] = useState<number | null>(null);
  const [editingFrameVal, setEditingFrameVal] = useState('');
  const [editingFrameFolder, setEditingFrameFolder] = useState<string | null>(null);
  const [editingFrameFolderVal, setEditingFrameFolderVal] = useState('');

  // Layer renaming states
  const [editingLayerId, setEditingLayerId] = useState<number | null>(null);
  const [editingLayerVal, setEditingLayerVal] = useState('');

  const handleRenameLayerCommit = (layerId: number) => {
    const trimmed = editingLayerVal.trim();
    if (trimmed) {
      onModifyLayer(layerId, { name: trimmed });
    }
    setEditingLayerId(null);
  };

  const handleRenameFrameCommit = (frameId: number) => {
    const trimmed = editingFrameVal.trim();
    if (trimmed) {
      onModifyFrame(frameId, { name: trimmed });
    }
    setEditingFrameId(null);
  };

  const handleRenameFrameFolderCommit = (oldName: string) => {
    const trimmed = editingFrameFolderVal.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingFrameFolder(null);
      return;
    }
    activePage.frames.forEach((fr) => {
      if (fr.folder === oldName) {
        onModifyFrame(fr.id, { folder: trimmed });
      }
    });
    setEditingFrameFolder(null);
  };

  const activeFrame = activePage.frames.find((f) => f.id === activeLayers);

  const handleAddVectorFrame = (shapeName: string, vertices: any[]) => {
    const newFrameId = Date.now();
    const newFrame: Frame = {
      id: newFrameId,
      x: 0,
      y: 0,
      w: pw,
      h: ph,
      vertices: vertices.map(v => ({
        x: Math.round(v.x),
        y: Math.round(v.y),
        handleIn: v.handleIn ? { x: Math.round(v.handleIn.x), y: Math.round(v.handleIn.y) } : undefined,
        handleOut: v.handleOut ? { x: Math.round(v.handleOut.x), y: Math.round(v.handleOut.y) } : undefined,
        isCurve: v.isCurve || false
      })),
      layers: [],
      borderWidths: { top: 6, bottom: 6, left: 6, right: 6 },
      strokeWidths: {},
      strokeColor: '#FC018D',
      strokeDasharray: 'none',
      strokeWidth: 4,
      name: shapeName
    };
    onUpdatePageState({
      frames: [...activePage.frames, newFrame]
    } as any);
    onSelectFrame(newFrameId);
    onSelectFrameIds([newFrameId]);
  };

  // Wheel step value modifier helper
  const handleWheelStep = (
    e: React.WheelEvent<HTMLInputElement>,
    onChange: (val: number) => void,
    step: number = 1,
    min?: number,
    max?: number
  ) => {
    e.preventDefault();
    const isDown = e.deltaY > 0;
    const val = parseFloat(e.currentTarget.value) || 0;
    let newVal = val + (isDown ? -step : step);
    if (min !== undefined) newVal = Math.max(min, newVal);
    if (max !== undefined) newVal = Math.min(max, newVal);
    onChange(newVal);
  };

  // Convert frame coordinate polygon to centered mini path
  const getMiniSvgPath = (fr: Frame): string => {
    const vertices = fr.vertices || [
      { x: fr.x, y: fr.y },
      { x: fr.x + fr.w, y: fr.y },
      { x: fr.x + fr.w, y: fr.y + fr.h },
      { x: fr.x, y: fr.y + fr.h },
    ];
    if (vertices.length === 0) return '';
    const bounds = getPolygonBounds(vertices);
    const maxDim = Math.max(bounds.w || 1, bounds.h || 1);
    const scale = 32 / maxDim;
    const dx = (40 - bounds.w * scale) / 2 - bounds.x * scale;
    const dy = (40 - bounds.h * scale) / 2 - bounds.y * scale;

    const scaledVertices = vertices.map((v) => ({
      x: v.x * scale + dx,
      y: v.y * scale + dy,
      handleIn: v.handleIn ? { x: v.handleIn.x * scale, y: v.handleIn.y * scale } : undefined,
      handleOut: v.handleOut ? { x: v.handleOut.x * scale, y: v.handleOut.y * scale } : undefined,
      isCurve: v.isCurve,
    }));

    return getSvgPathFromVertices(scaledVertices);
  };

  // Local image uploading
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeLayers) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        if (loadEvent.target?.result) {
          const rawName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          onAddLayerToFrame(activeLayers, loadEvent.target.result as string, rawName);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleAddModifier = (targetType: 'page' | 'frame') => {
    const id = 'mod_' + Math.random().toString(36).substr(2, 9);
    const newMod: Modifier = {
      id,
      type: 'parallax',
      name: 'Параллакс',
      enabled: true,
      params: {
        intensity: 50,
        speed: 1.0,
        color: 'rgba(0,0,0,0.4)',
        shadowX: 4,
        shadowY: 4,
        blur: 5,
      },
      targetIds: [],
    };

    if (targetType === 'page') {
      // By default target all frames on current page
      newMod.targetIds = activePage.frames.map(f => f.id);
      const currentMods = activePage.modifiers || [];
      onUpdatePageState({ modifiers: [...currentMods, newMod] });
    } else {
      // By default target all layers on current frame
      if (activeFrame) {
        newMod.targetIds = activeFrame.layers.map(l => l.id);
        const currentMods = activeFrame.modifiers || [];
        onModifyFrame(activeFrame.id, { modifiers: [...currentMods, newMod] });
      }
    }
  };

  const handleUpdateModifier = (targetType: 'page' | 'frame', modId: string, updates: Partial<Modifier>) => {
    if (targetType === 'page') {
      const currentMods = activePage.modifiers || [];
      const updated = currentMods.map(m => m.id === modId ? { ...m, ...updates } as Modifier : m);
      onUpdatePageState({ modifiers: updated });
    } else if (activeFrame) {
      const currentMods = activeFrame.modifiers || [];
      const updated = currentMods.map(m => m.id === modId ? { ...m, ...updates } as Modifier : m);
      onModifyFrame(activeFrame.id, { modifiers: updated });
    }
  };

  const handleUpdateModifierParams = (targetType: 'page' | 'frame', modId: string, params: any) => {
    if (targetType === 'page') {
      const currentMods = activePage.modifiers || [];
      const updated = currentMods.map(m => m.id === modId ? { ...m, params: { ...m.params, ...params } } : m);
      onUpdatePageState({ modifiers: updated });
    } else if (activeFrame) {
      const currentMods = activeFrame.modifiers || [];
      const updated = currentMods.map(m => m.id === modId ? { ...m, params: { ...m.params, ...params } } : m);
      onModifyFrame(activeFrame.id, { modifiers: updated });
    }
  };

  const handleDeleteModifier = (targetType: 'page' | 'frame', modId: string) => {
    if (targetType === 'page') {
      const currentMods = activePage.modifiers || [];
      onUpdatePageState({ modifiers: currentMods.filter(m => m.id !== modId) });
    } else if (activeFrame) {
      const currentMods = activeFrame.modifiers || [];
      onModifyFrame(activeFrame.id, { modifiers: currentMods.filter(m => m.id !== modId) });
    }
  };

  const handleDuplicateModifier = (targetType: 'page' | 'frame', mod: Modifier) => {
    const newMod: Modifier = {
      ...mod,
      id: Math.random().toString(36).substr(2, 9)
    };
    if (targetType === 'page') {
      const currentMods = activePage.modifiers || [];
      onUpdatePageState({ modifiers: [...currentMods, newMod] });
    } else if (activeFrame) {
      const currentMods = activeFrame.modifiers || [];
      onModifyFrame(activeFrame.id, { modifiers: [...currentMods, newMod] });
    }
  };

  const renderModifiersList = (targetType: 'page' | 'frame') => {
    const modifiers = targetType === 'page' ? (activePage.modifiers || []) : (activeFrame ? (activeFrame.modifiers || []) : []);
    const targets = targetType === 'page' 
      ? activePage.frames.map((f, fIdx) => ({ id: f.id, name: f.name || `${fIdx + 1}` }))
      : (activeFrame ? activeFrame.layers.map((l, lIdx) => ({ id: l.id, name: l.name || `Слой ${lIdx + 1}` })) : []);

    const modFolders = Array.from(new Set(modifiers.map(m => m.folder).filter(Boolean))) as string[];

    const handleCreateEmptyModFolderLocal = () => {
      const fName = `Папка ${modFolders.length + 1}`;
      if (modifiers.length > 0) {
        handleUpdateModifier(targetType, modifiers[0].id, { folder: fName });
      } else {
        const newMod: Modifier = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'parallax',
          name: 'Параллакс',
          enabled: false,
          folder: fName,
          params: { intensity: 50, trigger: 'page' },
          targetIds: []
        };
        if (targetType === 'page') {
          onUpdatePageState({ modifiers: [...modifiers, newMod] });
        } else if (activeFrame) {
          onModifyFrame(activeFrame.id, { modifiers: [...modifiers, newMod] });
        }
      }
    };

    const renderModifierCell = (mod: Modifier) => {
      const isDragAllowed = dragAllowedId === mod.id;
      return (
        <div 
          key={mod.id} 
          draggable={isDragAllowed}
          onDragStart={(e) => {
            if (!isDragAllowed) {
              e.preventDefault();
              return;
            }
            setDraggedModId(mod.id);
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('application/type', 'modifier');
            e.dataTransfer.setData('application/x-modifier-json', JSON.stringify(mod));
          }}
          onDragEnd={() => {
            setDraggedModId(null);
            setDragAllowedId(null);
          }}
          className={`bg-black/85 rounded border border-[#3A3228] overflow-hidden text-[9px] font-mono transition-opacity duration-100 ${draggedModId === mod.id ? 'opacity-30' : ''}`}
        >
          {/* Modifier Header */}
          <div 
            onMouseEnter={() => setDragAllowedId(mod.id)}
            onMouseLeave={() => {
              if (draggedModId !== mod.id) {
                setDragAllowedId(null);
              }
            }}
            className="bg-[#1a1614] p-1.5 flex items-center justify-between border-b border-[#3A3228] select-none cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center gap-1.5 flex-1 mr-2">
              <select
                value={mod.type}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const newType = e.target.value as any;
                  let name = '';
                  if (newType === 'parallax') name = 'Параллакс';
                  else if (newType === 'noise') name = 'Шум / Движение';
                  else if (newType === 'tint') name = 'Оттенок';
                  else if (newType === 'shadow') name = 'Эффект Тени';
                  else if (newType === 'stroke-noise') name = 'Шум контура (Blender GP)';
                  handleUpdateModifier(targetType, mod.id, { type: newType, name });
                }}
                className="bg-black text-[9.5px] font-bold text-white uppercase border border-[#3A3228] rounded px-1.5 max-w-[120px] outline-none py-0.5 cursor-pointer"
              >
                <option value="parallax">Параллакс</option>
                <option value="noise">Движение</option>
                <option value="tint">Оттенок</option>
                <option value="shadow">Тень</option>
                <option value="stroke-noise">Шум контура</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Trigger Toggle Button (Global/Local for all modifiers!) */}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  const currentT = mod.params.trigger || 'page';
                  const nextT = currentT === 'page' ? 'frame' : 'page';
                  handleUpdateModifierParams(targetType, mod.id, { trigger: nextT });
                }}
                className="p-1 text-[#A89F95] hover:text-white rounded cursor-pointer transition-colors"
                title={
                  (mod.params.trigger || 'page') === 'frame'
                    ? "Локальный режим (только для этой фигуры). Кликните для переключения"
                    : "Глобальный режим (по экрану). Кликните для переключения"
                }
              >
                {(mod.params.trigger || 'page') === 'frame' ? (
                  <div className="w-[12px] h-[12px] border border-[#FC018D] rounded-[2px] p-[1px] flex items-center justify-center bg-[#FC018D]/15">
                    <div className="w-[6px] h-[6px] bg-[#FC018D] rounded-[1px]" />
                  </div>
                ) : (
                  <div className="w-[12px] h-[12px] border border-[#A89F95] rounded-[2px] p-[1px] flex items-center justify-center bg-black">
                    <div className="w-[6px] h-[6px] border border-[#A89F95] rounded-[1px]" />
                  </div>
                )}
              </button>

              {/* Duplicate Modifier Button (Duplicate in header!) */}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => handleDuplicateModifier(targetType, mod)}
                className="p-1 text-[#A89F95] hover:text-[#FC018D] rounded cursor-pointer transition-colors"
                title="Дублировать модификатор"
              >
                <Copy size={11} />
              </button>

              {/* Eye icon switch instead of checkbox toggle */}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => handleUpdateModifier(targetType, mod.id, { enabled: !mod.enabled })}
                className={`p-1 rounded cursor-pointer transition-colors ${
                  mod.enabled ? 'text-[#339EEE] hover:text-[#52b1ff]' : 'text-[#7A7470] hover:text-white'
                }`}
                title={mod.enabled ? 'Отключить модификатор' : 'Включить модификатор'}
              >
                {mod.enabled ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>

              {/* Delete modifier */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => handleDeleteModifier(targetType, mod.id)}
                className="p-1 text-[#7A7470] hover:text-[#FC018D] rounded cursor-pointer"
                title="Удалить модификатор"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          {/* Modifier Parameters Group */}
          {mod.enabled && (
            <div className="p-2 space-y-2 border-b border-[#3A3228]/40 select-none bg-[#110e0c]/40">
              {mod.type === 'parallax' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[8px] font-mono text-[#7A7470]">
                    <span>ИНТЕНСИВНОСТЬ</span>
                    <span className="text-[#FC018D] font-bold">{mod.params.intensity ?? 50}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={mod.params.intensity ?? 50}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { intensity: parseInt(e.target.value) })}
                    className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#FC018D]"
                  />
                </div>
              )}

              {mod.type === 'noise' && (
                <div className="grid grid-cols-2 gap-2 text-[8px] font-mono text-[#7A7470]">
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>РАЗМАХ (PX)</span>
                      <span className="text-[#339EEE]">{mod.params.intensity ?? 10}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="150"
                      value={mod.params.intensity ?? 10}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { intensity: parseInt(e.target.value) })}
                      className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#339EEE]"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>СКОРОСТЬ</span>
                      <span className="text-[#339EEE]">{mod.params.speed ?? 1.0}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={mod.params.speed ?? 1.0}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { speed: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#339EEE]"
                    />
                  </div>
                </div>
              )}

              {mod.type === 'tint' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[8px] font-mono text-[#7A7470]">
                    <span>СДВИГ ЦВЕТА</span>
                    <span className="text-yellow-500">{mod.params.intensity ?? 50}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={mod.params.intensity ?? 50}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { intensity: parseInt(e.target.value) })}
                    className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-yellow-500"
                  />
                </div>
              )}

              {mod.type === 'shadow' && (
                <div className="space-y-2 text-[8px] font-mono text-[#7A7470]">
                  <div className="grid grid-cols-3 gap-1">
                    <div>
                      <span>СМЕЩ Х</span>
                      <input
                        type="number"
                        value={mod.params.shadowX ?? 4}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { shadowX: parseInt(e.target.value) || 0 })}
                        className="w-full mt-0.5 bg-black border border-[#3A3228] text-white p-0.5 rounded text-[8.5px] text-center"
                      />
                    </div>
                    <div>
                      <span>СМЕЩ Y</span>
                      <input
                        type="number"
                        value={mod.params.shadowY ?? 4}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { shadowY: parseInt(e.target.value) || 0 })}
                        className="w-full mt-0.5 bg-black border border-[#3A3228] text-white p-0.5 rounded text-[8.5px] text-center"
                      />
                    </div>
                    <div>
                      <span>РАЗМЫТ</span>
                      <input
                        type="number"
                        value={mod.params.blur ?? 5}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { blur: parseInt(e.target.value) || 0 })}
                        className="w-full mt-0.5 bg-black border border-[#3A3228] text-white p-0.5 rounded text-[8.5px] text-center"
                      />
                    </div>
                  </div>
                </div>
              )}

              {mod.type === 'stroke-noise' && (
                <div className="space-y-2 text-[8px] font-mono text-[#7A7470]">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>ИСКАЖЕНИЕ COORD</span>
                        <span className="text-[#00F0FF] font-bold">{mod.params.intensity ?? 15} px</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="60"
                        value={mod.params.intensity ?? 15}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { intensity: parseInt(e.target.value) })}
                        className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#00F0FF]"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>ШУМ ТОЛЩИНЫ</span>
                        <span className="text-[#00F0FF] font-bold">{mod.params.thicknessNoise ?? 25}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={mod.params.thicknessNoise ?? 25}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { thicknessNoise: parseInt(e.target.value) })}
                        className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#00F0FF]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>ЧАСТОТА ШУМА</span>
                        <span className="text-[#00F0FF] font-bold">{(mod.params.noiseScale ?? 1.0).toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="20.0"
                        step="0.1"
                        value={mod.params.noiseScale ?? 1.0}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { noiseScale: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#00F0FF]"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>СКОРОСТЬ ШУМА</span>
                        <span className="text-[#00F0FF] font-bold">{(mod.params.speed ?? 0).toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="20.0"
                        step="0.2"
                        value={mod.params.speed ?? 0}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { speed: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#00F0FF]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>СЕГМЕНТ (PX)</span>
                        <span className="text-[#00F0FF] font-bold">{mod.params.segmentLength ?? 20} px</span>
                      </div>
                      <input
                        type="range"
                        min="2"
                        max="150"
                        step="1"
                        value={mod.params.segmentLength ?? 20}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { segmentLength: parseInt(e.target.value) })}
                        className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#00F0FF]"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>ФПС ШУМА</span>
                        <span className="text-[#00F0FF] font-bold">
                          {mod.params.fps && mod.params.fps > 0 ? `${mod.params.fps} FPS` : 'БЕЗЛИМИТ'}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="60"
                        step="1"
                        value={mod.params.fps ?? 0}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateModifierParams(targetType, mod.id, { fps: parseInt(e.target.value) })}
                        className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#00F0FF]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Folder Selector for Modifiers */}
              <div className="flex items-center gap-1.5 bg-black px-1.5 py-0.5 border border-[#3A3228]/45 hover:border-[#FC018D]/45 rounded text-[8px] h-[22px] w-full max-w-[155px] mt-1.5">
                <Folder size={10} className="text-[#7A7470] shrink-0" />
                <select
                  value={mod.folder || ''}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      handleUpdateModifier(targetType, mod.id, { folder: `Папка ${modFolders.length + 1}` });
                    } else {
                      handleUpdateModifier(targetType, mod.id, { folder: e.target.value || undefined });
                    }
                  }}
                  className="bg-transparent text-[#A89F95] hover:text-white font-mono cursor-pointer outline-none border-none select-none flex-1 py-0"
                >
                  <option value="" className="bg-[#141210]">Без папки</option>
                  {modFolders.map((fName) => (
                    <option key={fName} value={fName} className="bg-[#141210]">
                      {fName}
                    </option>
                  ))}
                  <option value="__NEW__" className="bg-[#141210] text-[#FC018D]">
                    + Новая папка
                  </option>
                </select>
              </div>
            </div>
          )}

          {/* Target checkboxes bottom section */}
          <div className="p-1.5 px-2 select-none bg-[#090807] tracking-wider font-mono">
            {targets.length === 0 ? (
              <div className="text-[7.5px] italic text-[#4e4844] py-0.5">Нет доступных целей</div>
            ) : (
              <div className="flex flex-wrap gap-x-2 gap-y-1 py-0.2">
                {targets.map((tgt) => {
                  const isChecked = mod.targetIds.includes(tgt.id);
                  const weight = mod.targetWeights?.[tgt.id] ?? 1.0;

                  return (
                    <div key={tgt.id} className="flex items-center gap-1 bg-[#13110F] border border-[#3A3228]/45 px-1.5 py-0.5 rounded text-[8px]">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const list = e.target.checked
                            ? [...mod.targetIds, tgt.id]
                            : mod.targetIds.filter(id => id !== tgt.id);
                          handleUpdateModifier(targetType, mod.id, { targetIds: list });
                        }}
                        className="w-2.5 h-2.5 rounded cursor-pointer border-[#3A3228] bg-black text-[#FC018D] accent-[#FC018D] focus:ring-0"
                      />
                      <span className={isChecked ? 'text-white font-bold' : 'text-[#7A7470]'}>
                        {tgt.name}
                      </span>

                      {isChecked && (
                        <div className="ml-1 flex items-center border-l border-[#3A3228] pl-1 gap-0.5 shrink-0">
                          <span className="text-[6.5px] text-[#7A7470]">вес:</span>
                          <input
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            value={weight}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const wMap = { ...(mod.targetWeights || {}) };
                              wMap[tgt.id] = parseFloat(e.target.value) || 0;
                              handleUpdateModifier(targetType, mod.id, { targetWeights: wMap });
                            }}
                            className="w-6 h-3 bg-black border-0 text-white text-[7.5px] p-0 text-center rounded m-0 font-mono outline-none"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="p-2.5 bg-[#110e0c]/50 border-b border-[#3A3228]/35 space-y-3 shrink-0 select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ChevronDown size={11} className="text-[#A89F95]" />
            <h4 className="font-['Unbounded'] font-black text-[9px] text-[#A89F95] uppercase tracking-wider">
              Модификаторы
            </h4>
          </div>
          <div className="flex items-center gap-1">
            {/* Create local modifier folder button (Folder icon instead of FileText!) */}
            <button
              onClick={handleCreateEmptyModFolderLocal}
              className="p-1 w-[20px] h-[20px] bg-black/60 border border-[#3A3228]/60 hover:border-[#FC018D]/60 text-[#A89F95] hover:text-white rounded cursor-pointer transition-colors flex items-center justify-center"
              title="Создать папку модификаторов"
            >
              <Folder size={10} />
            </button>
            <button
              onClick={() => handleAddModifier(targetType)}
              className="p-1 w-[20px] h-[20px] bg-black/60 border border-[#3A3228]/60 hover:border-[#FC018D]/60 text-[#A89F95] hover:text-white rounded cursor-pointer transition-colors flex items-center justify-center"
              title="Добавить модификатор"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>

        {modifiers.length === 0 ? (
          <div className="text-center py-4 bg-black/35 rounded border border-[#3A3228]/50 text-[8px] text-[#7A7470] font-mono leading-relaxed px-2">
            Нет активных модификаторов. Добавьте модификатор, чтобы применить эффекты к группе ({targetType === 'page' ? 'фигур' : 'слоев'})!
          </div>
        ) : (
          <div className="space-y-3">
            {/* Render grouped folders for Modifiers */}
            {modFolders.map((folderName) => {
              const folderMods = modifiers.filter(m => m.folder === folderName);
              const isCollapsed = collapsedModFolders[folderName] || false;

              return (
                <div key={folderName} className="bg-[#12100E] border border-[#3A3228]/40 rounded overflow-hidden">
                  <div
                    className="flex items-center justify-between p-1.5 bg-[#1A1614] border-b border-[#3A3228]/35 select-none cursor-pointer hover:bg-[#201B18]"
                    onClick={() => setCollapsedModFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }))}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedModId) {
                        handleUpdateModifier(targetType, draggedModId, { folder: folderName });
                        setDraggedModId(null);
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5 font-sans font-black text-[9px] text-[#FC018D]">
                      {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                      {isCollapsed ? <Folder size={11} /> : <FolderOpen size={11} />}
                      <span className="uppercase tracking-wider truncate max-w-[125px]">{folderName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[7.5px] text-[#7A7470] bg-black/55 px-1 rounded border border-[#3A3228]/25 shrink-0">
                        {folderMods.length}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          folderMods.forEach((mod) => {
                            handleUpdateModifier(targetType, mod.id, { folder: undefined });
                          });
                        }}
                        className="p-1 text-[#7A7470] hover:text-[#FC018D] rounded"
                        title="Разгруппировать папку модификаторов"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="p-1.5 space-y-2.5 bg-[#0e0c0b]/40">
                      {folderMods.length === 0 ? (
                        <div className="p-4 text-center text-[7.5px] italic text-[#554c41]">Папка пуста. Выберите ее в настройках модификатора!</div>
                      ) : (
                        folderMods.map(mod => renderModifierCell(mod))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Non-folder root level modifiers */}
            <div className="space-y-3">
              {modifiers.filter(m => !m.folder).map(mod => renderModifierCell(mod))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Layer drag-to-reorder handlers
  const handleLayerDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedLayerIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleLayerDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedLayerIdx === null || draggedLayerIdx === idx) return;
    setDragOverIdx(idx);
  };
  const handleLayerDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedLayerIdx === null || draggedLayerIdx === targetIdx) return;
    onReorderLayers(draggedLayerIdx, targetIdx);
    setDraggedLayerIdx(null);
    setDragOverIdx(null);
  };

  // Frame Drag to reorder
  const handleFrameDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedFrameIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    const targetFr = activePage.frames[idx];
    if (targetFr) {
      e.dataTransfer.setData('application/x-react-frame-id', targetFr.id.toString());
    }
  };
  const handleFrameDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const isModifier = e.dataTransfer.types.some(t => t.includes('modifier'));
    if (isModifier) {
      setDragOverFrameIdx(idx);
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (draggedFrameIdx === null || draggedFrameIdx === idx) return;
    setDragOverFrameIdx(idx);
  };
  const handleFrameDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    setDragOverFrameIdx(null);

    const isModifier = e.dataTransfer.types.some(t => t.includes('modifier'));
    if (isModifier) {
      try {
        const modJson = e.dataTransfer.getData('application/x-modifier-json');
        if (modJson) {
          const parsedMod = JSON.parse(modJson) as Modifier;
          const targetFr = activePage.frames[targetIdx];
          if (targetFr) {
            onSnapshot();
            const currentModifiers = targetFr.modifiers || [];
            const clonedMod: Modifier = {
              ...parsedMod,
              id: 'mod_' + Math.random().toString(36).substring(2, 9),
              targetIds: targetFr.layers.map(l => l.id)
            };
            onModifyFrame(targetFr.id, {
              modifiers: [...currentModifiers, clonedMod]
            });
          }
        }
      } catch (err) {
        console.error('Failed to dropped modifier', err);
      }
      return;
    }

    if (draggedFrameIdx === null || draggedFrameIdx === targetIdx) return;
    onReorderFrames(draggedFrameIdx, targetIdx);
    setDraggedFrameIdx(null);
  };

  // Extract unique folders
  const customFolders: string[] = [];
  if (activeFrame) {
    activeFrame.layers.forEach((l) => {
      if (l.folder && !customFolders.includes(l.folder)) {
        customFolders.push(l.folder);
      }
    });
  }

  // Create an empty folder
  const handleCreateEmptyFolder = () => {
    if (!activeFrame) return;
    const fName = `Папка ${customFolders.length + 1}`;
    // Assign any currently selected layer to that folder to prompt creation
    if (selectedLayerId) {
      onModifyLayer(selectedLayerId, { folder: fName });
    } else if (activeFrame.layers.length > 0) {
      onModifyLayer(activeFrame.layers[0].id, { folder: fName });
    }
  };

  // Layer list rendering cell
  const renderLayerItem = (layer: Layer, layerIdx: number) => {
    const isSelected = selectedLayerIds.includes(layer.id);
    const activeLayer = activeFrame?.layers.find((l) => l.id === selectedLayerId);

    return (
      <div key={layer.id} className="border-b border-[#3A3228]/20">
        <div
          draggable
          onDragStart={(e) => handleLayerDragStart(e, layerIdx)}
          onDragOver={(e) => handleLayerDragOver(e, layerIdx)}
          onDrop={(e) => handleLayerDrop(e, layerIdx)}
          onDragEnd={() => {
            setDraggedLayerIdx(null);
            setDragOverIdx(null);
          }}
          onClick={(e) => {
            let nextIds = [...selectedLayerIds];
            if (e.shiftKey) {
              if (nextIds.includes(layer.id)) {
                nextIds = nextIds.filter((id) => id !== layer.id);
              } else {
                nextIds.push(layer.id);
              }
            } else {
              if (nextIds.includes(layer.id) && nextIds.length === 1) {
                nextIds = [];
              } else {
                nextIds = [layer.id];
              }
            }
            onSelectLayerIds(nextIds);
            if (nextIds.length > 0) {
              onSelectLayer(nextIds[nextIds.length - 1]);
            } else {
              onSelectLayer(null);
            }
          }}
          className={`flex items-center gap-2 p-2 group transition-colors duration-100 cursor-pointer ${
            isSelected
              ? 'bg-[#1E1520] border-l-4 border-[#FC018D]'
              : dragOverIdx === layerIdx
              ? 'bg-[#339EEE]/10 border-l-4 border-dashed border-[#339EEE]'
              : 'bg-[#1E1A16] hover:bg-[#2A241C]'
          } ${draggedLayerIdx === layerIdx ? 'opacity-30' : ''}`}
        >
          <div className="w-8 h-8 rounded border border-[#3A3228] bg-black overflow-hidden shrink-0 flex items-center justify-center">
            <img src={layer.src} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          </div>

          <div 
            className="flex-1 min-w-0 select-none"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingLayerId(layer.id);
              setEditingLayerVal(layer.name || `Слой ${layerIdx + 1}`);
            }}
          >
            {editingLayerId === layer.id ? (
              <input
                type="text"
                autoFocus
                value={editingLayerVal}
                onChange={(e) => setEditingLayerVal(e.target.value)}
                onBlur={() => handleRenameLayerCommit(layer.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameLayerCommit(layer.id);
                  if (e.key === 'Escape') setEditingLayerId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-black text-[10px] font-bold text-white outline-none px-1 py-0.5 rounded border border-[#FC018D] w-full"
              />
            ) : (
              <div className="text-[10px] font-bold text-[#F5F0E8] truncate cursor-pointer hover:text-[#FC018D]" title="Двойной клик для переименования">
                {layer.name || `Слой ${layerIdx + 1}`}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Arrow up/down controls for immediate ordering */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (layerIdx < (activeFrame?.layers.length || 0) - 1) {
                  onReorderLayers(layerIdx, layerIdx + 1);
                }
              }}
              disabled={layerIdx === (activeFrame?.layers.length || 0) - 1}
              className={`p-0.5 rounded cursor-pointer text-[#7A7470] hover:text-white disabled:opacity-20`}
              title="Переместить слой вперед"
            >
              <ArrowUp size={10} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (layerIdx > 0) {
                  onReorderLayers(layerIdx, layerIdx - 1);
                }
              }}
              disabled={layerIdx === 0}
              className={`p-0.5 rounded cursor-pointer text-[#7A7470] hover:text-white disabled:opacity-20`}
              title="Переместить слой назад"
            >
              <ArrowDown size={10} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onModifyLayer(layer.id, { hidden: !layer.hidden });
              }}
              className={`p-1 rounded cursor-pointer ${
                layer.hidden ? 'text-red-500 hover:text-red-400' : 'text-[#7A7470] hover:text-[#F5F0E8]'
              }`}
              title={layer.hidden ? 'Показать слой' : 'Скрыть слой'}
            >
              {layer.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onModifyLayer(layer.id, { locked: !layer.locked });
              }}
              className={`p-1 rounded cursor-pointer ${
                layer.locked ? 'text-[#339EEE] hover:text-[#52b1ff]' : 'text-[#7A7470] hover:text-[#F5F0E8]'
              }`}
              title={layer.locked ? 'Разблокировать слой' : 'Заблокировать слой'}
            >
              {layer.locked ? <Lock size={11} /> : <Unlock size={11} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteLayer(layer.id);
              }}
              className="p-1 text-[#7A7470] hover:text-[#FC018D] rounded cursor-pointer"
              title="Удалить слой"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {/* Sliders coordinate settings */}
        {isSelected && activeLayer && selectedLayerId === layer.id && (
          <div className="bg-[#0B0907] p-2 space-y-1.5 border-t border-b border-[#3A3228]/25 select-none text-[8px] font-mono">
            {/* Coordinate 2x2 Grid */}
            <div className="grid grid-cols-2 gap-1.5">
              {/* Shift X */}
              <div className="flex items-center justify-between bg-[#13110F] px-1.5 py-0.5 rounded border border-[#3A3228]/25 gap-1" title="Сдвиг X px">
                <span className="text-[#7A7470] uppercase font-bold text-[7.5px] tracking-wider shrink-0">сдвиг x px</span>
                <input
                  type="number"
                  value={Math.round(activeLayer.tx)}
                  onChange={(e) => onModifyLayer(layer.id, { tx: parseFloat(e.target.value) || 0 })}
                  onWheel={(e) => handleWheelStep(e, (val) => onModifyLayer(layer.id, { tx: val }), 5)}
                  className="w-10 bg-transparent text-white font-mono text-right font-bold outline-none focus:text-[#FC018D]"
                />
              </div>

              {/* Shift Y */}
              <div className="flex items-center justify-between bg-[#13110F] px-1.5 py-0.5 rounded border border-[#3A3228]/25 gap-1" title="Сдвиг Y px">
                <span className="text-[#7A7470] uppercase font-bold text-[7.5px] tracking-wider shrink-0">сдвиг y px</span>
                <input
                  type="number"
                  value={Math.round(activeLayer.ty)}
                  onChange={(e) => onModifyLayer(layer.id, { ty: parseFloat(e.target.value) || 0 })}
                  onWheel={(e) => handleWheelStep(e, (val) => onModifyLayer(layer.id, { ty: val }), 5)}
                  className="w-10 bg-transparent text-white font-mono text-right font-bold outline-none focus:text-[#FC018D]"
                />
              </div>

              {/* Scale */}
              <div className="flex items-center justify-between bg-[#13110F] px-1.5 py-0.5 rounded border border-[#3A3228]/25 gap-1" title="Масштаб">
                <span className="text-[#7A7470] uppercase font-bold text-[7.5px] tracking-wider shrink-0">масштаб</span>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="10"
                  value={activeLayer.scale}
                  onChange={(e) => onModifyLayer(layer.id, { scale: Math.max(0.05, parseFloat(e.target.value) || 1) })}
                  onWheel={(e) => handleWheelStep(e, (val) => onModifyLayer(layer.id, { scale: val }), 0.05, 0.1, 10)}
                  className="w-10 bg-transparent text-white font-mono text-right font-bold outline-none focus:text-[#FC018D]"
                />
              </div>

              {/* Rotate */}
              <div className="flex items-center justify-between bg-[#13110F] px-1.5 py-0.5 rounded border border-[#3A3228]/25 gap-1" title="Поворот град">
                <span className="text-[#7A7470] uppercase font-bold text-[7.5px] tracking-wider shrink-0">поворот</span>
                <input
                  type="number"
                  value={Math.round(activeLayer.rotate)}
                  onChange={(e) => onModifyLayer(layer.id, { rotate: parseFloat(e.target.value) || 0 })}
                  onWheel={(e) => handleWheelStep(e, (val) => onModifyLayer(layer.id, { rotate: val }), 5)}
                  className="w-10 bg-transparent text-white font-mono text-right font-bold outline-none focus:text-[#FC018D]"
                />
              </div>
            </div>

            {/* Dropdowns row */}
            <div className="grid grid-cols-2 gap-1.5">
              {/* Folder */}
              <div className="flex items-center gap-1.5 bg-[#13110F] px-1.5 py-0.5 border border-[#3A3228]/25 hover:border-[#FC018D]/40 rounded text-[8px] h-[22px]">
                <Folder size={10} className="text-[#7A7470] shrink-0" />
                <select
                  value={layer.folder || ''}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      onModifyLayer(layer.id, { folder: `Папка ${customFolders.length + 1}` });
                    } else {
                      onModifyLayer(layer.id, { folder: e.target.value || undefined });
                    }
                  }}
                  className="w-full bg-transparent text-[#7A7470] hover:text-white cursor-pointer select-none outline-none border-none py-0.5 text-[8px] font-mono leading-none truncate"
                >
                  <option value="" className="bg-[#141210]">Без папки</option>
                  {customFolders.map((f) => (
                    <option key={f} value={f} className="bg-[#141210]">{f}</option>
                  ))}
                  <option value="__NEW__" className="text-[#FC018D] font-bold bg-[#141210]">+ Папка...</option>
                </select>
              </div>

              {/* Stretch resizeMode dropdown */}
              <div className="flex items-center justify-between bg-[#13110F] px-1.5 py-0.5 border border-[#3A3228]/25 hover:border-[#FC018D]/40 rounded text-[8px] h-[22px]">
                <span className="text-[#7A7470] uppercase font-bold text-[7.5px] tracking-wider shrink-0" title="Тип растяжения">растяжение</span>
                <select
                  value={layer.resizeMode || 'proportional'}
                  onChange={(e) => onModifyLayer(layer.id, { resizeMode: e.target.value as 'proportional' | 'free' })}
                  className="max-w-[60px] bg-transparent text-[#7A7470] hover:text-white cursor-pointer select-none outline-none border-none py-0.5 text-[8px] font-mono leading-none text-right text-ellipsis"
                >
                  <option value="proportional" className="bg-[#141210]">Пропорц.</option>
                  <option value="free" className="bg-[#141210]">Свободное</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Preset library catalog list
  const renderCatalogGroups = () => {
    type CatalogItem = { src: string; name: string };
    const groups: Record<string, CatalogItem[]> = {};

    state.pages.forEach((pg, pIdx) => {
      pg.frames.forEach((fr, fIdx) => {
        fr.layers.forEach((ly) => {
          let folderName = '';
          if (groupByPage && groupByFrame) {
            const fName = fr.name || `${fIdx + 1}`;
            folderName = `Лист ${pIdx + 1} / ${fName}`;
          } else if (groupByPage) {
            folderName = `Лист ${pIdx + 1}`;
          } else if (groupByFrame) {
            const fName = fr.name || `${fIdx + 1}`;
            folderName = `${fName}`;
          } else {
            folderName = `Все слои проекта`;
          }

          if (!groups[folderName]) groups[folderName] = [];
          if (!groups[folderName].some((item) => item.src === ly.src)) {
            groups[folderName].push({ src: ly.src, name: ly.name });
          }
        });
      });
    });

    // Default library content pack
    const preKey = 'Библиотека пресетов';
    groups[preKey] = SAMPLE_ASSETS.map((asset) => ({ src: asset.src, name: asset.name }));

    return Object.entries(groups).map(([folderPath, items]) => {
      if (items.length === 0) return null;
      const isCollapsed = collapsedCatalogPaths[folderPath] || false;

      return (
        <div key={folderPath} className="space-y-1">
          <button
            onClick={() => setCollapsedCatalogPaths((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }))}
            className="w-full flex items-center justify-between text-left p-1 bg-black border border-[#3A3228]/50 text-[8.5px] font-sans font-bold text-[#FC018D] rounded hover:border-[#FC018D]/45 cursor-pointer"
          >
            <div className="flex items-center gap-1 truncate font-sans">
              {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              {isCollapsed ? <Folder size={10} /> : <FolderOpen size={10} />}
              <span className="truncate uppercase tracking-wider">{folderPath}</span>
            </div>
            <span className="text-[7.5px] text-[#7A7470] bg-black px-1.5 py-0.2 rounded border border-[#3A3228]/30 shrink-0">
              {items.length}
            </span>
          </button>

          {!isCollapsed && (
            <div className="grid grid-cols-4 gap-1 p-1 bg-black/40 rounded border border-[#3A3228]/20">
              {items.map((item, idx) => (
                <div
                  key={`${folderPath}-${idx}`}
                  onClick={() => {
                    if (activeLayers) {
                      onAddLayerToFrame(activeLayers, item.src, item.name);
                    }
                  }}
                  className="aspect-square relative rounded border border-[#3A3228]/60 bg-black/75 cursor-pointer hover:border-[#FC018D] overflow-hidden group/item"
                  title={`Загрузить изображение "${item.name}" в этот кадр`}
                >
                  <img src={item.src} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-[#FC018D]/40 opacity-0 group-hover/item:opacity-100 flex items-center justify-center transition-opacity">
                    <Plus size={10} className="text-white font-extrabold" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  // Vertex Customisation Sub-widget ("Настройки вершин")
  const renderVertexSettings = () => {
    // Collect specific vertices referenced in frame coordinates
    const selectedCount = selVertices.length;
    if (selectedCount === 0) {
      return (
        <div className="p-6 text-center text-xs text-[#7A7470] font-mono leading-relaxed select-none">
          Выберите одну или несколько вершин с помощью инструмента "Вершины", чтобы отредактировать их кривизну и усики безье.
        </div>
      );
    }

    const firstSel = selVertices[0];
    const targetFr = activePage.frames.find((f) => f.id === firstSel.frameId);
    const origV = targetFr?.vertices?.[firstSel.vIdx];
    const isCurveNow = origV?.isCurve || false;
    const hasHandlesNow = !!(origV?.handleIn || origV?.handleOut);

    // Apply mutation across all active selected vertices
    const handleMutateVertices = (action: 'corner' | 'curve' | 'no-handles' | 'yes-handles') => {
      onSnapshot();
      let updatedFrames = [...activePage.frames];

      selVertices.forEach((sv) => {
        const frIdx = updatedFrames.findIndex((f) => f.id === sv.frameId);
        if (frIdx !== -1) {
          const fr = updatedFrames[frIdx];
          const vertices = fr.vertices ? JSON.parse(JSON.stringify(fr.vertices)) : [
            { x: fr.x, y: fr.y },
            { x: fr.x + fr.w, y: fr.y },
            { x: fr.x + fr.w, y: fr.y + fr.h },
            { x: fr.x, y: fr.y + fr.h },
          ];
          const currV = vertices[sv.vIdx];
          if (currV) {
            if (action === 'corner') {
              currV.isCurve = false;
              // Reset stroke cap join configs
              delete currV.handleIn;
              delete currV.handleOut;
            } else if (action === 'curve') {
              currV.isCurve = true;
              if (!currV.handleIn && !currV.handleOut) {
                currV.handleIn = { x: -30, y: 0 };
                currV.handleOut = { x: 30, y: 0 };
              }
            } else if (action === 'no-handles') {
              delete currV.handleIn;
              delete currV.handleOut;
            } else if (action === 'yes-handles') {
              currV.handleIn = { x: -30, y: 0 };
              currV.handleOut = { x: 30, y: 0 };
              currV.isCurve = true;
            }
          }
          updatedFrames[frIdx] = { ...fr, vertices };
        }
      });

      onUpdatePageState({ frames: updatedFrames });
    };

    return (
      <div className="p-3 space-y-4">
        <div className="flex items-center gap-1.5 border-b border-[#3A3228]/40 pb-2">
          <Sparkle size={12} className="text-[#339EEE]" />
          <h3 className="font-['Unbounded'] font-bold text-[10px] text-white uppercase tracking-wider">
            Настройки Узлов ({selectedCount})
          </h3>
        </div>

        {/* Sharp corner or Smooth angle curves */}
        <div className="space-y-2">
          <span className="text-[#7A7470] text-[8px] font-mono block uppercase tracking-wider">
            Тип сочленения угла
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleMutateVertices('corner')}
              className={`p-2 rounded border flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-100 ${
                !isCurveNow
                  ? 'bg-[#339EEE] border-[#339EEE] text-white shadow-lg'
                  : 'bg-[#1E1A16] border-[#3A3228] text-[#7A7470] hover:text-white hover:border-[#339EEE]'
              }`}
              title="Острый угол (прямой жесткий стык)"
            >
              <div className="w-5 h-5 flex items-center justify-center font-sans font-black border-2 border-current rounded-xs text-[9px]">
                ▲
              </div>
              <span className="text-[8px] font-bold uppercase tracking-wider select-none">
                Острый угол
              </span>
            </button>

            <button
              onClick={() => handleMutateVertices('curve')}
              className={`p-2 rounded border flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-100 ${
                isCurveNow
                  ? 'bg-[#339EEE] border-[#339EEE] text-white shadow-lg'
                  : 'bg-[#1E1A16] border-[#3A3228] text-[#7A7470] hover:text-white hover:border-[#339EEE]'
              }`}
              title="Скругленный узел (плавная интерполяция кривой)"
            >
              <div className="w-5 h-5 flex items-center justify-center font-sans font-black border-2 border-dashed border-current rounded-full text-[9px]">
                ●
              </div>
              <span className="text-[8px] font-bold uppercase tracking-wider select-none">
                Скругленный
              </span>
            </button>
          </div>
        </div>

        {/* Bezier Handles "Усы" Toggle */}
        <div className="space-y-2">
          <span className="text-[#7A7470] text-[8px] font-mono block uppercase tracking-wider">
            Рычаги Безье (Усики)
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleMutateVertices('no-handles')}
              disabled={!hasHandlesNow}
              className={`p-2 rounded border flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-100 disabled:opacity-20 ${
                !hasHandlesNow
                  ? 'bg-black border-[#339EEE]/30 text-[#7A7470]'
                  : 'bg-[#1E1A16] border-[#3A3228] text-[#7A7470] hover:text-white hover:border-[#339EEE]'
              }`}
              title="Удалить усики Безье"
            >
              <span className="text-sm font-sans font-extrabold select-none">✕</span>
              <span className="text-[8px] font-bold uppercase tracking-wider select-none">
                Без усов
              </span>
            </button>

            <button
              onClick={() => handleMutateVertices('yes-handles')}
              className={`p-2 rounded border flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-100 ${
                hasHandlesNow
                  ? 'bg-black border-[#339EEE]/60 text-[#339EEE]'
                  : 'bg-[#1E1A16] border-[#3A3228] text-[#7A7470] hover:text-white hover:border-[#339EEE]'
              }`}
              title="Создать / выпрямить усы"
            >
              <span className="text-sm font-sans font-extrabold select-none">⍝</span>
              <span className="text-[8px] font-bold uppercase tracking-wider select-none">
                Добавить усы
              </span>
            </button>
          </div>
        </div>

        <div className="bg-[#12100E] p-2 border border-[#3A3228]/50 rounded text-[8px] text-[#7A7470] leading-relaxed font-mono select-none">
          💡 Подсказка: При зажатом Shift в режиме Вершин вы можете выделять лассо рамкой сразу несколько узлов на фигуре и сглаживать их одним кликом! Потяните за рычаги, чтобы отрегулировать изгиб.
        </div>
      </div>
    );
  };

  // Frame settings component renderer ("Настройки кадра")
  const renderFrameSettings = () => {
    if (!activeFrame) return null;

    const shapeIdx = activePage.frames.findIndex(f => f.id === activeFrame.id) + 1;

    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#3A3228] flex flex-col">
        {/* Frame properties controls */}
        <div className="p-3 bg-[#110e0c] border-b border-[#3A3228]/40 space-y-2 select-none shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-['Unbounded'] font-black text-[9px] text-[#FC018D] uppercase tracking-wider">
              Настройки Фигуры {shapeIdx}
            </h3>
            <span className="text-[8px] text-[#7A7470] font-mono bg-black px-1.5 py-0.5 rounded border border-[#3A3228]/35">
              ID: {activeFrame.id.toString().slice(-4)}
            </span>
          </div>

          {/* Edit / Passepartout mode controls */}
          <div className="flex flex-col gap-1.5 p-2 bg-neutral-900 border border-[#3A3228]/45 rounded mt-1.5 mb-2 select-none">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[8.5px] uppercase font-bold text-neutral-400 tracking-wider">
                Редактор внутри (Tab):
              </span>
              <button
                type="button"
                onClick={() => onSetViewportEditFrameId(viewportEditFrameId === activeFrame.id ? null : activeFrame.id)}
                className={`px-2 py-1 text-[8.5px] font-sans font-bold rounded cursor-pointer border uppercase tracking-wider transition-all duration-150 flex items-center gap-1 ${
                  viewportEditFrameId === activeFrame.id
                    ? 'bg-[#FC018D] border-transparent text-white shadow-[0_0_8px_rgba(252,1,141,0.45)]'
                    : 'bg-black border-[#3A3228] text-[#7A7470] hover:text-white hover:border-[#FC018D]'
                }`}
                title="Позволяет двигать, крутить и приближать картинки/мазки внутри фигуры, видеть за рамками контура (как passepartout)"
              >
                <Eye size={10} />
                {viewportEditFrameId === activeFrame.id ? 'АКТИВЕН' : 'АКТИВИРОВАТЬ'}
              </button>
            </div>

            <div className="flex items-center gap-2 mt-1 select-none">
              <input
                type="checkbox"
                id={`passepartout-chk-${activeFrame.id}`}
                checked={activeFrame.passepartout !== false}
                onChange={(e) => onModifyFrame(activeFrame.id, { passepartout: e.target.checked })}
                className="w-3 h-3 text-[#FC018D] bg-black border-[#3A3228] rounded focus:ring-0 cursor-pointer accent-[#FC018D]"
              />
              <label
                htmlFor={`passepartout-chk-${activeFrame.id}`}
                className="text-[8.5px] text-[#A89F95] cursor-pointer hover:text-white"
                title="Эффект Passepartout: затемнение области вне контура фигуры во вьюпорте при редактировании"
              >
                Эффект Passepartout (темные края)
              </label>
            </div>
          </div>

          {/* Fill & Stroke colors row */}
          <div className="flex items-center gap-1.5 select-none shrink-0 mt-1">
            {/* Fill Color Badge */}
            <div className="relative group bg-black/60 border border-[#3A3228]/55 hover:border-[#FC018D]/60 rounded px-1.5 py-1 flex items-center justify-between gap-1.5 h-[24px] min-w-[55px] cursor-pointer">
              <Paintbrush size={10} className="text-[#A89F95] group-hover:text-white shrink-0" />
              <div 
                className="w-4 h-2 rounded-sm border border-white/10" 
                style={{ backgroundColor: activeFrame.fillColor || state.pageBg }}
              />
              <input
                type="color"
                value={activeFrame.fillColor || state.pageBg}
                onChange={(e) => onModifyFrame(activeFrame.id, { fillColor: e.target.value })}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </div>

            {/* Stroke Badge */}
            <div className="relative group bg-black/60 border border-[#3A3228]/55 rounded px-2 py-1 flex items-center gap-1.5 h-[24px]">
              {/* Color swatch clicker */}
              <div className="relative flex items-center gap-1 cursor-pointer">
                <Square size={9} className="text-[#A89F95]" />
                <div 
                  className="w-4 h-2 rounded-sm border border-white/10" 
                  style={{ backgroundColor: activeFrame.strokeColor || state.strokeColor }}
                />
                <input
                  type="color"
                  value={activeFrame.strokeColor || state.strokeColor}
                  onChange={(e) => onModifyFrame(activeFrame.id, { strokeColor: e.target.value })}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                />
              </div>

              <span className="text-[#7A7470] font-mono text-[8px] font-bold">-</span>

              {/* Stroke Width input */}
              <input
                type="number"
                min="0"
                max="50"
                value={activeFrame.strokeWidth !== undefined ? activeFrame.strokeWidth : state.strokeWidth}
                onChange={(e) => onModifyFrame(activeFrame.id, { strokeWidth: Math.max(0, parseInt(e.target.value) || 0) })}
                onWheel={(e) => handleWheelStep(e, (val) => onModifyFrame(activeFrame.id, { strokeWidth: val }), 1, 0, 50)}
                className="w-5 bg-transparent text-white font-mono text-[9px] font-bold text-center outline-none border-b border-transparent hover:border-[#3A3228] focus:text-[#FC018D]"
              />

              <span className="text-[#554c41] font-mono text-[7.5px]">|</span>

              {/* Stroke Type select */}
              <select
                value={activeFrame.strokeType || (activeFrame.strokeDasharray && activeFrame.strokeDasharray !== 'none' ? 'dashed' : 'solid')}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'solid') {
                    onModifyFrame(activeFrame.id, { strokeType: 'solid', strokeDasharray: 'none' });
                  } else if (val === 'dashed') {
                    onModifyFrame(activeFrame.id, { strokeType: 'dashed', strokeDasharray: '5,5' });
                  } else if (val === 'dotted') {
                    onModifyFrame(activeFrame.id, { strokeType: 'dotted', strokeDasharray: '2,5' });
                  } else if (val === 'dashdot') {
                    onModifyFrame(activeFrame.id, { strokeType: 'dashdot', strokeDasharray: '15,10,2,10' });
                  } else {
                    onModifyFrame(activeFrame.id, { strokeType: val as any });
                  }
                }}
                className="bg-transparent text-[#A89F95] hover:text-white font-mono text-[8.5px] cursor-pointer outline-none border-none py-0 select-none max-w-[110px]"
              >
                <optgroup label="Базовые контуры" className="bg-[#141210] text-[#7A7470]">
                  <option value="solid" className="bg-[#141210] text-white">Сплошная</option>
                  <option value="dashed" className="bg-[#141210] text-white">Штриховая</option>
                  <option value="dotted" className="bg-[#141210] text-white">Точечная</option>
                  <option value="dashdot" className="bg-[#141210] text-white">Штрих-пунктир</option>
                </optgroup>
                <optgroup label="Художественные текстуры" className="bg-[#141210] text-[#7A7470]">
                  <option value="rough" className="bg-[#141210] text-white">Шероховатый скетч</option>
                  <option value="brush" className="bg-[#141210] text-white">Длинный мазок (Кисть)</option>
                  <option value="calligraphy" className="bg-[#141210] text-white">Каллиграфия</option>
                  <option value="wiggly" className="bg-[#141210] text-white">Волнистый контур</option>
                </optgroup>
              </select>
            </div>
          </div>
        </div>

        {/* Preset preset presets catalog module */}
        {showPresetLibrary && (
          <div className="h-44 bg-[#0a0807] border-b-2 border-[#FC018D]/50 flex flex-col overflow-hidden shrink-0">
            <div className="p-2 border-b border-[#3A3228] bg-black/60 flex items-center justify-between select-none">
              <span className="font-['Unbounded'] font-black text-[7.5px] text-white uppercase tracking-wider">
                Каталог ресурсов
              </span>
              <button
                onClick={() => setShowPresetLibrary(false)}
                className="text-[8px] text-[#7A7470] hover:text-[#FC018D]"
              >
                Закрыть
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-[#3A3228]">
              {renderCatalogGroups()}
            </div>
          </div>
        )}

        {/* Layers list */}
        <div className="flex flex-col">
          <div 
            className="p-2 border-b border-[#3A3228]/25 bg-black/45 select-none flex justify-between items-center cursor-pointer hover:bg-black/60 shrink-0"
            onClick={() => setIsLayersExpanded(!isLayersExpanded)}
          >
            <div className="flex items-center gap-1.5">
              {isLayersExpanded ? <ChevronDown size={11} className="text-[#A89F95]" /> : <ChevronRight size={11} className="text-[#A89F95]" />}
              <span className="font-['Unbounded'] font-black text-[9px] text-[#A89F95] uppercase tracking-wider select-none">
                Слои ({activeFrame.layers.length})
              </span>
            </div>

            {/* Catalog, Folder, Upload Actions inside Layer Header */}
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowPresetLibrary(!showPresetLibrary)}
                className={`px-1.5 py-0.5 text-[8px] font-bold uppercase rounded border transition-all duration-100 cursor-pointer flex items-center gap-0.5 h-[20px] ${
                  showPresetLibrary 
                    ? 'bg-[#FC018D] border-[#FC018D] text-white' 
                    : 'bg-black/60 border-[#3A3228]/60 hover:border-[#FC018D] text-[#A89F95] hover:text-white'
                }`}
                title="Открыть каталог пресетов"
              >
                <Sparkles size={8} />
                <span className="text-[7.5px]">Каталог</span>
              </button>

              <button
                onClick={handleCreateEmptyFolder}
                className="p-1 bg-black/60 border border-[#3A3228]/60 hover:border-[#FC018D]/60 text-[#A89F95] hover:text-white rounded cursor-pointer transition-colors h-[20px] w-[20px] flex items-center justify-center"
                title="Создать новую папку слоев"
              >
                <Folder size={10} />
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1 bg-black/60 border border-[#3A3228]/60 hover:border-[#FC018D]/60 text-[#A89F95] hover:text-white rounded cursor-pointer transition-colors h-[20px] w-[20px] flex items-center justify-center"
                title="Загрузить свою картинку"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>

          {isLayersExpanded && (
            <div>
              {activeFrame.layers.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#7A7470] font-mono leading-relaxed select-none">
                  В этом кадре нет слоев. Нажмите Каталог или перетащите изображение на этот кадр!
                </div>
              ) : (
                <div className="divide-y divide-[#3A3228]/40">
                  {customFolders.map((folderName) => {
                    const folderLayers = activeFrame.layers
                      .map((l, lIdx) => ({ l, lIdx }))
                      .filter((item) => item.l.folder === folderName)
                      .reverse();
                    const isCollapsed = collapsedLayerFolders[folderName] || false;

                    return (
                      <div key={folderName} className="bg-[#12100E] border-b border-[#3A3228]/20">
                        <div
                          className="flex items-center justify-between p-1.5 bg-[#1A1614] border-b border-[#3A3228]/40 select-none cursor-pointer hover:bg-[#201B18]"
                          onClick={() => setCollapsedLayerFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }))}
                          onDragOver={(e) => {
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedLayerIdx !== null) {
                              const targetL = activeFrame.layers[draggedLayerIdx];
                              onModifyLayer(targetL.id, { folder: folderName });
                              setDraggedLayerIdx(null);
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5 font-sans font-black text-[9px] text-[#FC018D]">
                            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                            {isCollapsed ? <Folder size={11} /> : <FolderOpen size={11} />}
                            <span className="uppercase tracking-wider truncate max-w-[120px]">{folderName}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[7.5px] text-[#7A7470] bg-black/55 px-1 rounded border border-[#3A3228]/20 shrink-0">
                              {folderLayers.length}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                folderLayers.forEach((it) => {
                                  onModifyLayer(it.l.id, { folder: undefined });
                                });
                              }}
                              className="p-1 text-[#7A7470] hover:text-[#FC018D] rounded"
                              title="Разгруппировать папку слоев"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {!isCollapsed && (
                          <div className="pl-3 border-l border-dashed border-[#FC018D]/30 divide-y divide-[#3A3228]/30">
                            {folderLayers.map((item) => renderLayerItem(item.l, item.lIdx))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {activeFrame.layers
                    .map((l, originalIdx) => ({ l, originalIdx }))
                    .filter((item) => !item.l.folder)
                    .reverse()
                    .map((item) => renderLayerItem(item.l, item.originalIdx))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modifiers List render block */}
        {renderModifiersList('frame')}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.gif"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    );
  };

  // Page Settings renderer ("Настройки страницы")
  const renderPageSettings = () => {
    // Frames listed in rendering order: topmost is at index frames.length-1, bottommost at index 0
    // To list them as requested "from nearest (1st card) to furthest (last card)" we iterate frames in REVERSE order.
    const reversedFrames = [...activePage.frames].reverse();
    const frameFolders = Array.from(new Set(activePage.frames.map((fr) => fr.folder).filter(Boolean))) as string[];

    const renderSingleFrameRow = (fr: Frame, origFrameIdx: number) => {
      const isSelected = selectedFrameIds.includes(fr.id);
      const miniPath = getMiniSvgPath(fr);

      const getFrameDepth = (f: Frame): number => {
        let d = 0;
        let curr = f;
        const visited = new Set<number>();
        while (curr.parentId && !visited.has(curr.parentId)) {
          visited.add(curr.id);
          const parent = activePage.frames.find(p => p.id === curr.parentId);
          if (!parent) break;
          d++;
          curr = parent;
        }
        return d;
      };

      const depth = getFrameDepth(fr);

      const vertices = fr.vertices || [
        { x: fr.x, y: fr.y },
        { x: fr.x + fr.w, y: fr.y },
        { x: fr.x + fr.w, y: fr.y + fr.h },
        { x: fr.x, y: fr.y + fr.h },
      ];
      const bounds = getPolygonBounds(vertices);
      const maxDim = Math.max(bounds.w || 1, bounds.h || 1);
      const scale = 32 / maxDim;

      return (
        <div
          key={fr.id}
          draggable
          onDragStart={(e) => handleFrameDragStart(e, origFrameIdx)}
          onDragOver={(e) => handleFrameDragOver(e, origFrameIdx)}
          onDrop={(e) => handleFrameDrop(e, origFrameIdx)}
          onDragEnd={() => {
            setDraggedFrameIdx(null);
            setDragOverFrameIdx(null);
          }}
          onClick={(e) => {
            let nextFrameIds = [...selectedFrameIds];
            if (e.shiftKey) {
              if (nextFrameIds.includes(fr.id)) {
                nextFrameIds = nextFrameIds.filter((id) => id !== fr.id);
              } else {
                nextFrameIds.push(fr.id);
              }
            } else {
              nextFrameIds = [fr.id];
            }
            onSelectFrameIds(nextFrameIds);
            
            // Under user requirement, we DO NOT open/activate frame settings on row clicks in Page settings menu.
            // Selection is updated on canvas, but Settings remains on the active page.
            
            onSelectLayer(null);
            onSelectLayerIds([]);
          }}
          className={`flex items-center gap-2.5 p-2 py-2.5 cursor-pointer select-none transition-colors duration-100 ${
            isSelected
              ? 'bg-[#141B20] border-l-4 border-[#339EEE]'
              : dragOverFrameIdx === origFrameIdx
              ? 'bg-[#FC018D]/10 border-l-4 border-dashed border-[#FC018D]'
              : 'bg-[#1A1613] hover:bg-[#25201C]'
          } ${draggedFrameIdx === origFrameIdx ? 'opacity-30' : ''}`}
          style={{ paddingLeft: `${depth * 15 + 10}px` }}
        >
          {depth > 0 && (
            <CornerDownRight size={10} className="text-[#FC018D] shrink-0 -mr-1 animate-pulse" />
          )}

          {/* Centered mini polygon shape visual representation */}
          <div className="w-10 h-10 rounded border border-[#3A3228] bg-black pointer-events-none flex items-center justify-center shrink-0 relative overflow-hidden">
            <svg width="0" height="0" className="absolute">
              <defs>
                <clipPath id={`clip-mini-${fr.id}`}>
                  <path d={miniPath} />
                </clipPath>
              </defs>
            </svg>

            {/* Scaled Layer previews inside the clip path */}
            {fr.layers.length > 0 ? (
              <div className="absolute inset-0" style={{ clipPath: `url(#clip-mini-${fr.id})`, WebkitClipPath: `url(#clip-mini-${fr.id})` }}>
                <div
                  className="absolute"
                   style={{
                     left: `${(40 - bounds.w * scale) / 2}px`,
                     top: `${(40 - bounds.h * scale) / 2}px`,
                     width: `${bounds.w * scale}px`,
                     height: `${bounds.h * scale}px`,
                   }}
                >
                  {fr.layers.map((layer, lIdx) => {
                    const sX = (layer.scaleX !== undefined ? layer.scaleX : layer.scale) * scale;
                    const sY = (layer.scaleY !== undefined ? layer.scaleY : layer.scale) * scale;
                    const tx = layer.tx * scale;
                    const ty = layer.ty * scale;

                    return (
                      <div
                        key={layer.id}
                        style={{ zIndex: lIdx + 1 }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                      >
                        <img
                          src={layer.src}
                          alt=""
                          style={{
                            transform: `translate(${tx}px, ${ty}px) scaleX(${sX}) scaleY(${sY}) rotate(${layer.rotate}deg)`,
                            transformOrigin: 'center center',
                          }}
                          className="max-w-full max-h-full object-contain filter drop-shadow select-none"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 bg-[#FC018D]/5" />
            )}

            {/* Stroke overlay outline */}
            <svg width="40" height="40" className="absolute inset-0 pointer-events-none">
              <path d={miniPath} fill="none" stroke="#FC018D" strokeWidth="1.5" />
            </svg>
          </div>

          <div 
            className="flex-1 min-w-0 select-none"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingFrameId(fr.id);
              setEditingFrameVal(fr.name || `${origFrameIdx + 1}`);
            }}
          >
            {editingFrameId === fr.id ? (
              <input
                type="text"
                autoFocus
                value={editingFrameVal}
                onChange={(e) => setEditingFrameVal(e.target.value)}
                onBlur={() => handleRenameFrameCommit(fr.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameFrameCommit(fr.id);
                  if (e.key === 'Escape') setEditingFrameId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-black text-[10px] font-bold text-white outline-none px-1 py-0.5 rounded border border-[#339EEE] w-full"
              />
            ) : (
              <div className="text-[10px] font-bold text-[#F5F0E8] truncate cursor-pointer hover:text-[#339EEE]" title="Двойной клик для переименования">
                {fr.name || `${origFrameIdx + 1}`}
              </div>
            )}
            
            <div className="text-[8px] text-[#7A7470] font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>{fr.layers.length > 0 ? `Картинок: ${fr.layers.length}` : 'Пустая фигура'}</span>
              <span>•</span>
              {/* Folder Selector Dropdown */}
              <div className="flex items-center gap-0.5 bg-black/60 px-1 border border-[#3A3228]/45 hover:border-[#339EEE]/40 rounded text-[7px] h-[16px]" title="Папка фигуры">
                <Folder size={8} className="text-[#7A7470]" />
                <select
                  value={fr.folder || ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      onModifyFrame(fr.id, { folder: `Папка ${frameFolders.length + 1}` });
                    } else {
                      onModifyFrame(fr.id, { folder: e.target.value || undefined });
                    }
                  }}
                  className="bg-transparent text-[#7A7470] hover:text-white font-mono cursor-pointer outline-none border-none py-0 w-16 text-[7px]"
                >
                  <option value="" className="bg-[#141210]">No fold</option>
                  {frameFolders.map((fName) => (
                    <option key={fName} value={fName} className="bg-[#141210]">{fName}</option>
                  ))}
                  <option value="__NEW__" className="bg-[#141210] text-[#339EEE]">+ New</option>
                </select>
              </div>

              <span>•</span>

              {/* Parent Mask Selector */}
              <div className="flex items-center gap-0.5 bg-black/60 px-1 border border-[#FC018D]/40 hover:border-[#FC018D]/70 rounded text-[7px] h-[16px]" title="Маскировать родительской фигурой">
                <span className="text-[#FC018D] font-bold text-[7px] mr-0.5">Маска:</span>
                <select
                  value={fr.parentId || ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const nextVal = e.target.value ? parseInt(e.target.value) : undefined;
                    onModifyFrame(fr.id, { parentId: nextVal });
                  }}
                  className="bg-transparent text-[#AFA9A4] hover:text-white font-mono cursor-pointer outline-none border-none py-0 w-18 text-[7px]"
                >
                  <option value="" className="bg-[#141210]">Нет (корень)</option>
                  {activePage.frames
                    .filter((f) => {
                      if (f.id === fr.id) return false;
                      // Защита от циклов
                      const checkCycle = (childId: number, parentId: number): boolean => {
                        let currId = childId;
                        const watched = new Set<number>();
                        while (currId) {
                          if (currId === parentId) return true;
                          if (watched.has(currId)) break;
                          watched.add(currId);
                          const currentFrame = activePage.frames.find(x => x.id === currId);
                          if (!currentFrame || !currentFrame.parentId) break;
                          currId = currentFrame.parentId;
                        }
                        return false;
                      };
                      return !checkCycle(f.id, fr.id);
                    })
                    .map((f) => {
                      const fOrigIndex = activePage.frames.findIndex(x => x.id === f.id);
                      return (
                        <option key={f.id} value={f.id} className="bg-[#141210]">
                          {f.name || `${fOrigIndex + 1}`}
                        </option>
                      );
                    })}
                </select>
              </div>
            </div>
          </div>

          {/* Interactive drag ordering click tools */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onModifyFrame(fr.id, { hidden: !fr.hidden });
              }}
              className={`p-1 rounded cursor-pointer ${fr.hidden ? 'text-red-500' : 'text-[#7A7470] hover:text-white'}`}
              title={fr.hidden ? "Показать фигуру" : "Скрыть фигуру"}
            >
              {fr.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onModifyFrame(fr.id, { locked: !fr.locked });
              }}
              className={`p-1 rounded cursor-pointer ${fr.locked ? 'text-[#339EEE]' : 'text-[#7A7470] hover:text-white'}`}
              title={fr.locked ? "Разблокировать фигуру" : "Заблокировать фигуру"}
            >
              {fr.locked ? <Lock size={11} /> : <Unlock size={11} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (origFrameIdx < activePage.frames.length - 1) {
                  onReorderFrames(origFrameIdx, origFrameIdx + 1);
                }
              }}
              disabled={origFrameIdx === activePage.frames.length - 1}
              className="p-1 rounded cursor-pointer text-[#7A7470] hover:text-white disabled:opacity-25"
              title="Поднять фигуру в стэке (Ближе)"
            >
              <ArrowUp size={11} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (origFrameIdx > 0) {
                  onReorderFrames(origFrameIdx, origFrameIdx - 1);
                }
              }}
              disabled={origFrameIdx === 0}
              className="p-1 rounded cursor-pointer text-[#7A7470] hover:text-white disabled:opacity-25"
              title="Опустить фигуру в стэке (Дальше)"
            >
              <ArrowDown size={11} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFrame(fr.id);
              }}
              className="p-1 text-[#7A7470] hover:text-[#FC018D] rounded cursor-pointer"
              title="Удалить фигуру"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      );
    };

    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#3A3228] flex flex-col select-none">
        {/* Page settings inputs */}
        <div className="p-3 bg-[#110e0c] border-b border-[#3A3228]/40 space-y-2 shrink-0 text-[10px] font-mono select-none">
          <h3 className="font-['Unbounded'] font-black text-[9px] text-[#339EEE] uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Настройки Страницы {state.currentPage + 1}</span>
            <span className="text-[7.5px] text-[#7A7470] font-mono normal-case">Всего страниц: {state.pages.length}</span>
          </h3>

          <div className="grid grid-cols-2 gap-1.5">
            {/* Page Width */}
            <div className="flex items-center gap-1.5 bg-[#1a1815] px-2 py-1 rounded border border-[#3A3228]/55 h-7 text-[8.5px] font-mono justify-between">
              <span className="text-[#339EEE] uppercase font-bold shrink-0">ШИРИНА:</span>
              <div className="flex items-center gap-0.5 flex-1 justify-end">
                <input
                  id="panel-page-w"
                  type="number"
                  min="200"
                  max="3000"
                  value={pw}
                  onChange={(e) => onUpdatePageState({ w: Math.max(200, parseInt(e.target.value) || state.width) })}
                  className="w-12 bg-transparent text-white font-bold text-right outline-none"
                />
                <span className="text-[#554c41] text-[7.5px]">px</span>
              </div>
            </div>

            {/* Page Height */}
            <div className="flex items-center gap-1.5 bg-[#1a1815] px-2 py-1 rounded border border-[#3A3228]/55 h-7 text-[8.5px] font-mono justify-between">
              <span className="text-[#FF9F1C] uppercase font-bold shrink-0">ВЫСОТА:</span>
              <div className="flex items-center gap-0.5 flex-1 justify-end">
                <input
                  id="panel-page-h"
                  type="number"
                  min="200"
                  max="3000"
                  value={ph}
                  onChange={(e) => onUpdatePageState({ h: Math.max(200, parseInt(e.target.value) || state.height) })}
                  className="w-12 bg-transparent text-white font-bold text-right outline-none"
                />
                <span className="text-[#554c41] text-[7.5px]">px</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {/* Border Width */}
            <div className="flex items-center gap-1.5 bg-[#1a1815] px-2 py-1 rounded border border-[#3A3228]/55 h-7 text-[8.5px] font-mono justify-between">
              <span className="text-[#A89F95] uppercase font-bold shrink-0">ПОЛЯ:</span>
              <div className="flex items-center gap-0.5 flex-1 justify-end">
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={activePage.borderWidth !== undefined ? activePage.borderWidth : state.borderWidth}
                  onChange={(e) => onUpdatePageState({ borderWidth: Math.max(0, parseInt(e.target.value) || 0) } as any)}
                  className="w-8 bg-transparent text-white font-bold text-right outline-none"
                />
                <span className="text-[#554c41] text-[7.5px]">px</span>
              </div>
            </div>

            {/* Global Background */}
            <div className="flex items-center gap-1.5 bg-[#1a1815] px-1.5 py-1 rounded border border-[#3A3228]/55 h-7 text-[8.5px] font-mono justify-between">
              <span className="text-[#FC018D] uppercase font-bold shrink-0">ФОН:</span>
              <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
                <input
                  type="color"
                  value={state.pageBg}
                  onChange={(e) => onUpdateGlobalConfig({ pageBg: e.target.value })}
                  className="w-3.5 h-3.5 bg-transparent border-0 cursor-pointer outline-none shrink-0"
                />
                <input
                  type="text"
                  value={state.pageBg}
                  onChange={(e) => onUpdateGlobalConfig({ pageBg: e.target.value })}
                  className="w-12 bg-transparent text-white text-[8px] outline-none text-right font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic shape stacking layers - First Section */}
        <div className="flex flex-col bg-[#0c0a09]/15">
          <div 
            className="p-2 border-b border-[#3A3228]/25 bg-black/45 select-none flex justify-between items-center cursor-pointer hover:bg-black/60 shrink-0"
            onClick={() => setIsFramesExpanded(!isFramesExpanded)}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {isFramesExpanded ? <ChevronDown size={11} className="text-[#A89F95]" /> : <ChevronRight size={11} className="text-[#A89F95]" />}
              <span className="font-['Unbounded'] font-black text-[9px] text-[#A89F95] uppercase tracking-wider truncate">
                Фигуры ({activePage.frames.length})
              </span>
            </div>

            {/* Catalog, Folder, Add Frame Actions */}
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setShowVectorCatalog(!showVectorCatalog)}
                className={`px-1.5 py-0.5 text-[8px] font-bold uppercase rounded border transition-all duration-105 cursor-pointer flex items-center gap-0.5 h-[20px] ${
                  showVectorCatalog 
                    ? 'bg-[#339EEE] border-[#339EEE] text-white font-black' 
                    : 'bg-black/60 border-[#3A3228]/60 hover:border-[#339EEE] text-[#A89F95] hover:text-white'
                }`}
                title="Каталог векторных фигур"
              >
                <Sparkles size={8} className="animate-pulse" />
                <span>Каталог</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const frameFolders = Array.from(new Set(activePage.frames.map((fr) => fr.folder).filter(Boolean))) as string[];
                  const fName = `Папка ${frameFolders.length + 1}`;
                  if (activePage.frames.length > 0) {
                    onModifyFrame(activePage.frames[0].id, { folder: fName });
                  }
                }}
                className="p-1 bg-black/60 border border-[#3A3228]/60 hover:border-[#339EEE]/60 text-[#A89F95] hover:text-white rounded cursor-pointer transition-colors h-[20px] w-[20px] flex items-center justify-center"
                title="Создать папку фигур"
              >
                <Folder size={10} />
              </button>

              <button
                type="button"
                onClick={() => {
                  // Add a default rectangular figure
                  const rectVertices = [
                    { x: 50, y: 50 },
                    { x: state.width - 50, y: 50 },
                    { x: state.width - 50, y: state.height - 50 },
                    { x: 50, y: state.height - 50 },
                  ];
                  handleAddVectorFrame('Прямоугольник', rectVertices);
                }}
                className="p-1 bg-black/60 border border-[#3A3228]/60 hover:border-[#339EEE]/60 text-[#A89F95] hover:text-white rounded cursor-pointer transition-colors h-[20px] w-[20px] flex items-center justify-center"
                title="Добавить прямоугольную фигуру"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>

          {showVectorCatalog && (
            <div className="bg-[#110e0c] border-b border-[#3A3228]/40 flex flex-col h-[180px] shrink-0">
              <div className="p-2 border-b border-[#3A3228]/25 bg-black/35 flex justify-between items-center shrink-0">
                <span className="font-['Unbounded'] font-black text-[7.5px] text-white uppercase tracking-wider">
                  Векторные форматы фигур [Пресеты]
                </span>
                <button
                  type="button"
                  onClick={() => setShowVectorCatalog(false)}
                  className="text-[8px] text-[#7A7470] hover:text-[#339EEE]"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-[#3A3228]">
                <div className="grid grid-cols-2 gap-1.5">
                  {VECTOR_SHAPES.map((shp) => (
                    <button
                      key={shp.name}
                      type="button"
                      onClick={() => {
                        const computed = shp.getVertices(pw, ph);
                        handleAddVectorFrame(shp.name, computed);
                      }}
                      className="p-1.5 rounded bg-black/55 border border-[#3A3228]/40 hover:border-[#339EEE] text-left text-white hover:bg-black/90 cursor-pointer flex items-center gap-1.5 group transition-all"
                    >
                      <span className="text-xs shrink-0 group-hover:scale-110 transition-transform">{shp.icon}</span>
                      <div className="min-w-0">
                        <div className="text-[8.5px] font-bold truncate">{shp.name}</div>
                        <div className="text-[7.5px] text-[#7A7470] font-mono">
                          Точек: {shp.getVertices(100, 100).length}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isFramesExpanded && (
            <div className="p-2 space-y-2.5">
              {activePage.frames.length === 0 ? (
                <div className="py-8 text-center text-[10px] text-[#7A7470] font-mono leading-relaxed select-none">
                  Нет нарисованных фигур. Нажмите "+" для создания прямоугольника или выберите пресет из Каталога!
                </div>
              ) : (
                <>
                  {/* Folders of frames grouped */}
                  {(() => {
                    const frameFolders = Array.from(new Set(activePage.frames.map((fr) => fr.folder).filter(Boolean))) as string[];
                    return frameFolders.map((folderName) => {
                      const folderFrames = activePage.frames.filter((fr) => fr.folder === folderName);
                      const isCollapsed = collapsedFrameFolders[folderName] || false;
                      const reversedFolderFrames = [...folderFrames].reverse();

                      return (
                        <div key={folderName} className="bg-[#12100E] border border-[#3A3228]/40 rounded overflow-hidden">
                          <div
                            className="flex items-center justify-between p-1.5 bg-[#1A1614] border-b border-[#3A3228]/35 select-none cursor-pointer hover:bg-[#201B18]"
                            onClick={() => setCollapsedFrameFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }))}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (draggedFrameIdx !== null) {
                                const targetFr = activePage.frames[draggedFrameIdx];
                                onModifyFrame(targetFr.id, { folder: folderName });
                                setDraggedFrameIdx(null);
                              }
                            }}
                          >
                            <div className="flex items-center gap-1.5 font-sans font-black text-[9px] text-[#339EEE] uppercase tracking-wider flex-1 min-w-0">
                              {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                              {isCollapsed ? <Folder size={11} /> : <FolderOpen size={11} />}
                              {editingFrameFolder === folderName ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={editingFrameFolderVal}
                                  onChange={(e) => setEditingFrameFolderVal(e.target.value)}
                                  onBlur={() => handleRenameFrameFolderCommit(folderName)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameFrameFolderCommit(folderName);
                                    if (e.key === 'Escape') setEditingFrameFolder(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-black text-[9px] font-sans font-black text-white outline-none px-1 py-0.5 rounded border border-[#339EEE] w-full"
                                />
                              ) : (
                                <span 
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setEditingFrameFolder(folderName);
                                    setEditingFrameFolderVal(folderName);
                                  }}
                                  className="truncate max-w-[125px] cursor-pointer hover:text-white"
                                  title="Двойной клик для переименования"
                                >
                                  {folderName}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[7px] text-[#7A7470] bg-black px-1 rounded border border-[#3A3228]/25 shrink-0 font-mono">
                                {folderFrames.length}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  folderFrames.forEach((fr) => {
                                    onModifyFrame(fr.id, { folder: undefined });
                                  });
                                }}
                                className="p-1 text-[#7A7470] hover:text-[#FC018D] rounded text-[8px]"
                                title="Разгруппировать папку фигур"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          {!isCollapsed && (
                            <div className="divide-y divide-[#3A3228]/35 bg-[#0e0c0b]/40">
                              {folderFrames.length === 0 ? (
                                <div className="p-4 text-center text-[7.5px] italic text-[#554c41]">Папка пуста. Настройте папку у фигуры ниже!</div>
                              ) : (
                                reversedFolderFrames.map((fr) => {
                                  const origFrameIdx = activePage.frames.findIndex((f) => f.id === fr.id);
                                  return renderSingleFrameRow(fr, origFrameIdx);
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}

                  {/* Standard non-folder frames */}
                  <div className="divide-y divide-[#3A3228]/45">
                    {reversedFrames
                      .filter((f) => !f.folder)
                      .map((fr) => {
                        const origFrameIdx = activePage.frames.findIndex((f) => f.id === fr.id);
                        return renderSingleFrameRow(fr, origFrameIdx);
                      })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Modifiers List render block - Second Section */}
        {renderModifiersList('page')}
      </div>
    );
  };

  const renderBrushSettings = () => {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 font-sans text-xs text-[#EAE6E2] select-none">
        {/* Header Section */}
        <div className="border-b border-[#3A3228]/45 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#10AC84] animate-pulse" />
            <h3 className="font-black text-[10px] uppercase tracking-wider text-[#10AC84]">Кисть (Grease Pencil)</h3>
          </div>
          <p className="text-[8px] text-[#7A7470] mt-1">
            Создает свободные полигональные кривые с автоматическим вычислением Bezier-кривых и сглаживанием мазков.
          </p>
        </div>

        {/* Section 1: Stroke Settings (Линия) */}
        <div className="p-3.5 bg-[#1a1614]/70 border-2 border-[#322a22] rounded-lg space-y-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-[9px] uppercase tracking-wider text-[#AFA9A4]">Параметры линии</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#10AC84]" />
          </div>

          {/* Stroke Size Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-[8.5px]">
              <span className="text-[#96908B]">Толщина мазка</span>
              <span className="font-mono text-[#D6D0CA] font-bold">{brushSize} px</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="40"
                step="1"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="flex-grow accent-[#10AC84] h-1 bg-[#2b221a] rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Smoothing Factor Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-[8.5px]">
              <span className="text-[#96908B]">Сглаживание (Вес)</span>
              <span className="font-mono text-[#D6D0CA] font-bold">{Math.round(brushSmoothing * 100)}%</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.05"
                max="0.8"
                step="0.05"
                value={brushSmoothing}
                onChange={(e) => setBrushSmoothing(parseFloat(e.target.value))}
                className="flex-grow accent-[#10AC84] h-1 bg-[#2b221a] rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Color pickers */}
          <div className="space-y-2">
            <span className="text-[8.5px] text-[#96908B] block">Цвет мазка</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
                className="w-8 h-8 rounded border-2 border-[#3A3228] bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
                className="flex-1 min-w-[50px] bg-black border border-[#3A3228] text-white px-2 py-1 rounded text-[9.5px] font-mono animate-none"
              />
            </div>
            {/* Quick Presets row */}
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {['#39E361', '#FC018D', '#339EEE', '#FF9F1C', '#E056FD', '#FFFFFF'].map((color) => (
                <button
                  key={color}
                  onClick={() => setBrushColor(color)}
                  className="w-4.5 h-4.5 rounded-full border border-black cursor-pointer shadow-sm hover:scale-110 active:scale-95 transition-transform"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Section 2: Fill Settings (Заливка) */}
        <div className="p-3.5 bg-[#1a1614]/70 border-2 border-[#322a22] rounded-lg space-y-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-[9px] uppercase tracking-wider text-[#AFA9A4]">Заливка контура</span>
            <button
              onClick={() => setBrushFillEnabled(!brushFillEnabled)}
              className={`px-2 py-0.5 rounded text-[8px] uppercase tracking-widest font-black border transition-all ${
                brushFillEnabled
                  ? 'bg-[#10AC84]/20 border-[#10AC84] text-[#10AC84] shadow-[0_0_8px_rgba(16,172,132,0.3)]'
                  : 'bg-black/40 border-[#3D352D] text-[#7A7470]'
              }`}
            >
              {brushFillEnabled ? 'Активна' : 'Выкл'}
            </button>
          </div>

          {brushFillEnabled && (
            <div className="space-y-3 pt-1">
              {/* Fill Color selection */}
              <div className="space-y-2">
                <span className="text-[8.5px] text-[#96908B] block">Цвет заливки</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brushFillColor.startsWith('rgba') ? '#10AC84' : brushFillColor}
                    onChange={(e) => setBrushFillColor(e.target.value)}
                    className="w-8 h-8 rounded border-2 border-[#3A3228] bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={brushFillColor}
                    onChange={(e) => setBrushFillColor(e.target.value)}
                    className="flex-1 min-w-[50px] bg-black border border-[#3A3228] text-white px-2 py-1 rounded text-[9.5px] font-mono"
                  />
                </div>
                {/* Opacity presets for fill */}
                <div className="flex flex-col gap-1 text-[8px]">
                  <span className="text-[#7A7470]">Быстрый выбор стилей:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setBrushFillColor('rgba(57, 227, 97, 0.25)')}
                      className="px-1.5 py-1 text-[8px] bg-black border border-[#3A3228] rounded hover:border-[#10AC84] text-[#EAE6E2]"
                    >
                      Зеленый 25%
                    </button>
                    <button
                      onClick={() => setBrushFillColor('rgba(252, 1, 141, 0.25)')}
                      className="px-1.5 py-1 text-[8px] bg-black border border-[#3A3228] rounded hover:border-[#10AC84] text-[#EAE6E2]"
                    >
                      Розовый 25%
                    </button>
                    <button
                      onClick={() => setBrushFillColor('rgba(255, 255, 255, 0.15)')}
                      className="px-1.5 py-1 text-[8px] bg-black border border-[#3A3228] rounded hover:border-[#10AC84] text-[#EAE6E2]"
                    >
                      Белый 15%
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Stabilizer Settings (Стабилизатор) */}
        <div className="p-3.5 bg-[#1a1614]/70 border-2 border-[#322a22] rounded-lg space-y-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-[9px] uppercase tracking-wider text-[#AFA9A4]">Стабилизатор линии</span>
            <div className="flex bg-black/40 p-0.5 rounded border border-[#3D352D]">
              <button
                onClick={() => setBrushStabilizer && setBrushStabilizer('smooth')}
                className={`px-2 py-1 text-[8px] uppercase font-black rounded transition-all ${
                  brushStabilizer === 'smooth'
                    ? 'bg-[#10AC84] text-white shadow-sm'
                    : 'text-[#7A7470] hover:text-[#EAE6E2]'
                }`}
              >
                Вес
              </button>
              <button
                onClick={() => setBrushStabilizer && setBrushStabilizer('lazy')}
                className={`px-2 py-1 text-[8px] uppercase font-black rounded transition-all ${
                  brushStabilizer === 'lazy'
                    ? 'bg-[#10AC84] text-white shadow-sm'
                    : 'text-[#7A7470] hover:text-[#EAE6E2]'
                }`}
              >
                Lazy
              </button>
            </div>
          </div>

          {brushStabilizer === 'lazy' ? (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center text-[8.5px]">
                <span className="text-[#96908B]">Радиус поводка (Leash)</span>
                <span className="font-mono text-[#D6D0CA] font-bold">{lazyRadius} px</span>
              </div>
              <input
                type="range"
                min="5"
                max="80"
                step="2"
                value={lazyRadius}
                onChange={(e) => setLazyRadius && setLazyRadius(parseInt(e.target.value))}
                className="w-full accent-[#10AC84] h-1 bg-[#2b221a] rounded-lg cursor-pointer"
              />
              <p className="text-[7.5px] text-[#7A7470] leading-normal pt-1 bg-[#14100E] p-1.5 border border-[#2b221a]/50 rounded">
                Режим Lazy Mouse: курсор тянет кисть за эластичный поводок. Идеально гасит дрожь руки для каллиграфии и длинных плавных кривых контуров.
              </p>
            </div>
          ) : (
            <p className="text-[7.5px] text-[#7A7470] leading-normal whitespace-normal bg-[#14100E] p-1.5 border border-[#2b221a]/50 rounded">
              Экспоненциальное сглаживание: усредняет траекторию мазка в реальном времени. Настройте величину сглаживания слайдером "Сглаживание" выше.
            </p>
          )}
        </div>

        {/* Section 4: Onion Skinning (Калька) */}
        <div className="p-3.5 bg-[#1a1614]/70 border-2 border-[#322a22] rounded-lg space-y-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-[9px] uppercase tracking-wider text-[#AFA9A4]">Режим кальки (Onion)</span>
            <button
              onClick={() => setOnionEnabled && setOnionEnabled(!onionEnabled)}
              className={`px-2 py-0.5 rounded text-[8px] uppercase tracking-widest font-black border transition-all ${
                onionEnabled
                  ? 'bg-[#10AC84]/20 border-[#10AC84] text-[#10AC84] shadow-[0_0_8px_rgba(16,172,132,0.3)]'
                  : 'bg-black/40 border-[#3D352D] text-[#7A7470]'
              }`}
            >
              {onionEnabled ? 'Активна' : 'Выкл'}
            </button>
          </div>

          {onionEnabled && (
            <div className="space-y-3 pt-1">
              {/* Previous page count */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[8.5px]">
                  <span className="text-[#96908B]">Предыдущие кадры (Красный)</span>
                  <span className="font-mono text-[#D6D0CA] font-bold">{onionPrevCount}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="4"
                  step="1"
                  value={onionPrevCount}
                  onChange={(e) => setOnionPrevCount && setOnionPrevCount(parseInt(e.target.value))}
                  className="w-full accent-[#10AC84] h-1 bg-[#2b221a] rounded-lg cursor-pointer"
                />
              </div>

              {/* Next page count */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[8.5px]">
                  <span className="text-[#96908B]">Следующие кадры (Зеленый)</span>
                  <span className="font-mono text-[#D6D0CA] font-bold">{onionNextCount}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="4"
                  step="1"
                  value={onionNextCount}
                  onChange={(e) => setOnionNextCount && setOnionNextCount(parseInt(e.target.value))}
                  className="w-full accent-[#10AC84] h-1 bg-[#2b221a] rounded-lg cursor-pointer"
                />
              </div>
              
              <p className="text-[7.5px] text-[#7A7470] leading-normal pt-1 bg-[#14100E] p-1.5 border border-[#2b221a]/50 rounded">
                Калька проецирует полупрозрачные силуэты соседних страниц (анимационных фаз) для точной доводки промежуточных кадров (Inbetweening).
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderEraserSettings = () => {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 font-sans text-xs text-[#EAE6E2] select-none">
        {/* Header Section */}
        <div className="border-b border-[#3A3228]/45 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF4757] animate-pulse" />
            <h3 className="font-black text-[10px] uppercase tracking-wider text-[#FF4757]">Векторный Ластик</h3>
          </div>
          <p className="text-[8px] text-[#7A7470] mt-1">
            Стирает фрагменты линий при пересечении. Автоматически разрезает и разбивает целые векторные кривые на независимые мазки.
          </p>
        </div>

        {/* Section 1: Eraser radius */}
        <div className="p-3.5 bg-[#1a1614]/70 border-2 border-[#322a22] rounded-lg space-y-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-[9px] uppercase tracking-wider text-[#AFA9A4]">Радиус стирания</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#FF4757]" />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-[8.5px]">
              <span className="text-[#96908B]">Диаметр ластика</span>
              <span className="font-mono text-[#D6D0CA] font-bold">{eraserSize * 2} px</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="4"
                max="80"
                step="2"
                value={eraserSize}
                onChange={(e) => setEraserSize(parseInt(e.target.value))}
                className="flex-grow accent-[#FF4757] h-1 bg-[#2b221a] rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-[#141210]">
      {activeTool === 'brush' ? (
        renderBrushSettings()
      ) : activeTool === 'eraser' ? (
        renderEraserSettings()
      ) : activeTool === 'vertex' && selVertices.length > 0 ? (
        renderVertexSettings()
      ) : activeLayers !== null ? (
        renderFrameSettings()
      ) : (
        renderPageSettings()
      )}
    </div>
  );
};
