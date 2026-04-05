import type { Patch } from 'immer';

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface Transaction {
  id: string;
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface PendingPatches {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface HistoryConfig {
  maxHistorySize: number;
  debounceMs: number;
  enabled: boolean;
}

export interface HistoryState {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  activeTransaction: Transaction | null;
  pendingPatches: PendingPatches | null;
  config: HistoryConfig;
}

export interface HistoryActions {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getUndoLabel: () => string | null;
  getRedoLabel: () => string | null;
  beginTransaction: (label: string) => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  clearHistory: () => void;
  setEnabled: (enabled: boolean) => void;
  _pushPatches: (label: string, patches: Patch[], inversePatches: Patch[]) => void;
  _flushPending: () => void;
}

export type HistoryStore = HistoryState & HistoryActions;

export const DEFAULT_CONFIG: HistoryConfig = {
  maxHistorySize: 100,
  debounceMs: 300,
  enabled: true,
};
