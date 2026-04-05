// IndexedDB-based storage for image files

const DB_NAME = 'PatternComposerImages';
const DB_VERSION = 1;
const STORE_NAME = 'imageFiles';

export interface StoredImageFile {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open image database:', request.error);
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

export async function storeImageFile(
  id: string,
  blob: Blob,
  metadata: {
    fileName: string;
    mimeType: string;
    width: number;
    height: number;
  }
): Promise<string> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const imageFile: StoredImageFile = {
      id,
      blob,
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      width: metadata.width,
      height: metadata.height,
      createdAt: Date.now(),
    };

    const request = store.put(imageFile);

    request.onsuccess = () => resolve(id);
    request.onerror = () => {
      console.error('Failed to store image file:', request.error);
      reject(request.error);
    };
  });
}

export async function getImageFile(id: string): Promise<StoredImageFile | null> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      console.error('Failed to get image file:', request.error);
      reject(request.error);
    };
  });
}

export async function deleteImageFile(id: string): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Failed to delete image file:', request.error);
      reject(request.error);
    };
  });
}
