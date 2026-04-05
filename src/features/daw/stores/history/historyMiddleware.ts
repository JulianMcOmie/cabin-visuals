import { type StateCreator, type StoreMutatorIdentifier } from 'zustand';
import { produceWithPatches, enablePatches, type Draft } from 'immer';
import { useHistoryStore, setTargetStore } from './historyStore';
import { getLabelForPatches, allPatchesIgnored } from './actionLabels';

// Enable Immer patches
enablePatches();

type Write<T, U> = Omit<T, keyof U> & U;
type SkipTwo<T> = T extends { length: 0 }
  ? []
  : T extends { length: 1 }
    ? []
    : T extends { length: 0 | 1 }
      ? []
      : T extends [unknown, unknown, ...infer A]
        ? A
        : T extends [unknown, unknown?, ...infer A]
          ? A
          : T extends [unknown?, unknown?, ...infer A]
            ? A
            : never;

type SetStateType<T> = {
  _(
    nextStateOrUpdater: T | Partial<T> | ((state: Draft<T>) => void),
    shouldReplace?: false
  ): void;
}['_'];

declare module 'zustand' {
  interface StoreMutators<S, A> {
    ['zustand/history']: Write<S, { setState: SetStateType<A> }>;
  }
}

type HistoryMiddleware = <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  initializer: StateCreator<T, [...Mps, ['zustand/history', T]], Mcs>,
  options?: { name?: string }
) => StateCreator<T, Mps, [['zustand/history', T], ...Mcs]>;

type HistoryMiddlewareImpl = <T>(
  initializer: StateCreator<T, [['zustand/history', T]], []>,
  options?: { name?: string }
) => StateCreator<T, [], [['zustand/history', T]]>;

const historyMiddlewareImpl: HistoryMiddlewareImpl = (initializer, _options) => (set, get, api) => {
  // Register this store as the target for undo/redo
  setTargetStore({
    getState: get as () => { project: unknown },
    setState: (state) => {
      // Direct state replacement without triggering history
      api.setState(state as Parameters<typeof api.setState>[0], true);
    },
  });

  // Create immer-style set function that captures patches
  type T = ReturnType<typeof get>;

  const historySet: SetStateType<T> = (nextStateOrUpdater, shouldReplace) => {
    const historyState = useHistoryStore.getState();

    // If history is disabled, use produceWithPatches but don't record
    const currentState = get();

    if (typeof nextStateOrUpdater === 'function') {
      // It's a function updater (immer-style mutation)
      const [nextState, patches, inversePatches] = produceWithPatches(
        currentState,
        nextStateOrUpdater as (draft: Draft<T>) => void
      );

      // Apply the state change
      api.setState(nextState as Parameters<typeof api.setState>[0], true);

      // Record patches if history is enabled
      if (historyState.config.enabled && patches.length > 0 && !allPatchesIgnored(patches)) {
        const label = getLabelForPatches(patches);
        historyState._pushPatches(label, patches, inversePatches);
      }
    } else {
      // It's a partial state object
      const [nextState, patches, inversePatches] = produceWithPatches(
        currentState,
        (draft) => {
          Object.assign(draft as object, nextStateOrUpdater);
        }
      );

      // Apply the state change
      api.setState(nextState as Parameters<typeof api.setState>[0], true);

      // Record patches if history is enabled
      if (historyState.config.enabled && patches.length > 0 && !allPatchesIgnored(patches)) {
        const label = getLabelForPatches(patches);
        historyState._pushPatches(label, patches, inversePatches);
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return initializer(historySet as any, get, api as any);
};

export const historyMiddleware = historyMiddlewareImpl as HistoryMiddleware;
