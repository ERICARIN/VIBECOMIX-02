import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  Film,
  Image as ImageIcon,
  Monitor,
  Sliders,
  Video,
  X,
} from 'lucide-react';
import { AppState } from '../types';
import {
  ExportOptions,
  exportToHtml,
  exportToImages,
  exportToVideoOrGif,
  isBrowserVideoFormatSupported,
} from '../utils/exporter';

interface ExportPanelProps {
  state: AppState;
  activeLayers: number | null; // Selected frame ID.
  onClose?: () => void;
}

const buttonOn = 'border-[#FF007A]/65 bg-[#FF007A]/20 text-white';
const buttonOff = 'border-transparent text-neutral-500 hover:text-white';

export const ExportPanel: React.FC<ExportPanelProps> = ({ state, activeLayers, onClose }) => {
  const [format, setFormat] = useState<ExportOptions['format']>('html');
  const [scope, setScope] = useState<ExportOptions['scope']>('current');
  const [imageFormat, setImageFormat] = useState<'png' | 'jpg'>('png');
  const [scale, setScale] = useState<ExportOptions['scale']>(1);
  const [jpgQuality, setJpgQuality] = useState(92);
  const [fps, setFps] = useState<ExportOptions['fps']>(24);
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<ExportOptions['resolution']>('1080p');
  const [bitrate, setBitrate] = useState<'low' | 'medium' | 'high'>('medium');
  const [htmlMode, setHtmlMode] = useState<NonNullable<ExportOptions['htmlMode']>>('arrows');

  const [isRendering, setIsRendering] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStatus, setProgressStatus] = useState('Ожидание...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const pageCount = state.pages.length;
  const currentPage = state.pages[state.currentPage];
  const selectedFrame = activeLayers === null
    ? undefined
    : currentPage?.frames.find((frame) => frame.id === activeLayers);
  const frameIsAvailable = Boolean(selectedFrame && !selectedFrame.hidden);
  const isVideo = format === 'webm' || format === 'mp4';
  const webmSupported = useMemo(() => isBrowserVideoFormatSupported('webm'), []);
  const mp4Supported = useMemo(() => isBrowserVideoFormatSupported('mp4'), []);
  const effectiveFps = Number(fps) || 24;
  const effectiveDuration = Number(duration) || 5;
  const animatedTargetCount = scope === 'all' ? pageCount : 1;
  const estimatedFrameCount = Math.round(effectiveFps * effectiveDuration) * animatedTargetCount;
  const frameLimit = format === 'gif' ? 600 : 3000;
  const exceedsFrameLimit = (format === 'gif' || isVideo) && estimatedFrameCount > frameLimit;
  const formatSupported = format === 'mp4' ? mp4Supported : format === 'webm' ? webmSupported : true;
  const canUseFrameScope = format !== 'html';

  useEffect(() => {
    if (format === 'html' && scope === 'frame') setScope('current');
  }, [format, scope]);

  useEffect(() => {
    if (format === 'gif' && resolution === '4k') setResolution('1080p');
  }, [format, resolution]);

  const handleExport = async () => {
    if (isRendering || !pageCount || !formatSupported || exceedsFrameLimit) return;
    if (scope === 'frame' && !frameIsAvailable) return;

    setIsRendering(true);
    setProgressPercent(0);
    setProgressStatus('Подготовка экспорта...');
    setErrorMessage(null);
    setSuccessMessage(null);

    const outputFormat = format === 'png' ? imageFormat : format;
    const options: ExportOptions = {
      format: outputFormat,
      scope,
      scale,
      jpgQuality,
      fps,
      duration,
      resolution,
      bitrate,
      selectedFrameId: scope === 'frame' ? activeLayers : null,
      htmlMode,
    };

    const onProgress = (update: { percent: number; status: string }) => {
      setProgressPercent(update.percent);
      setProgressStatus(update.status);
    };

    try {
      if (format === 'html') {
        await exportToHtml(state, options, onProgress);
        setSuccessMessage(`HTML-плеер (${scope === 'all' ? 'все листы' : 'текущий лист'}) сохранён.`);
      } else if (format === 'png' || format === 'sequence') {
        await exportToImages(state, options, onProgress);
        setSuccessMessage(scope === 'all' || format === 'sequence'
          ? 'ZIP-архив с PNG/JPG изображениями сохранён.'
          : 'Изображение сохранено.');
      } else {
        await exportToVideoOrGif(state, options, onProgress);
        setSuccessMessage(format === 'gif' ? 'Анимированный GIF сохранён.' : `Видео ${format.toUpperCase()} сохранено.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка экспорта.';
      setErrorMessage(message);
      setProgressStatus('Экспорт не завершён');
      console.error('Export failed:', error);
    } finally {
      setIsRendering(false);
    }
  };

  const formats: Array<{ id: ExportOptions['format']; tag: string; icon: React.ReactNode; disabled?: boolean; hint?: string }> = [
    { id: 'html', tag: 'HTML', icon: <Monitor size={13} /> },
    { id: 'png', tag: 'PNG / JPG', icon: <ImageIcon size={13} /> },
    { id: 'gif', tag: 'GIF', icon: <Film size={13} /> },
    { id: 'webm', tag: 'WEBM', icon: <Video size={13} />, disabled: !webmSupported, hint: 'WEBM недоступен в этом браузере' },
    { id: 'mp4', tag: 'MP4', icon: <Video size={13} />, disabled: !mp4Supported, hint: 'Этот браузер не поддерживает настоящий MP4; выберите WEBM' },
    { id: 'sequence', tag: 'ZIP', icon: <Archive size={13} /> },
  ];

  return (
    <div className="flex h-full flex-1 select-none flex-col border-l border-[#3A3228] bg-[#141210]" id="export-panel-root">
      <div className="flex shrink-0 items-center justify-between border-b border-[#3A3228] bg-[#110e0c] p-3">
        <span className="flex items-center gap-1.5 font-['Unbounded'] text-[10px] font-black uppercase tracking-wider text-white">
          <Sliders className="text-[#FF007A]" size={12} /> Экспорт и вывод
        </span>
        {onClose && (
          <button
            type="button"
            disabled={isRendering}
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-[#7A7470] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Закрыть панель"
            aria-label="Закрыть панель экспорта"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex-1 divide-y divide-[#3A3228]/45 overflow-y-auto">
        <section className="space-y-2 p-3">
          <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Формат файла</span>
          <div className="grid grid-cols-3 gap-1 rounded border border-[#3A3228] bg-black/45 p-1">
            {formats.map((item) => {
              const selected = format === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled || isRendering}
                  onClick={() => {
                    setFormat(item.id);
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`flex min-h-[48px] cursor-pointer flex-col items-center justify-center gap-1 rounded border px-1 py-1.5 font-mono text-[8px] font-bold uppercase transition disabled:cursor-not-allowed disabled:opacity-30 ${selected ? buttonOn : buttonOff}`}
                  title={item.hint || item.tag}
                  aria-pressed={selected}
                >
                  <span className={selected ? 'text-[#FF007A]' : 'text-neutral-500'}>{item.icon}</span>
                  <span className="whitespace-nowrap">{item.tag}</span>
                </button>
              );
            })}
          </div>
          {!mp4Supported && (
            <p className="text-[9px] leading-relaxed text-neutral-500">MP4 недоступен в этом браузере и отключён; WEBM будет сохранён только как WEBM.</p>
          )}
          {!webmSupported && (
            <p className="text-[9px] leading-relaxed text-amber-300">WEBM недоступен: MediaRecorder не поддерживает этот контейнер в браузере.</p>
          )}
        </section>

        {format === 'html' && (
          <section className="space-y-2 p-3">
            <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Режим чтения</span>
            <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
              {[
                { id: 'scroll', label: 'Лента' },
                { id: 'slide', label: 'Слайды' },
                { id: 'arrows', label: 'Стрелки' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={isRendering}
                  onClick={() => setHtmlMode(item.id as NonNullable<ExportOptions['htmlMode']>)}
                  className={`flex-1 rounded border py-1.5 font-mono text-[8px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${htmlMode === item.id ? buttonOn : buttonOff}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-[9px] leading-relaxed text-neutral-500">Изображения встраиваются в HTML, чтобы плеер открывался без исходных файлов.</p>
          </section>
        )}

        {(format === 'png' || format === 'sequence') && (
          <section className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Тип изображения</span>
                <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
                  {(['png', 'jpg'] as const).map((ext) => (
                    <button
                      key={ext}
                      type="button"
                      disabled={format === 'sequence' || isRendering}
                      onClick={() => setImageFormat(ext)}
                      className={`flex-1 rounded border py-1 font-mono text-[8px] font-bold uppercase transition disabled:cursor-not-allowed disabled:opacity-40 ${imageFormat === ext && format !== 'sequence' ? buttonOn : buttonOff}`}
                    >
                      {format === 'sequence' ? 'PNG' : ext}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Масштаб</span>
                <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
                  {([1, 2, 4] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={isRendering}
                      onClick={() => setScale(value)}
                      className={`flex-1 rounded border py-1 font-mono text-[8px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${scale === value ? buttonOn : buttonOff}`}
                    >
                      {value}×
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {imageFormat === 'jpg' && format !== 'sequence' && (
              <label className="block space-y-1.5">
                <span className="flex justify-between font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">
                  <span>Качество JPG</span><span className="text-white">{jpgQuality}%</span>
                </span>
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  disabled={isRendering}
                  value={jpgQuality}
                  onChange={(event) => setJpgQuality(Number(event.target.value))}
                  className="w-full accent-[#FF007A]"
                />
              </label>
            )}
            {scope === 'all' && (
              <p className="text-[9px] leading-relaxed text-neutral-400">Все листы сохраняются одним ZIP-архивом с исходными номерами страниц.</p>
            )}
          </section>
        )}

        {(format === 'gif' || isVideo) && (
          <section className="space-y-3 p-3">
            <div className="space-y-1.5">
              <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Длинная сторона кадра</span>
              <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
                {[
                  { id: '720p', label: '720p' },
                  { id: '1080p', label: '1080p' },
                  { id: '4k', label: '4K' },
                ].map((item) => {
                  const disabled = format === 'gif' && item.id === '4k';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={disabled || isRendering}
                      onClick={() => setResolution(item.id as ExportOptions['resolution'])}
                      className={`flex-1 rounded border py-1.5 font-mono text-[8px] font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${resolution === item.id ? buttonOn : buttonOff}`}
                      title={disabled ? 'GIF ограничен 1080p для контроля памяти браузера' : item.label}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {isVideo && (
              <div className="space-y-1.5">
                <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Битрейт видео</span>
                <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
                  {[
                    { id: 'low', label: '2 Мбит/с' },
                    { id: 'medium', label: '8 Мбит/с' },
                    { id: 'high', label: '25 Мбит/с' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={isRendering}
                      onClick={() => setBitrate(item.id as 'low' | 'medium' | 'high')}
                      className={`flex-1 rounded border py-1.5 font-mono text-[7px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${bitrate === item.id ? buttonOn : buttonOff}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 border-t border-[#3A3228]/40 pt-2">
              <div className="space-y-1.5">
                <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Кадров в секунду</span>
                <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
                  {([12, 24, 30] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={isRendering}
                      onClick={() => setFps(value)}
                      className={`flex-1 rounded border py-1.5 font-mono text-[8px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${fps === value ? buttonOn : buttonOff}`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">
                  {scope === 'all' ? 'Секунд на лист' : 'Длительность ролика'}
                </span>
                <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
                  {([2, 5, 10] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={isRendering}
                      onClick={() => setDuration(value)}
                      className={`flex-1 rounded border py-1.5 font-mono text-[8px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${duration === value ? buttonOn : buttonOff}`}
                    >
                      {value}s
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[9px] leading-relaxed text-neutral-500">
              {scope === 'all'
                ? `Каждый лист показывается ${duration} с. Итог: ${duration * pageCount} с, ${estimatedFrameCount} кадров.`
                : `${estimatedFrameCount} кадров. Параллакс и включённые шумовые модификаторы анимируются.`}
            </p>
            {exceedsFrameLimit && (
              <p className="flex items-start gap-1 text-[9px] leading-relaxed text-amber-300">
                <AlertTriangle className="mt-0.5 shrink-0" size={11} />
                Превышен лимит {frameLimit} кадров. Уменьшите FPS/длительность или выберите меньше листов.
              </p>
            )}
          </section>
        )}

        <section className="space-y-2 p-3">
          <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-[#7A7470]">Область экспорта</span>
          <div className="flex gap-1 rounded border border-[#3A3228] bg-black/45 p-0.5">
            {[
              { id: 'all', label: 'Все листы' },
              { id: 'current', label: 'Текущий' },
              { id: 'frame', label: 'Фрейм' },
            ].map((item) => {
              const isDisabled = isRendering || (item.id === 'frame' && !canUseFrameScope);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    setScope(item.id as ExportOptions['scope']);
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`flex-1 rounded border py-1.5 font-mono text-[8px] font-bold transition disabled:cursor-not-allowed disabled:opacity-25 ${scope === item.id ? buttonOn : buttonOff}`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {scope === 'frame' && (
            <div className="rounded border border-[#3A3228] bg-black/30 px-2 py-1.5 text-center font-mono text-[8px] text-neutral-400">
              {frameIsAvailable
                ? <>Выбран фрейм <b className="text-[#FF007A]">#{selectedFrame!.id}{selectedFrame!.name ? ` · ${selectedFrame!.name}` : ''}</b></>
                : <span className="text-amber-300">Выберите видимый фрейм на текущем листе</span>}
            </div>
          )}
          {format === 'html' && scope === 'all' && (
            <p className="text-[9px] leading-relaxed text-neutral-500">HTML-плеер содержит все листы и начинает с текущего. Для одного фрейма используйте PNG/JPG.</p>
          )}
        </section>

        <section className="space-y-2 p-3">
          <button
            type="button"
            disabled={isRendering || !pageCount || !formatSupported || exceedsFrameLimit || (scope === 'frame' && !frameIsAvailable)}
            onClick={handleExport}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded border border-[#FFDCF4]/10 bg-[#FF007A] py-2.5 font-['Unbounded'] text-[9px] font-bold uppercase tracking-wide text-white shadow-[0_0_12px_rgba(255,0,122,0.22)] transition hover:bg-[#ff229c] hover:shadow-[0_0_20px_rgba(255,0,122,0.45)] disabled:pointer-events-none disabled:opacity-30"
          >
            <Download size={13} />
            {isRendering ? 'ЭКСПОРТ...' : 'ЭКСПОРТИРОВАТЬ'}
          </button>
          {!pageCount && <p className="text-[9px] text-amber-300">В проекте пока нет листов.</p>}
        </section>
      </div>

      {isRendering && (
        <div className="shrink-0 space-y-1.5 border-t border-[#3A3228] bg-[#110e0c]/80 p-3 font-mono text-[8px]" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-neutral-400">
            <span className="animate-pulse font-bold uppercase tracking-wide text-[#FF007A]">{progressStatus}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded bg-black">
            <div className="h-full bg-[#FF007A] transition-all duration-200" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}
      {errorMessage && (
        <div className="flex shrink-0 items-start gap-2 border-t border-red-900/70 bg-red-950/30 p-3 text-[9px] leading-relaxed text-red-200" role="alert">
          <AlertTriangle className="mt-0.5 shrink-0 text-red-300" size={13} />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && !isRendering && (
        <div className="flex shrink-0 items-start gap-2 border-t border-emerald-900/50 bg-emerald-950/20 p-3 text-[9px] leading-relaxed text-emerald-200" role="status">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={13} />
          <span>{successMessage}</span>
        </div>
      )}
    </div>
  );
};
