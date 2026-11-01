/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { Frame, Layer, AppState } from '../types';
import {
  Trash2,
  Eye,
  EyeOff,
  Move,
  RotateCcw,
  Plus,
  Upload,
  Sparkles,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Maximize,
} from 'lucide-react';
import { SAMPLE_ASSETS } from '../utils/presets';

interface LayerControlsProps {
  frame: Frame;
  selectedLayerId: number | null;
  onSelectLayer: (layerId: number | null) => void;
  onModifyLayer: (layerId: number, modifications: Partial<Layer>) => void;
  onDeleteLayer: (layerId: number) => void;
  onAddLayer: (src: string, name: string) => void;
  onReorderLayers: (fromIdx: number, toIdx: number) => void;
  onClose: () => void;
  state: AppState;
  onModifyFrame?: (frameId: number, modifications: Partial<Frame>) => void;
  isDocked?: boolean;
}

export const LayerControls: React.FC<LayerControlsProps> = ({
  frame,
  selectedLayerId,
  onSelectLayer,
  onModifyLayer,
  onDeleteLayer,
  onAddLayer,
  onReorderLayers,
  onClose,
  state,
  onModifyFrame,
  isDocked,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggedLayerIdx, setDraggedLayerIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [showPresetLibrary, setShowPresetLibrary] = useState(false);
  const [showFrameSettings, setShowFrameSettings] = useState(false);

  // Floating position state
  const [panelPos, setPanelPos] = useState({ x: 20, y: 80 });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Resizable dimension state
  const [panelSize, setPanelSize] = useState({ w: 240, h: 420 });

  // Catalog grouping parameters state
  const [groupByPage, setGroupByPage] = useState(true);
  const [groupByFrame, setGroupByFrame] = useState(true);
  const [collapsedCatalogPaths, setCollapsedCatalogPaths] = useState<Record<string, boolean>>({});

  // Layers list collapsible folders state
  const [collapsedLayerFolders, setCollapsedLayerFolders] = useState<Record<string, boolean>>({});

  // Renaming state for Layers and Folders
  const [editingLayerId, setEditingLayerId] = useState<number | null>(null);
  const [editingLayerVal, setEditingLayerVal] = useState('');
  const [editingLayerFolder, setEditingLayerFolder] = useState<string | null>(null);
  const [editingLayerFolderVal, setEditingLayerFolderVal] = useState('');

  const handleRenameLayerCommit = (layerId: number) => {
    const trimmed = editingLayerVal.trim();
    if (trimmed) {
      onModifyLayer(layerId, { name: trimmed });
    }
    setEditingLayerId(null);
  };

  const handleRenameLayerFolderCommit = (oldName: string) => {
    const trimmed = editingLayerFolderVal.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingLayerFolder(null);
      return;
    }
    frame.layers.forEach((l) => {
      if (l.folder === oldName) {
        onModifyLayer(l.id, { folder: trimmed });
      }
    });
    setEditingLayerFolder(null);
  };

  const handlePanelMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('select')) return;

    e.preventDefault();
    setIsDraggingPanel(true);
    dragStartRef.current = {
      x: e.clientX - panelPos.x,
      y: e.clientY - panelPos.y,
    };

    const handleMouseMove = (movedEvent: MouseEvent) => {
      setPanelPos({
        x: movedEvent.clientX - dragStartRef.current.x,
        y: movedEvent.clientY - dragStartRef.current.y,
      });
    };

    const handleMouseUp = () => {
      setIsDraggingPanel(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startW = panelSize.w;
    const startH = panelSize.h;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const handleMouseMove = (mv: MouseEvent) => {
      const dw = mv.clientX - startMouseX;
      const dh = mv.clientY - startMouseY;
      setPanelSize({
        w: Math.max(220, Math.min(480, startW + dw)),
        h: Math.max(200, Math.min(800, startH + dh)),
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Scrollwheel value increments/decrements listener
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

  // Local file loading
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        if (loadEvent.target?.result) {
          const rawName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          onAddLayer(loadEvent.target.result as string, rawName);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
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

  const activeLayer = frame.layers.find((l) => l.id === selectedLayerId);
  const customFolders = Array.from(new Set(frame.layers.map((l) => l.folder).filter(Boolean))) as string[];

  // Folder creation action - completely silent and without confirmation dialogue
  const handleCreateEmptyFolder = () => {
    const fName = `Папка ${customFolders.length + 1}`;
    if (selectedLayerId) {
      onModifyLayer(selectedLayerId, { folder: fName });
    } else if (frame.layers.length > 0) {
      onModifyLayer(frame.layers[0].id, { folder: fName });
    }
  };

  // Render individual layer item controls row
  const renderLayerItem = (layer: Layer, layerIdx: number) => {
    const isSelected = layer.id === selectedLayerId;
    return (
      <div key={layer.id} className="w-full">
        <div
          draggable
          onDragStart={(e) => handleLayerDragStart(e, layerIdx)}
          onDragOver={(e) => handleLayerDragOver(e, layerIdx)}
          onDrop={(e) => handleLayerDrop(e, layerIdx)}
          onDragEnd={() => {
            setDraggedLayerIdx(null);
            setDragOverIdx(null);
          }}
          onClick={() => {
            if (selectedLayerId === layer.id) {
              onSelectLayer(null);
            } else {
              onSelectLayer(layer.id);
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
            <img
              src={layer.src}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
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
            <div className="text-[8px] text-[#7A7470] font-mono select-none mt-0.5">
              гл: {layer.parallax}% | м: {layer.scale.toFixed(1)}x
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
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
                onDeleteLayer(layer.id);
              }}
              className="p-1 text-[#7A7470] hover:text-[#FC018D] rounded cursor-pointer"
              title="Удалить слой"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {/* Active detailed transformation coordinate settings layout overlay */}
        {isSelected && activeLayer && (
          <div className="bg-[#0D0B08] p-3 text-[10px] font-mono space-y-3.5 border-t border-b border-[#3A3228] select-none">
            <div className="space-y-1">
              <div className="flex justify-between select-none">
                <span className="text-[#7A7470] uppercase tracking-wider text-[8px]">
                  Параллакс (0 - 100)
                </span>
                <span className="text-[#FC018D] font-bold">{activeLayer.parallax}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={activeLayer.parallax}
                onChange={(e) => onModifyLayer(layer.id, { parallax: parseInt(e.target.value) })}
                onWheel={(e) => handleWheelStep(e, 1, 0, 100)}
                className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#FC018D]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[#7A7470] text-[7px] block uppercase tracking-wider">Сдвиг X px</label>
                <input
                  type="number"
                  value={Math.round(activeLayer.tx)}
                  onChange={(e) => onModifyLayer(layer.id, { tx: parseFloat(e.target.value) || 0 })}
                  onWheel={(e) => handleWheelStep(e, 5)}
                  className="w-full bg-black border border-[#3A3228] text-white text-xs p-1 focus:border-[#FC018D] outline-none"
                />
              </div>
              <div>
                <label className="text-[#7A7470] text-[7px] block uppercase tracking-wider">Сдвиг Y px</label>
                <input
                  type="number"
                  value={Math.round(activeLayer.ty)}
                  onChange={(e) => onModifyLayer(layer.id, { ty: parseFloat(e.target.value) || 0 })}
                  onWheel={(e) => handleWheelStep(e, 5)}
                  className="w-full bg-black border border-[#3A3228] text-white text-xs p-1 focus:border-[#FC018D] outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[#7A7470] text-[7px] block uppercase tracking-wider">Масштаб x</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="10"
                  value={activeLayer.scale}
                  onChange={(e) => onModifyLayer(layer.id, { scale: Math.max(0.05, parseFloat(e.target.value) || 1) })}
                  onWheel={(e) => handleWheelStep(e, 0.05, 0.1, 10)}
                  className="w-full bg-black border border-[#3A3228] text-white text-xs p-1 focus:border-[#FC018D] outline-none"
                />
              </div>
              <div>
                <label className="text-[#7A7470] text-[7px] block uppercase tracking-wider">Поворот град</label>
                <input
                  type="number"
                  value={Math.round(activeLayer.rotate)}
                  onChange={(e) => onModifyLayer(layer.id, { rotate: parseFloat(e.target.value) || 0 })}
                  onWheel={(e) => handleWheelStep(e, 5)}
                  className="w-full bg-black border border-[#3A3228] text-white text-xs p-1 focus:border-[#FC018D] outline-none"
                />
              </div>
            </div>

            {/* Folder and resize modes assignment dropdowns tree list */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[#7A7470] text-[7px] block uppercase tracking-wider">Папка слоя</label>
                <select
                  value={layer.folder || ''}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      const fName = `Папка ${customFolders.length + 1}`;
                      onModifyLayer(layer.id, { folder: fName });
                    } else {
                      onModifyLayer(layer.id, { folder: e.target.value || undefined });
                    }
                  }}
                  className="w-full bg-black border border-[#3A3228] text-white text-[10px] p-1 focus:border-[#FC018D] outline-none rounded"
                >
                  <option value="">Без папки</option>
                  {customFolders.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                  <option value="__NEW__" className="text-[#FC018D] font-bold">+ Создать...</option>
                </select>
              </div>

              <div>
                <label className="text-[#7A7470] text-[7px] block uppercase tracking-wider">Растяжение</label>
                <select
                  value={layer.resizeMode || 'proportional'}
                  onChange={(e) => onModifyLayer(layer.id, { resizeMode: e.target.value as 'proportional' | 'free' })}
                  className="w-full bg-black border border-[#3A3228] text-white text-[10px] p-1 focus:border-[#FC018D] outline-none rounded"
                >
                  <option value="proportional">Пропорционально</option>
                  <option value="free">Свободное</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => onModifyLayer(layer.id, { tx: 0, ty: 0, scale: 1, rotate: 0 })}
              className="w-full flex items-center justify-center gap-1.5 py-1 px-2 border border-[#3A3228] hover:border-[#FC018D] text-[#7A7470] hover:text-[#FC018D] rounded text-[8px] tracking-wider uppercase transition-colors duration-150 cursor-pointer font-sans"
            >
              <RotateCcw size={8} />
              Сбросить
            </button>
          </div>
        )}
      </div>
    );
  };

  // Folder grouping render elements
  const renderLayerListStructure = () => {
    const unassignedLayers = frame.layers
      .map((l, originalIdx) => ({ l, originalIdx }))
      .filter((item) => !item.l.folder);

    return (
      <div className="divide-y divide-[#3A3228]/40">
        {customFolders.map((folderName) => {
          const folderLayers = frame.layers
            .map((l, lIdx) => ({ l, lIdx }))
            .filter((item) => item.l.folder === folderName);
          const isCollapsed = collapsedLayerFolders[folderName] || false;

          return (
            <div key={folderName} className="bg-[#12100E] border-b border-[#3A3228]/20">
              {/* Folder header row container */}
              <div
                className="flex items-center justify-between p-2 bg-[#1A1614] border-b border-[#3A3228]/40 select-none cursor-pointer hover:bg-[#201B18]"
                onClick={() => setCollapsedLayerFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }))}
              >
                <div className="flex items-center gap-1.5 font-sans font-black text-[9px] text-[#FC018D] flex-1 min-w-0">
                  {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  {isCollapsed ? <Folder size={11} /> : <FolderOpen size={11} />}
                  {editingLayerFolder === folderName ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingLayerFolderVal}
                      onChange={(e) => setEditingLayerFolderVal(e.target.value)}
                      onBlur={() => handleRenameLayerFolderCommit(folderName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameLayerFolderCommit(folderName);
                        if (e.key === 'Escape') setEditingLayerFolder(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-black text-[9px] font-sans font-black text-white outline-none px-1 py-0.5 rounded border border-[#FC018D] w-full"
                    />
                  ) : (
                    <span 
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingLayerFolder(folderName);
                        setEditingLayerFolderVal(folderName);
                      }}
                      className="uppercase tracking-wider truncate max-w-[120px] cursor-pointer hover:text-white"
                      title="Двойной клик для переименования"
                    >
                      {folderName}
                    </span>
                  )}
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

              {/* Nested Folder child layers */}
              {!isCollapsed && (
                <div className="pl-3 border-l border-dashed border-[#FC018D]/30 divide-y divide-[#3A3228]/30">
                  {folderLayers.map((item) => renderLayerItem(item.l, item.lIdx))}
                </div>
              )}
            </div>
          );
        })}

        {/* Folderless unassigned layers render directly below */}
        {unassignedLayers.map((item) => renderLayerItem(item.l, item.originalIdx))}
      </div>
    );
  };

  // Catalog grouping rendering
  const renderCatalogGroups = () => {
    type CatalogItem = { src: string; name: string };
    const groups: Record<string, CatalogItem[]> = {};

    // 1. Collect all project layers dynamically
    state.pages.forEach((pg, pIdx) => {
      pg.frames.forEach((fr, fIdx) => {
        fr.layers.forEach((ly) => {
          let folderName = '';
          if (groupByPage && groupByFrame) {
            folderName = `Лист ${pIdx + 1} / Кадр ${fIdx + 1}`;
          } else if (groupByPage) {
            folderName = `Лист ${pIdx + 1}`;
          } else if (groupByFrame) {
            folderName = `Все Кадры #${fIdx + 1}`;
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

    // 2. Append default presets directory
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
            <div className="grid grid-cols-2 gap-1.5 pl-2 pt-1 pb-1">
              {items.map((it, itemIdx) => (
                <button
                  key={itemIdx}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ src: it.src, name: it.name }));
                  }}
                  onClick={() => {
                    onAddLayer(it.src, it.name);
                    setShowPresetLibrary(false);
                  }}
                  className="text-left bg-black hover:bg-[#1E1A16] border border-[#322c24] hover:border-[#FC018D]/60 text-[8px] p-1 font-mono text-[#F5F0E8] rounded flex items-center gap-1.5 truncate cursor-grab shadow duration-100"
                  title="Кликните чтобы добавить слой в кадр, или перетащите его в нужный кадр на холсте!"
                >
                  <div className="w-5.5 h-5.5 rounded overflow-hidden shrink-0 bg-black border border-[#322c24]">
                    <img
                      src={it.src}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="truncate font-sans font-normal">{it.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div
      style={isDocked ? { width: '100%', height: '100%' } : {
        left: `${panelPos.x}px`,
        top: `${panelPos.y}px`,
        width: `${panelSize.w}px`,
        height: `${panelSize.h}px`,
      }}
      className={isDocked 
        ? "w-full h-full bg-[#141210] flex flex-col select-none"
        : "absolute bg-[#141210] border-3 border-[#3A3228] shadow-[5px_5px_0_0_#FC018D] z-[1001] flex flex-col select-none rounded-sm"
      }
    >
      {/* Drag resizing handle bottom corner (ONLY if not docked) */}
      {!isDocked && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 z-[1002] hover:bg-[#FC018D]/15 rounded-br-sm group"
          title="Перетащите для изменения размера"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-[#7A7470] group-hover:text-[#FC018D] transition-colors">
            <path d="M6 0 L8 0 L8 8 L0 8 L0 6 L4 6 L4 4 L6 4 Z" fill="currentColor" />
          </svg>
        </div>
      )}

      {/* Header bar */}
      <div
        onMouseDown={isDocked ? undefined : handlePanelMouseDown}
        className={`bg-black p-2.5 flex items-center justify-between border-b-2 border-[#3A3228] select-none shrink-0 ${
          isDocked ? '' : isDraggingPanel ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div className="flex items-center gap-2">
          {!isDocked && <Move size={10} className="text-[#FC018D]" />}
          <span className="font-['Unbounded'] font-bold text-[9px] tracking-widest text-[#FC018D] uppercase">
            Слои кадра
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[#7A7470] hover:text-[#FC018D] font-bold text-xs cursor-pointer select-none"
        >
          ✕
        </button>
      </div>

      {/* Collapsible Frame Style Settings Folder */}
      <div className="border-b border-[#3A3228] bg-[#0c0a09] shrink-0">
        <button
          onClick={() => setShowFrameSettings(!showFrameSettings)}
          className="w-full flex items-center justify-between p-2 text-[8px] font-['Unbounded'] font-bold uppercase tracking-wider text-[#339EEE] hover:text-[#339EEE]/80 cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <Maximize size={10} />
            Настройки рамки (Стиль кадра)
          </span>
          {showFrameSettings ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        
        {showFrameSettings && onModifyFrame && (
          <div className="p-3 bg-[#080706] border-t border-[#3A3228]/50 space-y-3 font-mono text-[9px] text-[#7A7470]">
            {/* 1. Outline Style */}
            <div className="flex flex-col gap-1">
              <span className="uppercase text-[7.5px] font-bold text-[#7A7470] tracking-wide">Тип контура:</span>
              <select
                value={frame.strokeDasharray || 'none'}
                onChange={(e) => onModifyFrame(frame.id, { strokeDasharray: e.target.value })}
                className="bg-black border border-[#3A3228] text-white text-[9.5px] p-1.5 rounded focus:border-[#339EEE] outline-none cursor-pointer font-sans"
              >
                <option value="none">Сплошной (Solid)</option>
                <option value="8,8">Пунктир (Dashed)</option>
                <option value="2,5">Точечный (Dotted)</option>
                <option value="12,4,4,4">Штрих-пунктир</option>
              </select>
            </div>

            {/* 2. Stroke Width */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between select-none">
                <span className="uppercase text-[7.5px] font-bold text-[#7A7470] tracking-wide">Толщина обводки:</span>
                <span className="text-white font-bold">{frame.strokeWidth !== undefined ? frame.strokeWidth : state.strokeWidth}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="45"
                value={frame.strokeWidth !== undefined ? frame.strokeWidth : state.strokeWidth}
                onChange={(e) => onModifyFrame(frame.id, { strokeWidth: parseInt(e.target.value) })}
                className="w-full h-1 bg-black rounded appearance-none cursor-pointer accent-[#339EEE]"
              />
            </div>

            {/* 3. Stroke Color */}
            <div className="flex flex-col gap-1">
              <span className="uppercase text-[7.5px] font-bold text-[#7A7470] tracking-wide">Цвет обводки:</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={frame.strokeColor || state.strokeColor}
                  onChange={(e) => onModifyFrame(frame.id, { strokeColor: e.target.value })}
                  className="w-8 h-7 bg-transparent border border-[#3A3228] rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={frame.strokeColor || state.strokeColor}
                  onChange={(e) => onModifyFrame(frame.id, { strokeColor: e.target.value })}
                  className="flex-1 bg-black border border-[#3A3228] text-white text-[9.5px] p-1 rounded font-mono outline-none focus:border-[#339EEE]"
                />
              </div>
            </div>

            {/* 4. Frame Fill Color (Background) */}
            <div className="flex flex-col gap-1">
              <span className="uppercase text-[7.5px] font-bold text-[#7A7470] tracking-wide">Заливка фона кадра:</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={frame.fillColor || state.pageBg}
                  onChange={(e) => onModifyFrame(frame.id, { fillColor: e.target.value })}
                  className="w-8 h-7 bg-transparent border border-[#3A3228] rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={frame.fillColor || state.pageBg}
                  onChange={(e) => onModifyFrame(frame.id, { fillColor: e.target.value })}
                  className="flex-1 bg-black border border-[#3A3228] text-white text-[9.5px] p-1 rounded font-mono outline-none focus:border-[#339EEE]"
                />
              </div>
              <div className="flex gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => onModifyFrame(frame.id, { fillColor: '#ffffff' })}
                  className="px-1 py-0.5 bg-white text-black border border-gray-400 text-[7px] font-sans font-bold cursor-pointer rounded-xs"
                >
                  Белый
                </button>
                <button
                  type="button"
                  onClick={() => onModifyFrame(frame.id, { fillColor: '#000000' })}
                  className="px-1 py-0.5 bg-black text-white border border-[#3A3228] text-[7px] font-sans font-bold cursor-pointer rounded-xs"
                >
                  Черный
                </button>
                <button
                  type="button"
                  onClick={() => onModifyFrame(frame.id, { fillColor: '#FC018D' })}
                  className="px-1 py-0.5 bg-[#FC018D] text-white border border-transparent text-[7px] font-sans font-bold cursor-pointer rounded-xs"
                >
                  Розовый
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Foldable structure catalog panels */}
      {showPresetLibrary && (
        <div className="bg-[#0A0806] border-t border-b border-[#3A3228] flex flex-col max-h-[180px] overflow-hidden shrink-0">
          {/* Header settings checkboxes group */}
          <div className="p-2 bg-[#120F0D] border-b border-[#3A3228]/60 flex flex-col gap-1 shrink-0">
            <div className="text-[7.5px] font-sans font-bold text-[#7A7470] uppercase tracking-wider">
              Настройки группировки каталога:
            </div>
            {/* Custom styled checkboxes adhering to branded design standards */}
            <div className="flex gap-4 items-center mt-1">
              <div
                onClick={() => setGroupByPage(!groupByPage)}
                className="flex items-center gap-1.5 text-[8.5px] text-[#F5F0E8] cursor-pointer font-sans select-none group"
              >
                <div
                  className={`w-3 h-3 border flex items-center justify-center rounded-xs transition-colors ${
                    groupByPage ? 'bg-[#FC018D] border-[#FC018D]' : 'bg-black border-[#3A3228] group-hover:border-[#FC018D]/60'
                  }`}
                >
                  {groupByPage && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span>Группировать по стр.</span>
              </div>

              <div
                onClick={() => setGroupByFrame(!groupByFrame)}
                className="flex items-center gap-1.5 text-[8.5px] text-[#F5F0E8] cursor-pointer font-sans select-none group"
              >
                <div
                  className={`w-3 h-3 border flex items-center justify-center rounded-xs transition-colors ${
                    groupByFrame ? 'bg-[#FC018D] border-[#FC018D]' : 'bg-black border-[#3A3228] group-hover:border-[#FC018D]/60'
                  }`}
                >
                  {groupByFrame && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span>Группировать по фреймам</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-[#3A3228]">
            {renderCatalogGroups()}
          </div>
        </div>
      )}

      {/* Layer List Container */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#3A3228]">
        {frame.layers.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#7A7470] font-mono leading-relaxed select-none">
            В этом кадре нет слоев. Нажмите Каталог или перетащите изображение на этот кадр!
          </div>
        ) : (
          renderLayerListStructure()
        )}
      </div>

      {/* Add Controls Area */}
      <div className="p-2 border-t border-[#3A3228] flex gap-1.5 bg-[#0a0806] shrink-0">
        <button
          onClick={() => setShowPresetLibrary(!showPresetLibrary)}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-white text-[8px] font-['Unbounded'] font-bold tracking-wider uppercase border rounded cursor-pointer transition-all duration-100 ${
            showPresetLibrary ? 'bg-[#FC018D] border-[#FC018D]' : 'bg-[#1E1A16] border-[#3A3228] hover:border-[#FC018D]'
          }`}
          title="Открыть каталог изображений и пресетов"
        >
          <Sparkles size={8} />
          Каталог
        </button>

        <button
          onClick={handleCreateEmptyFolder}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[#1E1A16] border border-[#3A3228] hover:border-[#FC018D] text-white text-[8px] font-['Unbounded'] font-bold tracking-wider uppercase rounded cursor-pointer transition-all duration-100"
          title="Создать новую папку слоев"
        >
          <Folder size={8} />
          Папка
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 flex items-center justify-center bg-[#1E1A16] border border-[#3A3228] hover:border-[#339EEE] text-white rounded cursor-pointer transition-all duration-100"
          title="Загрузить свою картинку (JPEG, PNG, GIF)"
        >
          <Upload size={10} />
        </button>
      </div>

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
