import { AppState } from '../types';

export const PROJECT_FILE_EXTENSION = '.vibeco';
export const PROJECT_FORMAT_ID = 'vibecomix-project';
export const PROJECT_FORMAT_VERSION = 1;

interface ProjectEnvelope {
  format: typeof PROJECT_FORMAT_ID;
  version: number;
  savedAt: string;
  state: AppState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validate the structural parts that the editor requires before accepting a file.
 * Unknown optional fields are deliberately preserved for forward compatibility.
 */
export function validateProjectState(value: unknown): AppState {
  if (!isRecord(value)) {
    throw new Error('Файл проекта не содержит корректного документа.');
  }

  const candidate = value as Partial<AppState>;
  if (!isFinitePositiveNumber(candidate.width) || !isFinitePositiveNumber(candidate.height)) {
    throw new Error('В файле указаны некорректные размеры страницы.');
  }
  if (!Array.isArray(candidate.pages) || candidate.pages.length === 0) {
    throw new Error('В файле проекта нет страниц.');
  }

  const pages = candidate.pages.map((page, pageIndex) => {
    if (!isRecord(page) || !Array.isArray(page.frames)) {
      throw new Error(`Страница ${pageIndex + 1} имеет неверный формат.`);
    }

    const frames = page.frames.map((frame, frameIndex) => {
      if (!isRecord(frame) || !Array.isArray(frame.layers)) {
        throw new Error(`Кадр ${frameIndex + 1} на странице ${pageIndex + 1} имеет неверный формат.`);
      }
      if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y) ||
          !Number.isFinite(frame.w) || !Number.isFinite(frame.h)) {
        throw new Error(`У кадра ${frameIndex + 1} на странице ${pageIndex + 1} некорректная геометрия.`);
      }
      for (const [layerIndex, layer] of frame.layers.entries()) {
        if (!isRecord(layer) || typeof layer.src !== 'string') {
          throw new Error(`Слой ${layerIndex + 1} в кадре ${frameIndex + 1} не содержит изображения.`);
        }
      }
      return frame;
    });

    return { ...page, frames } as AppState['pages'][number];
  });

  const currentPage = Number.isInteger(candidate.currentPage) ? candidate.currentPage! : 0;

  return {
    ...candidate,
    width: candidate.width,
    height: candidate.height,
    currentPage: Math.max(0, Math.min(currentPage, pages.length - 1)),
    pages,
  } as AppState;
}

export function serializeProjectFile(state: AppState): string {
  const envelope: ProjectEnvelope = {
    format: PROJECT_FORMAT_ID,
    version: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    state,
  };
  // Compact output keeps projects with embedded raster layers smaller.
  return JSON.stringify(envelope);
}

export function parseProjectFile(contents: string): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Не удалось прочитать файл: это не корректный JSON-проект VIBECOMIX.');
  }

  if (!isRecord(parsed)) {
    throw new Error('Файл проекта имеет неверный формат.');
  }

  if (parsed.format === PROJECT_FORMAT_ID) {
    if (parsed.version !== PROJECT_FORMAT_VERSION) {
      throw new Error(`Эта версия проекта (${String(parsed.version)}) пока не поддерживается.`);
    }
    return validateProjectState(parsed.state);
  }

  // Import the pre-envelope state format used by earlier VIBECOMIX builds.
  return validateProjectState(parsed);
}

export function downloadProjectFile(state: AppState): void {
  const content = serializeProjectFile(state);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `VIBECOMIX-${new Date().toISOString().slice(0, 10)}${PROJECT_FILE_EXTENSION}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
