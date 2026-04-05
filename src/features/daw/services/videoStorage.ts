// IndexedDB-based storage for video files

const DB_NAME = 'PatternComposerVideos';
const DB_VERSION = 1;
const STORE_NAME = 'videoFiles';

export interface StoredVideoFile {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  duration: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open video database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('fileName', 'fileName', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });

  return dbPromise;
}

export async function storeVideoFile(
  id: string,
  blob: Blob,
  metadata: {
    fileName: string;
    mimeType: string;
    width: number;
    height: number;
    duration: number;
  }
): Promise<string> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const videoFile: StoredVideoFile = {
      id,
      blob,
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      createdAt: Date.now(),
    };

    const request = store.put(videoFile);

    request.onsuccess = () => resolve(id);
    request.onerror = () => {
      console.error('Failed to store video file:', request.error);
      reject(request.error);
    };
  });
}

export async function getVideoFile(id: string): Promise<StoredVideoFile | null> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('Failed to get video file:', request.error);
      reject(request.error);
    };
  });
}

export async function deleteVideoFile(id: string): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to delete video file:', request.error);
      reject(request.error);
    };
  });
}
