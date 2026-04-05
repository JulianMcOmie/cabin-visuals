'use client';

import { useHistoryStore } from '@daw/stores/history';

export function UndoRedoButtons() {
  // Subscribe to the actual state that determines canUndo/canRedo
  const undoStackLength = useHistoryStore((state) => state.undoStack.length);
  const redoStackLength = useHistoryStore((state) => state.redoStack.length);
  const hasPendingPatches = useHistoryStore((state) => state.pendingPatches !== null);
  const enabled = useHistoryStore((state) => state.config.enabled);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);

  // Derive the labels from the stacks
  const undoStack = useHistoryStore((state) => state.undoStack);
  const redoStack = useHistoryStore((state) => state.redoStack);
  const pendingPatches = useHistoryStore((state) => state.pendingPatches);

  const canUndo = enabled && (undoStackLength > 0 || hasPendingPatches);
  const canRedo = enabled && redoStackLength > 0;

  const undoLabel = pendingPatches?.label ?? (undoStack.length > 0 ? undoStack[undoStack.length - 1].label : null);
  const redoLabel = redoStack.length > 0 ? redoStack[redoStack.length - 1].label : null;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={undo}
        disabled={!canUndo}
        className={`p-2 rounded-lg transition-colors ${
          canUndo
            ? 'hover:bg-muted text-foreground'
            : 'text-muted-foreground/40 cursor-not-allowed'
        }`}
        title={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 10h10a4 4 0 014 4v2M3 10l4 4m-4-4l4-4"
          />
        </svg>
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        className={`p-2 rounded-lg transition-colors ${
          canRedo
            ? 'hover:bg-muted text-foreground'
            : 'text-muted-foreground/40 cursor-not-allowed'
        }`}
        title={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 10h-10a4 4 0 00-4 4v2M21 10l-4 4m4-4l-4-4"
          />
        </svg>
      </button>
    </div>
  );
}
