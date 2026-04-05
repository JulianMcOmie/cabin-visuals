import { create } from 'zustand';
import { applyPatches, type Patch } from 'immer';
import { generateId } from '@daw/utils/id';
import {
  type HistoryStore,
  type HistoryEntry,
  type Transaction,
  DEFAULT_CONFIG,
} from './types';

// Store reference to be set by middleware
let targetStoreRef: {
  getState: () => { project: unknown };
  setState: (state: unknown) => void;
} | null = null;

export function setTargetStore(store: typeof targetStoreRef) {
  targetStoreRef = store;
}

export const useHistoryStore = create<HistoryStore>()((set, get) => ({
  undoStack: [],
  redoStack: [],
  activeTransaction: null,
  pendingPatches: null,
  config: DEFAULT_CONFIG,

  undo: () => {
    const state = get();
    if (!state.config.enabled || state.undoStack.length === 0 || !targetStoreRef) {
      return;
    }

    // Flush any pending patches first
    get()._flushPending();

    const entry = state.undoStack[state.undoStack.length - 1];

    // Apply inverse patches to restore previous state
    const currentState = targetStoreRef.getState();
    const newState = applyPatches(currentState, entry.inversePatches);
    targetStoreRef.setState(newState);

    // Move entry from undo to redo stack
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, entry],
    }));
  },

  redo: () => {
    const state = get();
    if (!state.config.enabled || state.redoStack.length === 0 || !targetStoreRef) {
      return;
    }

    // Flush any pending patches first
    get()._flushPending();

    const entry = state.redoStack[state.redoStack.length - 1];

    // Apply forward patches to restore next state
    const currentState = targetStoreRef.getState();
    const newState = applyPatches(currentState, entry.patches);
    targetStoreRef.setState(newState);

    // Move entry from redo to undo stack
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, entry],
    }));
  },

  canUndo: () => {
    const state = get();
    return state.config.enabled && (state.undoStack.length > 0 || state.pendingPatches !== null);
  },

  canRedo: () => {
    const state = get();
    return state.config.enabled && state.redoStack.length > 0;
  },

  getUndoLabel: () => {
    const state = get();
    if (state.pendingPatches) {
      return state.pendingPatches.label;
    }
    if (state.undoStack.length === 0) {
      return null;
    }
    return state.undoStack[state.undoStack.length - 1].label;
  },

  getRedoLabel: () => {
    const state = get();
    if (state.redoStack.length === 0) {
      return null;
    }
    return state.redoStack[state.redoStack.length - 1].label;
  },

  beginTransaction: (label: string) => {
    // Flush pending patches first
    get()._flushPending();

    const transaction: Transaction = {
      id: generateId(),
      label,
      patches: [],
      inversePatches: [],
    };

    set({ activeTransaction: transaction });
  },

  commitTransaction: () => {
    const state = get();
    if (!state.activeTransaction) {
      return;
    }

    const { activeTransaction } = state;

    // Only push if there are actual patches
    if (activeTransaction.patches.length > 0) {
      const entry: HistoryEntry = {
        id: activeTransaction.id,
        label: activeTransaction.label,
        timestamp: Date.now(),
        patches: activeTransaction.patches,
        inversePatches: activeTransaction.inversePatches,
      };

      set((s) => {
        const newUndoStack = [...s.undoStack, entry];
        // Prune if exceeding max size
        if (newUndoStack.length > s.config.maxHistorySize) {
          newUndoStack.shift();
        }
        return {
          undoStack: newUndoStack,
          redoStack: [], // Clear redo stack on new change
          activeTransaction: null,
        };
      });
    } else {
      set({ activeTransaction: null });
    }
  },

  abortTransaction: () => {
    const state = get();
    if (!state.activeTransaction || !targetStoreRef) {
      set({ activeTransaction: null });
      return;
    }

    // Roll back any changes made during transaction
    if (state.activeTransaction.inversePatches.length > 0) {
      const currentState = targetStoreRef.getState();
      const newState = applyPatches(currentState, state.activeTransaction.inversePatches);
      targetStoreRef.setState(newState);
    }

    set({ activeTransaction: null });
  },

  clearHistory: () => {
    // Cancel any pending debounce
    const state = get();
    if (state.pendingPatches) {
      clearTimeout(state.pendingPatches.timeoutId);
    }

    set({
      undoStack: [],
      redoStack: [],
      activeTransaction: null,
      pendingPatches: null,
    });
  },

  setEnabled: (enabled: boolean) => {
    if (!enabled) {
      // Flush pending when disabling
      get()._flushPending();
    }
    set((s) => ({
      config: { ...s.config, enabled },
    }));
  },

  _pushPatches: (label: string, patches: Patch[], inversePatches: Patch[]) => {
    const state = get();

    if (!state.config.enabled) {
      return;
    }

    // If in a transaction, accumulate patches
    if (state.activeTransaction) {
      set((s) => ({
        activeTransaction: s.activeTransaction
          ? {
              ...s.activeTransaction,
              patches: [...s.activeTransaction.patches, ...patches],
              inversePatches: [...inversePatches, ...s.activeTransaction.inversePatches],
            }
          : null,
      }));
      return;
    }

    // Debounce logic for rapid changes
    if (state.pendingPatches) {
      // Cancel existing timeout
      clearTimeout(state.pendingPatches.timeoutId);

      // Accumulate patches
      const timeoutId = setTimeout(() => {
        get()._flushPending();
      }, state.config.debounceMs);

      set((s) => ({
        pendingPatches: s.pendingPatches
          ? {
              label: s.pendingPatches.label, // Keep original label
              patches: [...s.pendingPatches.patches, ...patches],
              inversePatches: [...inversePatches, ...s.pendingPatches.inversePatches],
              timeoutId,
            }
          : null,
        redoStack: [], // Clear redo on new change
      }));
    } else {
      // Start new pending batch
      const timeoutId = setTimeout(() => {
        get()._flushPending();
      }, state.config.debounceMs);

      set({
        pendingPatches: {
          label,
          patches,
          inversePatches,
          timeoutId,
        },
        redoStack: [], // Clear redo on new change
      });
    }
  },

  _flushPending: () => {
    const state = get();
    if (!state.pendingPatches) {
      return;
    }

    const { pendingPatches } = state;
    clearTimeout(pendingPatches.timeoutId);

    const entry: HistoryEntry = {
      id: generateId(),
      label: pendingPatches.label,
      timestamp: Date.now(),
      patches: pendingPatches.patches,
      inversePatches: pendingPatches.inversePatches,
    };

    set((s) => {
      const newUndoStack = [...s.undoStack, entry];
      // Prune if exceeding max size
      if (newUndoStack.length > s.config.maxHistorySize) {
        newUndoStack.shift();
      }
      return {
        undoStack: newUndoStack,
        pendingPatches: null,
      };
    });
  },
}));
