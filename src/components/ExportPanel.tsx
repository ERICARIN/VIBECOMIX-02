/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppState } from '../types';
import { 
  Download, 
  Eye, 
  X,
  Monitor,
  Image as ImageIcon,
  Film,
  Video,
  Archive,
  Sliders
} from 'lucide-react';
import { ExportOptions, exportToHtml, exportToImages, exportToVideoOrGif } from '../utils/exporter';

interface ExportPanelProps {
  state: AppState;
  activeLayers: number | null; // active frame ID
  onClose?: () => void;
}

export const ExportPanel: React.FC<ExportPanelProps> = ({ state, activeLayers, onClose }) => {
  // 1. Core export parameters
  const [format, setFormat] = useState<ExportOptions['format']>('html');
  const [scope, setScope] = useState<ExportOptions['scope']>('current');
  const [scale, setScale] = useState<ExportOptions['scale']>(1);
  const [jpgQuality] = useState<number>(95);
  const [fps, setFps] = useState<ExportOptions['fps']>(24);
  const [duration, setDuration] = useState<number>(5);
  const [resolution, setResolution] = useState<ExportOptions['resolution']>('1080p');
  const [bitrate, setBitrate] = useState<'low' | 'medium' | 'high'>('medium');
  const [imageFormat, setImageFormat] = useState<'png' | 'jpg'>('png');
  const [htmlMode, setHtmlMode] = useState<'scroll' | 'slide' | 'arrows'>('arrows');

  // Adjust scope options depending on format
  useEffect(() => {
    if (format !== 'png' && format !== 'gif' && format !== 'video' && scope === 'frame') {
      setScope('current');
    }
  }, [format, scope]);

  // Page index target
  const [targetPageIdx] = useState<number>(state.currentPage);

  // Loading & Progress states
  const [isRendering, setIsRendering] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStatus, setProgressStatus] = useState('Ожидание...');

  const handleExportSubmit = async () => {
    if (isRendering) return;
    setIsRendering(true);
    setProgressPercent(0);
    setProgressStatus('Инициализация...');

    const activeFormat = (format === 'png' || format === 'jpg') ? imageFormat : format;

    const options: ExportOptions = {
      format: activeFormat,
      scope,
      scale,
      jpgQuality,
      fps,
      duration,
      resolution,
      bitrate,
      selectedFrameId: scope === 'frame' ? activeLayers : null,
      htmlMode
    };

    try {
      if (format === 'html') {
        await exportToHtml(state, options, (update) => {
          setProgressPercent(update.percent);
          setProgressStatus(update.status);
        });
      } else if (format === 'png' || format === 'sequence') {
        const scopedState = { ...state };
        scopedState.currentPage = targetPageIdx;

        await exportToImages(scopedState, options, (update) => {
          setProgressPercent(update.percent);
          setProgressStatus(update.status);
        });
      } else {
        // GIF / MP4 Video Rendering
        await exportToVideoOrGif(state, options, (update) => {
          setProgressPercent(update.percent);
          setProgressStatus(update.status);
        });
      }
    } catch (err) {
      console.error(err);
      setProgressStatus('Ошибка рендеринга');
    } finally {
      setIsRendering(false);
    }
  };

  const handlePreview = () => {
    if (isRendering) return;
    setIsRendering(true);
    setProgressPercent(0);
    setProgressStatus('Рендер превью...');
    
    setTimeout(() => {
      setProgressPercent(100);
      setProgressStatus('Превью готово!');
      setIsRendering(false);
    }, 1000);
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#141210] border-l border-[#3A3228] select-none" id="export-panel-root">
      
      {/* Mini Header block */}
      <div className="p-3 bg-[#110e0c] border-b border-[#3A3228] flex items-center justify-between shrink-0">
        <span className="font-['Unbounded'] font-black text-[10px] text-white uppercase tracking-wider flex items-center gap-1.5">
          <Sliders className="text-[#FF007A]" size={11} />
          Экспорт и Вывод
        </span>
        {onClose && (
          <button 
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#7A7470] hover:text-white transition cursor-pointer"
            title="Закрыть панель"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Simplified controls stack */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#3A3228]/45">

        {/* 1. Format Choice Strip with custom minimal design - NO solid pink overlays */}
        <div className="p-3 space-y-2">
          <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
            Формат вывода
          </span>
          <div className="grid grid-cols-5 gap-1 bg-black/45 p-1 rounded border border-[#3A3228]">
            {[
              { id: 'html', tag: 'HTML', icon: <Monitor size={11} /> },
              { id: 'png', tag: 'PNG', icon: <ImageIcon size={11} /> },
              { id: 'gif', tag: 'GIF', icon: <Film size={11} /> },
              { id: 'video', tag: 'MP4', icon: <Video size={11} /> },
              { id: 'sequence', tag: 'ZIP', icon: <Archive size={11} /> },
            ].map((item) => {
              const isSelected = format === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFormat(item.id as any)}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded border text-center font-mono text-[8.5px] font-bold uppercase transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'border-[#FF007A] bg-[#FF007A]/15 text-white shadow-[0_0_8px_rgba(255,0,122,0.15)]'
                      : 'border-transparent bg-transparent text-neutral-400 hover:text-white'
                  }`}
                  title={item.tag}
                >
                  <div className={`mb-1 transition-transform ${isSelected ? 'text-[#FF007A] scale-110' : 'text-neutral-500'}`}>
                    {item.icon}
                  </div>
                  <span>{item.tag}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Mode dependent options */}
        {format === 'html' && (
          <div className="p-3 space-y-2">
            <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
              Режим чтения
            </span>
            <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
              {[
                { id: 'scroll', tag: 'Веб-Лента' },
                { id: 'slide', tag: 'Слайды' },
                { id: 'arrows', tag: 'Стрелки' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setHtmlMode(item.id as any)}
                  className={`flex-1 py-1.5 rounded text-center font-mono text-[8px] font-bold transition-all duration-100 cursor-pointer ${
                    htmlMode === item.id
                      ? 'bg-[#FF007A]/15 text-white border border-[#FF007A]/50 shadow-[0_0_8px_rgba(255,0,122,0.12)]'
                      : 'text-neutral-450 hover:text-white border border-transparent'
                  }`}
                >
                  {item.tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {(format === 'png' || format === 'sequence') && (
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
                  Тип файла
                </span>
                <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
                  {['png', 'jpg'].map((ext) => (
                    <button
                      key={ext}
                      type="button"
                      disabled={format === 'sequence'}
                      onClick={() => setImageFormat(ext as any)}
                      className={`flex-1 py-1 rounded text-center font-mono text-[8px] font-bold uppercase transition-all duration-100 disabled:opacity-20 cursor-pointer ${
                        imageFormat === ext && format !== 'sequence'
                          ? 'bg-[#FF007A]/20 text-white border border-[#FF007A]/60'
                          : 'text-neutral-500 hover:text-white border border-transparent'
                      }`}
                    >
                      {format === 'sequence' ? 'png' : ext}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
                  Масштаб (Вывод)
                </span>
                <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
                  {([1, 2, 4] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScale(s)}
                      className={`flex-1 py-1 rounded text-center font-mono text-[8px] font-bold transition-all duration-100 cursor-pointer ${
                        scale === s
                          ? 'bg-[#FF007A]/20 text-white border border-[#FF007A]/60'
                          : 'text-neutral-500 hover:text-white border border-transparent'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {(format === 'gif' || format === 'video') && (
          <div className="p-3 space-y-4">
            
            {/* Resolution Block */}
            <div className="space-y-1.5">
              <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
                Разрешение экспорта
              </span>
              <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
                {[
                  { id: '720p', label: '720p' },
                  { id: '1080p', label: '1080p (FHD)' },
                  { id: '4k', label: '4K (Ultra)' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setResolution(item.id as any)}
                    className={`flex-1 py-1.5 rounded text-center font-mono text-[8px] font-bold transition-all duration-100 cursor-pointer ${
                      resolution === item.id
                        ? 'bg-[#FF007A]/20 text-white border border-[#FF007A]/65 shadow-[0_0_8px_rgba(255,0,122,0.12)]'
                        : 'text-neutral-500 hover:text-white border border-transparent'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality and Bitrate Selector (Only for MP4) */}
            {format === 'video' && (
              <div className="space-y-1.5">
                <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
                  Качество Битрейта
                </span>
                <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
                  {[
                    { id: 'low', label: 'Eco (2M)' },
                    { id: 'medium', label: 'Normal (8M)' },
                    { id: 'high', label: 'Ultra (25M)' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setBitrate(item.id as any)}
                      className={`flex-1 py-1.5 rounded text-center font-mono text-[8px] font-bold transition-all duration-100 cursor-pointer ${
                        bitrate === item.id
                          ? 'bg-[#FF007A]/20 text-white border border-[#FF007A]/65'
                          : 'text-neutral-550 hover:text-white border border-transparent'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#3A3228]/25">
              <div className="space-y-1.5">
                <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
                  Кадры (FPS)
                </span>
                <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
                  {([12, 24, 30] as const).map((fRate) => (
                    <button
                      key={fRate}
                      type="button"
                      onClick={() => setFps(fRate)}
                      className={`flex-1 py-1.5 rounded text-center font-mono text-[8.5px] font-bold transition-all duration-100 cursor-pointer ${
                        fps === fRate
                          ? 'bg-[#FF007A]/20 text-white border border-[#FF007A]/50'
                          : 'text-[#7A7470] hover:text-white border border-transparent'
                      }`}
                    >
                      {fRate}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
                  Время (с)
                </span>
                <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
                  {([2, 5, 10] as const).map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setDuration(sec)}
                      className={`flex-1 py-1.5 rounded text-center font-mono text-[8.5px] font-bold transition-all duration-100 cursor-pointer ${
                        duration === sec
                          ? 'bg-[#FF007A]/20 text-white border border-[#FF007A]/50'
                          : 'text-[#7A7470] hover:text-white border border-transparent'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Scope selection */}
        <div className="p-3 space-y-2">
          <span className="font-mono text-[8px] text-[#7A7470] font-bold uppercase tracking-wider block">
            Диапазон экспорта
          </span>
          <div className="flex gap-1 bg-black/45 p-0.5 rounded border border-[#3A3228]">
            {[
              { id: 'all', tag: 'Все листы' },
              { id: 'current', tag: 'Текущий лист' },
              { id: 'frame', tag: 'Фрейм' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.id === 'frame' && (format !== 'png' && format !== 'gif' && format !== 'video')}
                onClick={() => setScope(item.id as any)}
                className={`flex-1 py-1.5 rounded text-center font-mono text-[8px] font-bold transition-all duration-100 disabled:opacity-20 cursor-pointer ${
                  scope === item.id
                    ? 'bg-[#FF007A]/20 text-white border border-[#FF007A]/50 shadow-[0_0_8px_rgba(255,0,122,0.12)]'
                    : 'text-neutral-500 hover:text-white border border-transparent'
                }`}
              >
                {item.tag}
              </button>
            ))}
          </div>

          {scope === 'frame' && (
            <div className="p-1.5 px-2 rounded bg-black/30 border border-[#3A3228] text-center font-mono text-[8px] text-neutral-400">
              {activeLayers !== null ? (
                <span>Выбран фрейм <b className="text-[#FF007A]"># {activeLayers}</b></span>
              ) : (
                <span className="text-[#FF9F1C]">⚠️ Выберите фрейм кликом на листе</span>
              )}
            </div>
          )}
        </div>

        {/* 4. Actuating Row with clean icons only */}
        <div className="p-3 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isRendering || (scope === 'frame' && activeLayers === null)}
              onClick={handleExportSubmit}
              className="flex-1 py-2.5 rounded bg-[#FF007A] hover:bg-[#ff229c] text-white font-bold font-['Unbounded'] text-[9.5px] uppercase tracking-wide border border-[#FFDCF4]/10 transition-all duration-150 shadow-[0_0_12px_rgba(255,0,122,0.22)] hover:shadow-[0_0_20px_rgba(255,0,122,0.45)] cursor-pointer disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-1.5"
            >
              <Download size={12} />
              <span>ЭКСПОРТИРОВАТЬ</span>
            </button>

            <button
              type="button"
              disabled={isRendering}
              onClick={handlePreview}
              className="px-3 rounded bg-black/40 hover:bg-neutral-900 border border-[#3A3228] text-neutral-400 hover:text-white transition-all cursor-pointer flex items-center justify-center"
              title="Быстрый превью-рендер структуры"
            >
              <Eye size={13} />
            </button>
          </div>
        </div>

      </div>

      {/* Progress feedback strip */}
      {isRendering && (
        <div className="p-3 bg-[#110e0c]/80 border-t border-[#3A3228] space-y-1.5 font-mono text-[8px] shrink-0">
          <div className="flex justify-between items-center text-neutral-400">
            <span className="text-[#FF007A] font-bold uppercase tracking-wide animate-pulse">{progressStatus}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-black h-1 rounded overflow-hidden">
            <div className="bg-[#FF007A] h-full transition-all duration-200" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}

    </div>
  );
};
