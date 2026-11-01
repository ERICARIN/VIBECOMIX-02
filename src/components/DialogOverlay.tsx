/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

interface DialogOverlayProps {
  onStart: (config: {
    width: number;
    height: number;
    borderWidth: number;
    borderColor: string;
    strokeWidth: number;
    strokeColor: string;
    pageBg: string;
    pagesCount: number;
  }) => void;
  onClose?: () => void;
}

export const DialogOverlay: React.FC<DialogOverlayProps> = ({ onStart, onClose }) => {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(1100);
  const [borderWidth, setBorderWidth] = useState(12);
  const [borderColor, setBorderColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [pageBg, setPageBg] = useState('#d0cbc4');
  const [pagesCount, setPagesCount] = useState(2);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart({
      width,
      height,
      borderWidth,
      borderColor,
      strokeWidth,
      strokeColor,
      pageBg,
      pagesCount,
    });
  };

  return (
    <div className="fixed inset-0 bg-[#0d0d0d]/90 backdrop-blur-sm flex items-center justify-center z-[9999] overflow-y-auto p-4">
      <div 
        id="dialog-box"
        className="relative bg-[#141210] border-4 border-[#FC018D] shadow-[10px_10px_0_0_#FC018D] p-8 max-w-lg w-full transition-all duration-300 transform scale-100"
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-[#7A7470] hover:text-[#FC018D] font-bold text-lg cursor-pointer transition-colors"
            title="Закрыть (Esc)"
          >
            ✕
          </button>
        )}
        <div className="text-center mb-6">
          <div className="font-['Unbounded'] font-extrabold text-[#FC018D] text-3xl tracking-tight leading-none mb-1">
            VIBE<span className="text-[#F5F0E8]">COMIX</span>
          </div>
          <p className="text-[10px] tracking-[4px] uppercase text-[#7A7470]">
            Parallax Comic Editor · Создать проект
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 font-mono">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Ширина px
              </label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(Math.max(100, parseInt(e.target.value) || 0))}
                onWheel={(e) => handleWheelStep(e, 50, 300, 3000)}
                min="300"
                max="3000"
                className="w-full bg-black border-2 border-[#3a3228] text-[#F5F0E8] text-base font-bold p-2.5 focus:border-[#FC018D] outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Высота px
              </label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Math.max(100, parseInt(e.target.value) || 0))}
                onWheel={(e) => handleWheelStep(e, 50, 400, 4000)}
                min="400"
                max="4000"
                className="w-full bg-black border-2 border-[#3a3228] text-[#F5F0E8] text-base font-bold p-2.5 focus:border-[#FC018D] outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Рамка листа px <span className="text-[8px] text-[#7A7470] lowercase">(0 = без)</span>
              </label>
              <input
                type="number"
                value={borderWidth}
                onChange={(e) => setBorderWidth(Math.max(0, parseInt(e.target.value) || 0))}
                onWheel={(e) => handleWheelStep(e, 2, 0, 80)}
                min="0"
                max="80"
                className="w-full bg-black border-2 border-[#3a3228] text-[#F5F0E8] text-base font-bold p-2.5 focus:border-[#FC018D] outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Цвет рамки
              </label>
              <div className="flex h-11 items-center gap-2 bg-black border-2 border-[#3a3228] p-1">
                <input
                  type="color"
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                  className="w-10 h-full bg-transparent cursor-pointer border-0 outline-none"
                />
                <span className="text-xs text-[#7A7470] select-all uppercase font-semibold">{borderColor}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Обводка кадра px <span className="text-[8px] text-[#7A7470] lowercase">(0 = без)</span>
              </label>
              <input
                type="number"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Math.max(0, parseInt(e.target.value) || 0))}
                onWheel={(e) => handleWheelStep(e, 1, 0, 20)}
                min="0"
                max="20"
                className="w-full bg-black border-2 border-[#3a3228] text-[#F5F0E8] text-base font-bold p-2.5 focus:border-[#FC018D] outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Цвет обводки
              </label>
              <div className="flex h-11 items-center gap-2 bg-black border-2 border-[#3a3228] p-1">
                <input
                  type="color"
                  value={strokeColor}
                  onChange={(e) => setStrokeColor(e.target.value)}
                  className="w-10 h-full bg-transparent cursor-pointer border-0 outline-none"
                />
                <span className="text-xs text-[#7A7470] select-all uppercase font-semibold">{strokeColor}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Начальных страниц
              </label>
              <input
                type="number"
                value={pagesCount}
                onChange={(e) => setPagesCount(Math.max(1, parseInt(e.target.value) || 1))}
                onWheel={(e) => handleWheelStep(e, 1, 1, 10)}
                min="1"
                max="10"
                className="w-full bg-black border-2 border-[#3a3228] text-[#F5F0E8] text-base font-bold p-2.5 focus:border-[#FC018D] outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-wider uppercase text-[#7A7470] mb-1">
                Фон кадров
              </label>
              <div className="flex h-11 items-center gap-2 bg-black border-2 border-[#3a3228] p-1">
                <input
                  type="color"
                  value={pageBg}
                  onChange={(e) => setPageBg(e.target.value)}
                  className="w-10 h-full bg-transparent cursor-pointer border-0 outline-none"
                />
                <span className="text-xs text-[#7A7470] select-all uppercase font-semibold">{pageBg}</span>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              className="w-full font-['Unbounded'] font-black text-sm tracking-wider uppercase bg-[#FC018D] text-white border-2 border-[#FC018D] shadow-[4px_4px_0_0_rgba(252,1,141,0.3)] hover:shadow-[6px_6px_0_0_rgba(252,1,141,0.5)] active:shadow-[1px_1px_0_0_rgba(252,1,141,0.2)] py-3 px-6 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0.5 transition-all duration-150"
            >
              Создать холст →
            </button>
            <p className="text-[9px] text-[#7A7470] text-center mt-3 leading-relaxed">
              * Загрузит демонстрационный макет с предустановленными слоями, чтобы вы могли мгновенно оценить параллакс-эффект.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};
