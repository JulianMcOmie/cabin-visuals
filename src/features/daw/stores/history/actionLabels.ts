import type { Patch } from 'immer';

interface LabelRule {
  pathPattern: RegExp;
  getLabel: (patch: Patch, matches: RegExpMatchArray) => string;
}

const labelRules: LabelRule[] = [
  // Track operations
  {
    pathPattern: /^project\.tracks\.([^.]+)$/,
    getLabel: (patch) => patch.op === 'add' ? 'Add track' : patch.op === 'remove' ? 'Delete track' : 'Update track',
  },
  {
    pathPattern: /^project\.rootTracks$/,
    getLabel: (patch) => {
      if (patch.op === 'add') return 'Add track';
      if (patch.op === 'remove') return 'Remove track';
      return 'Reorder tracks';
    },
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.childIds$/,
    getLabel: () => 'Move track',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.name$/,
    getLabel: () => 'Rename track',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.muted$/,
    getLabel: (patch) => patch.value ? 'Mute track' : 'Unmute track',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.collapsed$/,
    getLabel: (patch) => patch.value ? 'Collapse track' : 'Expand track',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.typeId$/,
    getLabel: () => 'Change track type',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.instrumentId$/,
    getLabel: () => 'Change instrument',
  },

  // Block operations
  {
    pathPattern: /^project\.tracks\.([^.]+)\.blocks$/,
    getLabel: (patch) => {
      if (patch.op === 'add') return 'Add block';
      if (patch.op === 'remove') return 'Delete block';
      return 'Update blocks';
    },
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.blocks\.(\d+)$/,
    getLabel: (patch) => {
      if (patch.op === 'add') return 'Add block';
      if (patch.op === 'remove') return 'Delete block';
      return 'Update block';
    },
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.blocks\.(\d+)\.streams/,
    getLabel: () => 'Edit notes',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.blocks\.(\d+)\.startBar$/,
    getLabel: () => 'Move block',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.blocks\.(\d+)\.durationBars$/,
    getLabel: () => 'Resize block',
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.blocks\.(\d+)\.loop$/,
    getLabel: (patch) => patch.value ? 'Enable loop' : 'Disable loop',
  },

  // Scene operations
  {
    pathPattern: /^project\.rootScenes$/,
    getLabel: (patch) => {
      if (patch.op === 'add') return 'Add scene';
      if (patch.op === 'remove') return 'Remove scene';
      return 'Reorder scenes';
    },
  },
  {
    pathPattern: /^project\.tracks\.([^.]+)\.sceneId$/,
    getLabel: () => 'Assign track to scene',
  },

  // Project settings
  {
    pathPattern: /^project\.bpm$/,
    getLabel: () => 'Change BPM',
  },
  {
    pathPattern: /^project\.totalBars$/,
    getLabel: () => 'Change length',
  },
  {
    pathPattern: /^project\.beatsPerBar$/,
    getLabel: () => 'Change time signature',
  },
  {
    pathPattern: /^project\.name$/,
    getLabel: () => 'Rename project',
  },
];

// Paths that should be ignored (not create undo entries)
const ignoredPathPatterns = [
  /^projectList/,  // Project list metadata changes
];

function patchPathToString(path: (string | number)[]): string {
  return path.join('.');
}

export function shouldIgnorePatch(patch: Patch): boolean {
  const pathStr = patchPathToString(patch.path);
  return ignoredPathPatterns.some(pattern => pattern.test(pathStr));
}

export function getLabelForPatches(patches: Patch[]): string {
  // Filter out ignored patches
  const relevantPatches = patches.filter(p => !shouldIgnorePatch(p));

  if (relevantPatches.length === 0) {
    return 'Update';
  }

  // Try to find a label for the first relevant patch
  for (const patch of relevantPatches) {
    const pathStr = patchPathToString(patch.path);

    for (const rule of labelRules) {
      const matches = pathStr.match(rule.pathPattern);
      if (matches) {
        return rule.getLabel(patch, matches);
      }
    }
  }

  // Fallback labels based on patch operations
  const ops = new Set(relevantPatches.map(p => p.op));
  if (ops.has('add') && relevantPatches.length === 1) {
    return 'Add';
  }
  if (ops.has('remove') && relevantPatches.length === 1) {
    return 'Delete';
  }

  return 'Update';
}

export function allPatchesIgnored(patches: Patch[]): boolean {
  return patches.every(shouldIgnorePatch);
}
