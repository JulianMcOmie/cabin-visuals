// IndexedDB-based storage for audio files
// Allows storing large audio files without localStorage limits

const DB_NAME = 'PatternComposerAudio';
const DB_VERSION = 1;
const STORE_NAME = 'audioFiles';

export interface StoredAudioFile {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  duration: number;
  sampleRate: number;
  waveformPeaks: number[];
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open audio database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create the audio files store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('fileName', 'fileName', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });

  return dbPromise;
}

// Store an audio file and return its ID
export async function storeAudioFile(
  id: string,
  blob: Blob,
  metadata: {
    fileName: string;
    mimeType: string;
    duration: number;
    sampleRate: number;
    waveformPeaks: number[];
  }
): Promise<string> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const audioFile: StoredAudioFile = {
      id,
      blob,
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      duration: metadata.duration,
      sampleRate: metadata.sampleRate,
      waveformPeaks: metadata.waveformPeaks,
      createdAt: Date.now(),
    };

    const request = store.put(audioFile);

    request.onsuccess = () => resolve(id);
    request.onerror = () => {
      console.error('Failed to store audio file:', request.error);
      reject(request.error);
    };
  });
}

// Get an audio file by ID
export async function getAudioFile(id: string): Promise<StoredAudioFile | null> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('Failed to get audio file:', request.error);
      reject(request.error);
    };
  });
}

// Delete an audio file by ID
export async function deleteAudioFile(id: string): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to delete audio file:', request.error);
      reject(request.error);
    };
  });
}

// Get all audio file IDs (for cleanup/debugging)
export async function getAllAudioFileIds(): Promise<string[]> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAllKeys();

    request.onsuccess = () => resolve(request.result as string[]);
    request.onerror = () => {
      console.error('Failed to get audio file IDs:', request.error);
      reject(request.error);
    };
  });
}

// Delete multiple audio files
export async function deleteAudioFiles(ids: string[]): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    let completed = 0;
    let hasError = false;

    for (const id of ids) {
      const request = store.delete(id);
      request.onsuccess = () => {
        completed++;
        if (completed === ids.length && !hasError) resolve();
      };
      request.onerror = () => {
        if (!hasError) {
          hasError = true;
          reject(request.error);
        }
      };
    }

    if (ids.length === 0) resolve();
  });
}

// Get storage usage stats
export async function getStorageStats(): Promise<{ count: number; totalSize: number }> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const files = request.result as StoredAudioFile[];
      const totalSize = files.reduce((sum, file) => sum + file.blob.size, 0);
      resolve({ count: files.length, totalSize });
    };
    request.onerror = () => {
      console.error('Failed to get storage stats:', request.error);
      reject(request.error);
    };
  });
}

// Create a blob URL for playback (caller must revoke when done)
export function createAudioBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

// Revoke a blob URL to free memory
export function revokeAudioBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}
