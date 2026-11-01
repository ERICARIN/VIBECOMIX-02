import { AppState } from '../types';
import { validateProjectState } from './projectFiles';

const DB_NAME = 'vibecomix-local-projects';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const AUTOSAVE_KEY = 'current-working-copy';
export const LEGACY_LOCAL_STORAGE_KEY = 'vibeco_app_state_v1';

function openProjectDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB недоступен в этом браузере.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть локальное хранилище.'));
    request.onblocked = () => reject(new Error('Закройте другие вкладки редактора и повторите попытку.'));
  });
}

export async function loadAutosave(): Promise<AppState | null> {
  const database = await openProjectDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(AUTOSAVE_KEY);
      request.onsuccess = () => {
        if (request.result === undefined) {
          resolve(null);
          return;
        }
        try {
          resolve(validateProjectState(request.result));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error || new Error('Не удалось прочитать автосохранение.'));
      transaction.onabort = () => reject(transaction.error || new Error('Чтение автосохранения было прервано.'));
    });
  } finally {
    database.close();
  }
}

export async function saveAutosave(state: AppState): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    // Fallback for unusual browsers. IndexedDB is preferred because it is
    // asynchronous and has a much larger quota than localStorage.
    localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, JSON.stringify(state));
    return;
  }

  const database = await openProjectDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(state, AUTOSAVE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Не удалось сохранить автосохранение.'));
      transaction.onabort = () => reject(transaction.error || new Error('Сохранение автосохранения было прервано.'));
    });
    try {
      localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    } catch {
      // The IndexedDB copy is already safe; localStorage cleanup is best-effort.
    }
  } finally {
    database.close();
  }
}
