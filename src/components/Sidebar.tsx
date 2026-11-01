/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Page, AppState } from '../types';
import { 
  Plus, 
  Trash2, 
  ArrowUp, 
  ArrowDown, 
  BookOpen, 
  FolderPlus, 
  Folder, 
  FolderOpen, 
  Edit2, 
  Check, 
  X, 
  ChevronRight, 
  ChevronDown 
} from 'lucide-react';
import { getAdjustedVertices, getPolygonBounds, getSvgPathFromVertices, generateVectorStrokePrimitives } from '../utils/geometry';
import { createFrame } from '../utils/presets';

interface SidebarProps {
  state: AppState;
  onSelectPage: (idx: number) => void;
  onAddPage: (customPage?: Page) => void;
  onDeletePage: (idx: number) => void;
  onReorderPages: (fromIdx: number, toIdx: number) => void;
  onUpdatePages: (pages: Page[]) => void;
}

// 6 beautiful preset templates of page frame layouts for comic creators
const PAGE_PRESETS = [
  {
    id: 'splash',
    name: 'Кадр-Сплэш (1 кадр)',
    description: 'Один огромный кадр во всю страницу для самых эпичных сцен.',
    getFrames: (w: number, h: number) => {
      const f = createFrame(0, 0, w, h);
      f.borderWidths = { top: 12, bottom: 12, left: 12, right: 12 };
      f.name = 'Эпичная панорама';
      return [f];
    }
  },
  {
    id: 'duo_vert',
    name: 'Вертикальный Дуэт (2 кадра)',
    description: 'Две высокие вертикальные полосы, разделенные пополам.',
    getFrames: (w: number, h: number) => {
      const wHalves = Math.floor(w * 0.5);
      const f1 = createFrame(0, 0, wHalves, h);
      f1.borderWidths = { top: 12, bottom: 12, left: 12, right: 6 };
      f1.name = 'Левая сторона';

      const f2 = createFrame(wHalves, 0, w - wHalves, h);
      f2.borderWidths = { top: 12, bottom: 12, left: 6, right: 12 };
      f2.name = 'Правая сторона';

      return [f1, f2];
    }
  },
  {
    id: 'duo_horiz',
    name: 'Горизонтальный Дуэт (2 кадра)',
    description: 'Два широких кинематографичных кадра один над другим.',
    getFrames: (w: number, h: number) => {
      const hHalves = Math.floor(h * 0.5);
      const f1 = createFrame(0, 0, w, hHalves);
      f1.borderWidths = { top: 12, bottom: 6, left: 12, right: 12 };
      f1.name = 'Верхняя сцена';

      const f2 = createFrame(0, hHalves, w, h - hHalves);
      f2.borderWidths = { top: 6, bottom: 12, left: 12, right: 12 };
      f2.name = 'Нижняя сцена';

      return [f1, f2];
    }
  },
  {
    id: 'triptych',
    name: 'Классический Триптих (3 кадра)',
    description: 'Широкая верхняя панель и два равных кадра снизу.',
    getFrames: (w: number, h: number) => {
      const hTop = Math.floor(h * 0.45);
      const wBot = Math.floor(w * 0.5);

      const f1 = createFrame(0, 0, w, hTop);
      f1.borderWidths = { top: 12, bottom: 6, left: 12, right: 12 };
      f1.name = 'Вводная панорама';

      const f2 = createFrame(0, hTop, wBot, h - hTop);
      f2.borderWidths = { top: 6, bottom: 12, left: 12, right: 6 };
      f2.name = 'Левая деталь';

      const f3 = createFrame(wBot, hTop, w - wBot, h - hTop);
      f3.borderWidths = { top: 6, bottom: 12, left: 6, right: 12 };
      f3.name = 'Правая реакция';

      return [f1, f2, f3];
    }
  },
  {
    id: 'grid_4',
    name: 'Четверка (Сетка 2x2)',
    description: 'Идеальная симметричная сетка из 4-х последовательных кадров.',
    getFrames: (w: number, h: number) => {
      const wHalves = Math.floor(w * 0.5);
      const hHalves = Math.floor(h * 0.5);

      const f1 = createFrame(0, 0, wHalves, hHalves);
      f1.borderWidths = { top: 12, bottom: 6, left: 12, right: 6 };
      f1.name = 'Начало действия';

      const f2 = createFrame(wHalves, 0, w - wHalves, hHalves);
      f2.borderWidths = { top: 12, bottom: 6, left: 6, right: 12 };
      f2.name = 'Развитие';

      const f3 = createFrame(0, hHalves, wHalves, h - hHalves);
      f3.borderWidths = { top: 6, bottom: 12, left: 12, right: 6 };
      f3.name = 'Поворот событий';

      const f4 = createFrame(wHalves, hHalves, w - wHalves, h - hHalves);
      f4.borderWidths = { top: 6, bottom: 12, left: 6, right: 12 };
      f4.name = 'Кульминация';

      return [f1, f2, f3, f4];
    }
  },
  {
    id: 'diagonal_stylish',
    name: 'Динамичный Экшен (3 кадра)',
    description: 'Стильный макет со скошенными границами для спортивных или боевых сцен.',
    getFrames: (w: number, h: number) => {
      // Top trapezoid
      const f1 = createFrame(0, 0, w, Math.floor(h * 0.4));
      f1.name = 'Драматический ракурс';
      f1.vertices = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: Math.floor(h * 0.3) },
        { x: 0, y: Math.floor(h * 0.45) }
      ];
      f1.borderWidths = { top: 12, left: 12, right: 12 };

      // Bottom Left trapezoid
      const f2 = createFrame(0, Math.floor(h * 0.3), Math.floor(w * 0.55), h - Math.floor(h * 0.3));
      f2.name = 'Контратака';
      f2.vertices = [
        { x: 0, y: Math.floor(h * 0.45) },
        { x: Math.floor(w * 0.55), y: Math.floor(h * 0.35) },
        { x: Math.floor(w * 0.45), y: h },
        { x: 0, y: h }
      ];
      f2.borderWidths = { bottom: 12, left: 12 };

      // Bottom Right trapezoid
      const f3 = createFrame(Math.floor(w * 0.45), Math.floor(h * 0.3), w - Math.floor(w * 0.45), h - Math.floor(h * 0.3));
      f3.name = 'Финал сражения';
      f3.vertices = [
        { x: Math.floor(w * 0.55), y: Math.floor(h * 0.35) },
        { x: w, y: Math.floor(h * 0.3) },
        { x: w, y: h },
        { x: Math.floor(w * 0.45), y: h }
      ];
      f3.borderWidths = { bottom: 12, right: 12 };

      return [f1, f2, f3];
    }
  }
];

export const Sidebar: React.FC<SidebarProps> = ({
  state,
  onSelectPage,
  onAddPage,
  onDeletePage,
  onReorderPages,
  onUpdatePages,
}) => {
  // Drag states for individual page cards
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Drag states for folders
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // Local interaction states
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editingFolderVal, setEditingFolderVal] = useState('');

  // Page renaming states
  const [editingPageIdx, setEditingPageIdx] = useState<number | null>(null);
  const [editingPageVal, setEditingPageVal] = useState('');

  const startRenamePage = (idx: number, currentName: string) => {
    setEditingPageIdx(idx);
    setEditingPageVal(currentName);
  };

  const handleRenamePageCommit = (idx: number) => {
    const trimmed = editingPageVal.trim();
    if (!trimmed) {
      setEditingPageIdx(null);
      return;
    }
    const nextPages = [...state.pages];
    nextPages[idx] = { ...nextPages[idx], name: trimmed };
    onUpdatePages(nextPages);
    setEditingPageIdx(null);
  };

  // Bottom action inputs
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showCatalog, setShowCatalog] = useState(false);

  // Collect all existing folder names in use
  const existingFolders = Array.from(new Set(state.pages.map(p => p.folder).filter(Boolean))) as string[];

  // --- Handlers for individual pages dragging ---
  const handlePageDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePageDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    setDragOverIdx(idx);
  };

  const handlePageDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    onReorderPages(draggedIdx, targetIdx);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handlePageDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // --- Handlers for dragging pages into folders ---
  const handlePageDropOnFolder = (e: React.DragEvent, folderName: string | undefined) => {
    e.preventDefault();
    if (draggedIdx === null) return;
    
    const nextPages = [...state.pages];
    const pageToMove = { ...nextPages[draggedIdx], folder: folderName };
    
    // Remove from older slot
    nextPages.splice(draggedIdx, 1);
    
    // Find contiguous index to insert nicely at bottom of newly selected folder group
    let insertIdx = nextPages.length;
    if (folderName) {
      const targetIndices = [];
      for (let i = 0; i < nextPages.length; i++) {
        if (nextPages[i].folder === folderName) {
          targetIndices.push(i);
        }
      }
      if (targetIndices.length > 0) {
        insertIdx = targetIndices[targetIndices.length - 1] + 1;
      }
    } else {
      // Place at the end for no folder
      insertIdx = nextPages.length;
    }
    
    nextPages.splice(insertIdx, 0, pageToMove);
    onUpdatePages(nextPages);
    setDraggedIdx(null);
    setDragOverFolder(null);
  };

  // --- Handlers for dragging and sorting folders ---
  const reorderFolders = (draggedF: string, targetF: string) => {
    if (draggedF === targetF) return;
    
    const pagesInD = state.pages.filter(p => p.folder === draggedF);
    const pagesElsewhere = state.pages.filter(p => p.folder !== draggedF);
    
    let targetIdx = pagesElsewhere.findIndex(p => p.folder === targetF);
    if (targetIdx === -1) {
      targetIdx = pagesElsewhere.length;
    }
    
    const nextPages = [...pagesElsewhere];
    nextPages.splice(targetIdx, 0, ...pagesInD);
    onUpdatePages(nextPages);
  };

  // --- Folder expand/collapse and renaming ---
  const toggleFolderCollapse = (folderName: string) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [folderName]: !prev[folderName]
    }));
  };

  const startRenameFolder = (folderName: string) => {
    setEditingFolder(folderName);
    setEditingFolderVal(folderName);
  };

  const handleRenameFolderCommit = (oldName: string) => {
    const trimmed = editingFolderVal.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingFolder(null);
      return;
    }
    const nextPages = state.pages.map(p => {
      if (p.folder === oldName) {
        return { ...p, folder: trimmed };
      }
      return p;
    });
    onUpdatePages(nextPages);
    setEditingFolder(null);
  };

  // --- Action commit for bottom panel ---
  const handleCreateFolderCommit = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setIsCreatingFolder(false);
      return;
    }
    // Automatically create a blank page in this new folder to initiate it
    const freshPage: Page = {
      frames: [createFrame(0, 0, state.width, state.height)],
      w: state.width,
      h: state.height,
      folder: trimmed,
      name: `Страница 1`
    };
    onAddPage(freshPage);
    setIsCreatingFolder(false);
    setNewFolderName('');
  };

  // --- Helper to render Page Thumbnail Card ---
  const renderPageCard = (page: Page, idx: number) => {
    const isActive = idx === state.currentPage;
    const pw = page.w || state.width;
    const ph = page.h || state.height;
    const aspectRatio = ph / pw;

    const miniWidth = 112;
    const miniHeight = Math.round(miniWidth * aspectRatio);
    const scale = miniWidth / pw;

    return (
      <div
        key={idx}
        draggable
        onDragStart={(e) => handlePageDragStart(e, idx)}
        onDragOver={(e) => handlePageDragOver(e, idx)}
        onDrop={(e) => handlePageDrop(e, idx)}
        onDragEnd={handlePageDragEnd}
        onClick={() => onSelectPage(idx)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startRenamePage(idx, page.name || `Страница ${idx + 1}`);
        }}
        className={`relative group cursor-grab active:cursor-grabbing border-3 transition-all duration-150 flex items-center justify-center bg-black mx-auto ${
          isActive
            ? 'border-[#FC018D] shadow-[3px_3px_0_0_#FC018D]'
            : dragOverIdx === idx
            ? 'border-[#339EEE] border-dashed bg-[#339EEE]/10'
            : 'border-[#3a3228] hover:border-[#F5F0E8]'
        } ${draggedIdx === idx ? 'opacity-30' : ''}`}
        style={{
          width: `${miniWidth + 6}px`, // +6px for border-3
          height: `${miniHeight + 6}px`, // +6px for border-3
        }}
      >
        {/* Outer box mirroring page ratio */}
        <div 
          className="relative overflow-hidden bg-[#1e1a16] shrink-0"
          style={{ width: `${miniWidth}px`, height: `${miniHeight}px` }}
        >
          {/* Visual miniature of frames */}
          <div 
            className="absolute left-0 top-0 origin-top-left pointer-events-none select-none"
            style={{
              width: `${pw}px`,
              height: `${ph}px`,
              transform: `scale(${scale})`,
            }}
          >
            {page.frames.map((fr, fIdx) => {
              if (fr.hidden) return null;
              const adjustedVertices = getAdjustedVertices(fr, pw, ph, state.borderWidth, page.borderWidth);
              const box = getPolygonBounds(adjustedVertices);

              const clipVertices = adjustedVertices.map((v) => ({
                x: v.x - box.x,
                y: v.y - box.y,
                handleIn: v.handleIn,
                handleOut: v.handleOut,
                isCurve: v.isCurve,
              }));
              const clipPathD = getSvgPathFromVertices(clipVertices);

              const visibleLayers = fr.layers ? fr.layers.filter((l) => !l.hidden) : [];

              return (
                <div
                  key={fr.id || fIdx}
                  className="absolute"
                  style={{
                    left: `${box.x}px`,
                    top: `${box.y}px`,
                    width: `${box.w}px`,
                    height: `${box.h}px`,
                    zIndex: 10 + fIdx,
                  }}
                >
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{
                      clipPath: `url(#clip-sidebar-${idx}-${fr.id})`,
                      backgroundColor: fr.fillColor || state.pageBg,
                    }}
                  >
                    <svg className="absolute w-0 h-0 pointer-events-none">
                      <defs>
                        <clipPath id={`clip-sidebar-${idx}-${fr.id}`}>
                          <path d={clipPathD} />
                        </clipPath>
                      </defs>
                    </svg>

                    {visibleLayers.map((layer, lIdx) => {
                      const sX = layer.scaleX !== undefined ? layer.scaleX : layer.scale;
                      const sY = layer.scaleY !== undefined ? layer.scaleY : layer.scale;
                      return (
                        <div
                          key={layer.id}
                          style={{
                            zIndex: lIdx + 1,
                          }}
                          className="absolute inset-0 flex items-center justify-center pointer-events-none"
                        >
                          <div
                            style={{
                              transform: `translate(${layer.tx}px, ${layer.ty}px) scaleX(${sX}) scaleY(${sY}) rotate(${layer.rotate}deg)`,
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

                  {/* Vector outline border drawn on top */}
                  <svg className="absolute inset-0 pointer-events-none w-full h-full z-20 overflow-visible">
                    {(() => {
                      const fallbackSW = page.strokeWidth !== undefined ? page.strokeWidth : state.strokeWidth;
                      const strColor = fr.strokeColor || (page.strokeColor !== undefined ? page.strokeColor : state.strokeColor);
                      const strWidth = fr.strokeWidth !== undefined ? fr.strokeWidth : fallbackSW;

                      const primitives = generateVectorStrokePrimitives(
                        fr,
                        clipVertices,
                        strWidth,
                        strColor,
                        state.strokeCaps || 'round'
                      );

                      return primitives.map((p, idxSeg) => {
                        const key = p.key || `stroke-primitive-${fr.id}-${idxSeg}`;
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
        </div>

        {/* Page Number / Name Indicator */}
        <div 
          className={`absolute bottom-1 right-1 font-mono font-bold text-[8.5px] pointer-events-none z-10 px-1 bg-black/75 text-[#7A7470] border border-[#3A3228] truncate max-w-[80px] ${
            isActive ? 'text-[#FC018D] border-[#FC018D]/50' : ''
          }`}
        >
          {page.name ? page.name : idx + 1}
        </div>

        {/* Hover Delete Action Button */}
        {state.pages.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeletePage(idx);
            }}
            className="absolute -top-1.5 -right-1.5 bg-red-600 border border-white hover:bg-red-500 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-md cursor-pointer"
            title="Удалить страницу"
          >
            <Trash2 size={10} />
          </button>
        )}

        {editingPageIdx === idx && (
          <div 
            className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-1.5 gap-1.5 pointer-events-auto" 
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span className="text-[7.5px] text-[#AFA9A4] font-bold uppercase font-sans">Имя страницы</span>
            <input
              type="text"
              autoFocus
              value={editingPageVal}
              onChange={(e) => setEditingPageVal(e.target.value)}
              onBlur={() => handleRenamePageCommit(idx)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenamePageCommit(idx);
                if (e.key === 'Escape') setEditingPageIdx(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-black text-[9px] font-mono text-white text-center outline-none px-1 py-1 rounded border border-[#FC018D] w-full"
            />
            <div className="flex gap-1 text-[7px] font-mono text-[#7A7470]">
              <span>[Enter] сохранить</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const noFolderPages = state.pages
    .map((p, originalIdx) => ({ p, originalIdx }))
    .filter(item => !item.p.folder);

  const isRootCollapsed = !!collapsedFolders['__root__'];
  const isRootOver = dragOverFolder === '__root__';

  return (
    <div className="w-[150px] bg-[#141210] border-r-4 border-[#3A3228] flex flex-col h-full overflow-hidden select-none">
      
      {/* Scrollable Groupings */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 scrollbar-thin scrollbar-thumb-[#3A3228]">
        
        {/* Render Folder Groups */}
        {existingFolders.map((fName) => {
          const isCollapsed = !!collapsedFolders[fName];
          const isOver = dragOverFolder === fName;
          const isEditing = editingFolder === fName;

          const folderPages = state.pages
            .map((p, originalIdx) => ({ p, originalIdx }))
            .filter(item => item.p.folder === fName);

          return (
            <div 
              key={fName}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedIdx !== null) setDragOverFolder(fName);
              }}
              onDragLeave={() => setDragOverFolder(null)}
              onDrop={(e) => handlePageDropOnFolder(e, fName)}
              className={`border border-[#3A3228]/50 rounded overflow-hidden transition-colors ${
                isOver ? 'border-yellow-500 bg-yellow-500/5' : ''
              }`}
            >
              {/* Folder Header */}
              <div 
                draggable
                onDragStart={(e) => {
                  setDraggedFolder(fName);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedFolder && draggedFolder !== fName) {
                    setDragOverFolder(fName);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedFolder && draggedFolder !== fName) {
                    reorderFolders(draggedFolder, fName);
                  }
                  setDraggedFolder(null);
                  setDragOverFolder(null);
                }}
                className={`flex items-center justify-between p-1.5 bg-[#120f0e] border-b border-[#3A3228] select-none hover:bg-neutral-900 group cursor-grab active:cursor-grabbing ${
                  draggedFolder === fName ? 'opacity-30' : ''
                }`}
              >
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFolderCollapse(fName);
                    }}
                    className="text-[#7A7470] hover:text-white cursor-pointer shrink-0"
                  >
                    {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                  </button>
                  <Folder size={10} className="text-yellow-500 shrink-0" />
                  
                  {isEditing ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingFolderVal}
                      onChange={(e) => setEditingFolderVal(e.target.value)}
                      onBlur={() => handleRenameFolderCommit(fName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameFolderCommit(fName);
                        if (e.key === 'Escape') setEditingFolder(null);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="bg-black text-[9px] font-mono text-white outline-none px-1 py-0.5 rounded border border-[#FC018D]/50 w-full"
                    />
                  ) : (
                    <span 
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRenameFolder(fName);
                      }}
                      className="text-[9px] font-mono font-bold tracking-tight text-[#EBE6DD] truncate cursor-pointer hover:text-yellow-400"
                      title="Двойной клик для переименования"
                    >
                      {fName}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRenameFolder(fName);
                    }}
                    className="text-[#7A7470] hover:text-white cursor-pointer"
                    title="Переименовать"
                  >
                    <Edit2 size={9} />
                  </button>
                </div>
              </div>

              {/* Pages inside folder list */}
              {!isCollapsed && (
                <div className="p-1.5 space-y-2.5 bg-[#171412]/30">
                  {folderPages.length === 0 ? (
                    <div className="text-[7.5px] font-mono text-neutral-600 text-center py-1.5 italic">
                      Пустая папка
                    </div>
                  ) : (
                    folderPages.map(item => renderPageCard(item.p, item.originalIdx))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Root Group (Pages outside of any folder) */}
        <div 
          onDragOver={(e) => {
            e.preventDefault();
            if (draggedIdx !== null) setDragOverFolder('__root__');
          }}
          onDragLeave={() => setDragOverFolder(null)}
          onDrop={(e) => handlePageDropOnFolder(e, undefined)}
          className={`border border-[#3A3228]/30 rounded overflow-hidden transition-colors ${
            isRootOver ? 'border-[#FC018D] bg-[#FC018D]/5' : ''
          }`}
        >
          {/* Header */}
          <div 
            className="flex items-center justify-between p-1.5 bg-[#0c0a09] border-b border-[#3A3228]/30 select-none"
          >
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleFolderCollapse('__root__')}
                className="text-[#7A7470] hover:text-white cursor-pointer"
              >
                {isRootCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              </button>
              <Folder size={10} className="text-neutral-500" />
              <span className="text-[9px] font-mono font-bold tracking-tight text-neutral-500 uppercase">
                Вне папок
              </span>
            </div>
          </div>

          {/* List of root pages */}
          {!isRootCollapsed && (
            <div className="p-1.5 space-y-2.5 bg-[#0d0c0b]/20">
              {noFolderPages.length === 0 ? (
                <div className="text-[7.5px] font-mono text-neutral-650 text-center py-2 italic font-medium">
                  Все в папках
                </div>
              ) : (
                noFolderPages.map(item => renderPageCard(item.p, item.originalIdx))
              )}
            </div>
          )}
        </div>

      </div>

      {/* Cyberpunk Control Buttons Panel at Bottom */}
      <div className="p-2 border-t-2 border-[#3A3228] bg-[#0d0b08] shrink-0 space-y-1.5 shadow-[0_-4px_10px_rgba(0,0,0,0.5)]">
        
        {isCreatingFolder && (
          <div className="flex items-center gap-1 bg-black p-1 rounded border border-[#3A3228]">
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Создать папку..."
              className="flex-1 bg-transparent px-1 py-0.5 text-[8.5px] font-mono text-white outline-none w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolderCommit();
                if (e.key === 'Escape') setIsCreatingFolder(false);
              }}
            />
            <button
              onClick={handleCreateFolderCommit}
              className="text-[#339EEE] hover:text-white p-0.5 rounded cursor-pointer shrink-0"
            >
              <Check size={10} />
            </button>
            <button
              onClick={() => setIsCreatingFolder(false)}
              className="text-[#7A7470] hover:text-red-500 p-0.5 rounded cursor-pointer shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-1">
          {/* Catalog */}
          <button
            onClick={() => setShowCatalog(true)}
            className="flex flex-col items-center justify-center gap-1 py-2 bg-[#120f0e] border border-[#3A3228] hover:border-[#339EEE] text-[#7A7470] hover:text-[#339EEE] transition-all rounded cursor-pointer group"
            title="Открыть каталог макетов страниц"
          >
            <BookOpen size={12} className="group-hover:scale-105 transition-transform text-[#339EEE]/80 group-hover:text-[#339EEE]" />
            <span className="text-[7px] font-mono font-black tracking-tighter">КАТАЛОГ</span>
          </button>

          {/* Folder */}
          <button
            onClick={() => setIsCreatingFolder(true)}
            className="flex flex-col items-center justify-center gap-1 py-2 bg-[#120f0e] border border-[#3A3228] hover:border-yellow-500 text-[#7A7470] hover:text-yellow-500 transition-all rounded cursor-pointer group"
            title="Создать новую папку для страниц"
          >
            <FolderPlus size={12} className="group-hover:scale-105 transition-transform text-yellow-500/80 group-hover:text-yellow-500" />
            <span className="text-[7px] font-mono font-black tracking-tighter">ПАПКА</span>
          </button>

          {/* Plus */}
          <button
            onClick={() => onAddPage()}
            className="flex flex-col items-center justify-center gap-1 py-2 bg-[#120f0e] border border-[#3A3228] hover:border-[#FC018D] text-[#7A7470] hover:text-[#FC018D] transition-all rounded cursor-pointer group"
            title="Добавить пустую страницу"
          >
            <Plus size={12} className="group-hover:scale-105 transition-transform text-[#FC018D]/80 group-hover:text-[#FC018D]" />
            <span className="text-[7px] font-mono font-black tracking-tighter">+ СТР</span>
          </button>
        </div>
      </div>

      {/* Comic Page Preset Catalog Overlay Modal Dialog */}
      {showCatalog && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#0e0b09] border-4 border-[#3A3228] shadow-[0_12px_48px_rgba(0,0,0,0.8)] rounded overflow-hidden">
            {/* Header */}
            <div className="bg-[#1b1512] px-4 py-3 flex items-center justify-between border-b-2 border-[#3A3228]">
              <div className="flex items-center gap-2">
                <BookOpen size={14} className="text-[#339EEE]" />
                <h3 className="font-['Unbounded'] text-[10px] font-black text-white uppercase tracking-wider">
                  Каталог шаблонов сцен
                </h3>
              </div>
              <button
                onClick={() => setShowCatalog(false)}
                className="p-1 text-neutral-400 hover:text-red-500 hover:bg-neutral-800 rounded transition cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {/* Catalog Grid Cards container */}
            <div className="p-4 grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#3A3228]">
              {PAGE_PRESETS.map((preset) => {
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      const frames = preset.getFrames(state.width, state.height);
                      const newPage: Page = {
                        frames,
                        w: state.width,
                        h: state.height,
                        name: preset.name
                      };
                      onAddPage(newPage);
                      setShowCatalog(false);
                    }}
                    className="bg-black/40 border border-[#3A3228] hover:border-[#FC018D] rounded p-2.5 text-left transition-all duration-150 cursor-pointer group flex flex-col justify-between hover:bg-black/70"
                  >
                    <div>
                      <h4 className="font-['Unbounded'] text-[8.5px] font-black text-[#EBE6DD] uppercase group-hover:text-[#FC018D] mb-1">
                        {preset.name}
                      </h4>
                      <p className="text-[#7A7470] text-[8px] font-mono leading-relaxed select-none mb-3">
                        {preset.description}
                      </p>
                    </div>
                    
                    {/* Visual schematics miniature */}
                    <div className="h-14 w-full border border-[#3A3228]/50 bg-[#120e0d] relative rounded overflow-hidden shrink-0 flex items-center justify-center p-1 select-none">
                      {preset.id === 'splash' && (
                        <div className="w-full h-full border border-[#FC018D]/40 flex items-center justify-center text-[7px] font-mono text-[#FC018D] font-bold">1 ПАНЕЛЬ</div>
                      )}
                      {preset.id === 'duo_vert' && (
                        <div className="w-full h-full flex gap-1">
                          <div className="flex-1 bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">1</div>
                          <div className="flex-1 bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">2</div>
                        </div>
                      )}
                      {preset.id === 'duo_horiz' && (
                        <div className="w-full h-full flex flex-col gap-1">
                          <div className="flex-1 bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">1</div>
                          <div className="flex-1 bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">2</div>
                        </div>
                      )}
                      {preset.id === 'triptych' && (
                        <div className="w-full h-full flex flex-col gap-1">
                          <div className="h-[45%] bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">1</div>
                          <div className="flex-1 flex gap-1">
                            <div className="flex-1 bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">2</div>
                            <div className="flex-1 bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">3</div>
                          </div>
                        </div>
                      )}
                      {preset.id === 'grid_4' && (
                        <div className="w-full h-full grid grid-cols-2 gap-1">
                          <div className="bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">1</div>
                          <div className="bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">2</div>
                          <div className="bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">3</div>
                          <div className="bg-neutral-900 border border-[#339EEE]/40 flex items-center justify-center text-[6px] font-mono text-[#339EEE]">4</div>
                        </div>
                      )}
                      {preset.id === 'diagonal_stylish' && (
                        <div className="w-full h-full flex flex-col gap-1 relative overflow-hidden">
                          <div className="h-[40%] bg-purple-500/10 border-b border-[#FC018D]/40 text-[5px] font-mono flex items-center justify-center text-purple-400">1</div>
                          <div className="flex-1 flex gap-1">
                            <div className="flex-1 bg-blue-500/10 border-r border-[#FC018D]/40 text-[5px] font-mono flex items-center justify-center text-blue-400">2</div>
                            <div className="flex-1 bg-pink-500/10 text-[5px] font-mono flex items-center justify-center text-pink-400">3</div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="w-full mt-2.5 py-1 bg-[#1c1512] border border-[#3A3228] text-center font-['Unbounded'] text-[7px] font-black uppercase tracking-wider text-white group-hover:bg-[#FC018D] group-hover:border-[#FC018D] group-hover:text-black transition-colors">
                      Применить макет
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
