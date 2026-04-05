import { create } from 'zustand';
import { Project, Track, Block, ProjectMetadata, Event, PluginInstance, AutomationConfig } from '@daw/core/types';
import { generateId } from '@daw/utils/id';
import { PATTERN_PRESETS } from '@daw/core/presets';
import * as storage from '@daw/services/storage';
import { useUIStore } from './uiStore';
import { historyMiddleware, useHistoryStore } from './history';

interface ProjectState {
  project: Project;
  projectList: ProjectMetadata[];

  // Track operations
  addTrack: (parentId?: string, preset?: typeof PATTERN_PRESETS[0]) => string;
  addAutomationTrack: (parentTrackId: string, paramKey: string) => string;
  addAudioTrack: (name: string) => string;
  addImageTrack: (name: string, imageStorageId: string) => string;
  addVideoTrack: (name: string, videoStorageId: string, numSlices?: number) => string;
  addVideoKaleidoscopeTrack: (name: string, sliceVideoMap: Record<string, string>, numSegments?: number) => string;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  deleteTrack: (trackId: string) => void;
  moveTrack: (trackId: string, newParentId?: string, index?: number) => void;
  duplicateTrack: (trackId: string, newParentId?: string, index?: number) => string;
  reorderTrack: (trackId: string, direction: 'up' | 'down') => void;
  groupTracks: (trackIds: string[]) => string | null;

  // Block operations
  addBlock: (trackId: string, block: Omit<Block, 'id'>) => string;
  updateBlock: (trackId: string, blockId: string, updates: Partial<Block>) => void;
  deleteBlock: (trackId: string, blockId: string) => void;
  moveBlock: (sourceTrackId: string, blockId: string, targetTrackId: string) => void;
  splitBlockAtPosition: (trackId: string, blockId: string, splitBar: number, beatsPerBar: number) => string | null;
  updateBlockDrums: (trackId: string, blockId: string, events: Event[]) => void;
  updateBlockEvents: (trackId: string, blockId: string, events: Event[]) => void;
  joinBlocks: (trackId: string, blockIds: string[], beatsPerBar: number) => string | null;

  // Visual plugin operations
  addVisualPlugin: (trackId: string, pluginId: string) => string;
  updateVisualPlugin: (trackId: string, instanceId: string, updates: Partial<PluginInstance>) => void;
  deleteVisualPlugin: (trackId: string, instanceId: string) => void;
  reorderVisualPlugins: (trackId: string, fromIndex: number, toIndex: number) => void;

  // Project operations
  setBpm: (bpm: number) => void;
  setTotalBars: (bars: number) => void;
  resetProject: () => void;
  loadProject: (project: Project) => void;

  // Scene operations
  addScene: (name?: string) => string;
  deleteScene: (sceneId: string) => void;
  addMaskToScene: (sceneId: string, maskInstrumentId: string) => string;
  assignTrackToScene: (trackId: string, sceneId: string | undefined) => void;

  // Multi-project operations
  createNewProject: () => string;
  switchProject: (id: string) => void;
  deleteProjectById: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  refreshProjectList: () => void;
}

function createMasterTrack(): Track {
  return {
    id: generateId(),
    name: 'Master',
    typeId: 'master',
    instrumentId: 'masterChannel',
    instrumentSettings: {
      exposure: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      temperature: 0.0,
      vignetteAmount: 0.0,
      vignetteRadius: 0.5,
      vignetteSoftness: 0.5,
      gamma: 1.0,
    },
    muted: false,
    solo: false,
    collapsed: false,
    blocks: [],
    childIds: [],
  };
}

function createMainSceneTrack(): Track {
  return {
    id: generateId(),
    name: 'Main',
    typeId: 'scene',
    instrumentId: 'sceneGate',
    muted: false,
    solo: false,
    collapsed: false,
    blocks: [],
    childIds: [],
  };
}

function createDefaultProject(): Project {
  const master = createMasterTrack();
  const mainScene = createMainSceneTrack();
  return {
    id: generateId(),
    name: 'New Project',
    bpm: 120,
    totalBars: 8,
    beatsPerBar: 4,
    rootTracks: [master.id],
    rootScenes: [mainScene.id],
    mainSceneTrackId: mainScene.id,
    tracks: { [master.id]: master, [mainScene.id]: mainScene },
  };
}

function ensureMasterTrack(project: Project): void {
  // Check if any existing track is a master track
  const hasMaster = Object.values(project.tracks).some(t => t.typeId === 'master');
  if (!hasMaster) {
    const master = createMasterTrack();
    project.tracks[master.id] = master;
    project.rootTracks.push(master.id);
  }
}

function ensureMainSceneTrack(project: Project): void {
  if (project.mainSceneTrackId && project.tracks[project.mainSceneTrackId]) return;
  const mainScene = createMainSceneTrack();
  project.tracks[mainScene.id] = mainScene;
  // Insert at the beginning of rootScenes
  project.rootScenes.unshift(mainScene.id);
  project.mainSceneTrackId = mainScene.id;
}

function createDefaultTrack(
  parentId?: string,
  preset?: typeof PATTERN_PRESETS[0]
): Track {
  const track: Track = {
    id: generateId(),
    name: preset?.name || 'New Track',
    typeId: preset?.defaultTrackType || (parentId ? 'add' : 'base'),
    instrumentId: preset?.defaultInstrument,
    muted: false,
    solo: false,
    collapsed: false,
    blocks: [],
    childIds: [],
    parentId,
    patternCategory: preset?.category,
  };

  // Add a block from preset if provided
  if (preset) {
    track.blocks.push({
      id: generateId(),
      startBar: 0,
      durationBars: preset.durationBars,
      loop: true,
      streams: [{ events: [...preset.events] }],
    });
  }

  return track;
}

export const useProjectStore = create<ProjectState>()(
  historyMiddleware((set, get) => ({
    project: createDefaultProject(),
    projectList: [],

    addTrack: (parentId?: string, preset?: typeof PATTERN_PRESETS[0]) => {
      const track = createDefaultTrack(parentId, preset);

      set((state) => {
        // Auto-set harmonyMap for arps added as children of tracks with pitched content
        if (preset?.category === 'arp' && parentId) {
          const parent = state.project.tracks[parentId];
          if (parent) {
            // Check if parent has any pitched events (not just drums)
            const hasPitchedContent = parent.blocks.some(block =>
              block.streams?.some(stream =>
                stream.events.some(e => e.pitch !== undefined)
              )
            );
            if (hasPitchedContent) {
              track.typeId = 'harmonyMap';
            }
          }
        }

        // Inherit automationConfig from parent if it has one
        if (parentId) {
          const parent = state.project.tracks[parentId];
          if (parent?.automationConfig) {
            track.automationConfig = { ...parent.automationConfig };
          }
        }

        state.project.tracks[track.id] = track;

        if (parentId && state.project.tracks[parentId]) {
          state.project.tracks[parentId].childIds.push(track.id);
        } else {
          state.project.rootTracks.push(track.id);
        }
      });

      return track.id;
    },

    addAudioTrack: (name: string) => {
      const trackId = generateId();

      set((state) => {
        const track: Track = {
          id: trackId,
          name: name || 'Audio Track',
          typeId: 'base',
          instrumentId: 'audioPlayer',
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [],
          childIds: [],
        };

        state.project.tracks[trackId] = track;
        state.project.rootTracks.push(trackId);
      });

      return trackId;
    },

    addImageTrack: (name: string, imageStorageId: string) => {
      const trackId = generateId();

      set((state) => {
        const track: Track = {
          id: trackId,
          name: name || 'Image Track',
          typeId: 'base',
          instrumentId: 'imageDisplay',
          instrumentSettings: { imageStorageId, x: 0, y: 0, scale: 1, opacity: 1 },
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [],
          childIds: [],
        };

        state.project.tracks[trackId] = track;
        state.project.rootTracks.push(trackId);
      });

      return trackId;
    },

    addVideoTrack: (name: string, videoStorageId: string, numSlices: number = 8) => {
      const trackId = generateId();

      set((state) => {
        const track: Track = {
          id: trackId,
          name: name || 'Video Track',
          typeId: 'base',
          instrumentId: 'videoSampler',
          instrumentSettings: {
            videoStorageId,
            numSlices,
            playbackMode: 'hold',
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
          },
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [],
          childIds: [],
        };

        state.project.tracks[trackId] = track;
        state.project.rootTracks.push(trackId);
      });

      return trackId;
    },

    addVideoKaleidoscopeTrack: (name: string, sliceVideoMap: Record<string, string>, numSegments: number = 6) => {
      const trackId = generateId();

      set((state) => {
        const track: Track = {
          id: trackId,
          name: name || 'Video Kaleidoscope',
          typeId: 'base',
          instrumentId: 'videoKaleidoscope',
          instrumentSettings: {
            numSegments,
            sliceVideoMap,
            spiralIntensity: 0,
            rotationSpeed: 0,
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            mirrorMode: false,
            featherEdge: 0.02,
          },
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [],
          childIds: [],
        };

        state.project.tracks[trackId] = track;
        state.project.rootTracks.push(trackId);
      });

      return trackId;
    },

    addAutomationTrack: (parentTrackId: string, paramKey: string) => {
      const { getInstrument } = require('@daw/instruments');
      const trackId = generateId();

      set((state) => {
        const parent = state.project.tracks[parentTrackId];
        if (!parent) return;

        const instrument = parent.instrumentId ? getInstrument(parent.instrumentId) : undefined;
        const schema = instrument?.settingsSchema;
        const field = paramKey ? schema?.[paramKey] : undefined;
        const label = field?.label ?? (paramKey || 'Automation');

        const track: Track = {
          id: trackId,
          name: label,
          typeId: 'base',
          automationConfig: { targetParam: paramKey, interpolate: false, interpolation: 'step' },
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [],
          childIds: [],
          parentId: parentTrackId,
        };

        state.project.tracks[trackId] = track;
        parent.childIds.push(trackId);
      });

      return trackId;
    },

    updateTrack: (trackId: string, updates: Partial<Track>) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (track) {
          Object.assign(track, updates);
        }
      });
    },

    deleteTrack: (trackId: string) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        // Protect master track from deletion
        if (track.typeId === 'master') return;

        // Recursively delete children
        const deleteRecursive = (id: string) => {
          const t = state.project.tracks[id];
          if (!t) return;

          for (const childId of t.childIds) {
            deleteRecursive(childId);
          }

          delete state.project.tracks[id];
        };

        // Remove from parent's childIds or rootTracks
        if (track.parentId) {
          const parent = state.project.tracks[track.parentId];
          if (parent) {
            parent.childIds = parent.childIds.filter(id => id !== trackId);
          }
        } else {
          state.project.rootTracks = state.project.rootTracks.filter(id => id !== trackId);
        }

        deleteRecursive(trackId);
      });
    },

    moveTrack: (trackId: string, newParentId?: string, index?: number) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        // Protect master track from moving
        if (track.typeId === 'master') return;

        // Remove from current parent
        if (track.parentId) {
          const oldParent = state.project.tracks[track.parentId];
          if (oldParent) {
            oldParent.childIds = oldParent.childIds.filter(id => id !== trackId);
          }
        } else {
          state.project.rootTracks = state.project.rootTracks.filter(id => id !== trackId);
        }

        // Add to new parent
        track.parentId = newParentId;

        if (newParentId) {
          const newParent = state.project.tracks[newParentId];
          if (newParent) {
            if (index !== undefined) {
              newParent.childIds.splice(index, 0, trackId);
            } else {
              newParent.childIds.push(trackId);
            }
          }
        } else {
          if (index !== undefined) {
            state.project.rootTracks.splice(index, 0, trackId);
          } else {
            state.project.rootTracks.push(trackId);
          }
        }
      });
    },

    duplicateTrack: (trackId: string, newParentId?: string, index?: number) => {
      let rootCloneId = '';

      set((state) => {
        const cloneTrack = (srcId: string, parentId?: string): string => {
          const src = state.project.tracks[srcId];
          if (!src) return '';

          const cloneId = generateId();
          if (!rootCloneId) rootCloneId = cloneId;

          // Deep clone blocks
          const clonedBlocks = src.blocks.map(block => ({
            ...block,
            id: generateId(),
            streams: block.streams.map(stream => ({
              ...stream,
              events: stream.events.map(e => ({ ...e })),
            })),
            audioData: block.audioData ? { ...block.audioData } : undefined,
          }));

          // Deep clone visual plugins
          const clonedPlugins = src.visualPlugins?.map(p => ({
            ...p,
            id: generateId(),
            settings: { ...p.settings },
          }));

          const isRoot = !rootCloneId;
          const cloned = {
            ...src,
            id: cloneId,
            name: isRoot ? `${src.name} (Copy)` : src.name,
            blocks: clonedBlocks,
            visualPlugins: clonedPlugins,
            instrumentSettings: src.instrumentSettings ? { ...src.instrumentSettings } : undefined,
            automationConfig: src.automationConfig ? { ...src.automationConfig } : undefined,
            parentId,
            childIds: [] as string[],
          };

          state.project.tracks[cloneId] = cloned;

          // Recursively clone children
          for (const childId of src.childIds) {
            const childCloneId = cloneTrack(childId, cloneId);
            if (childCloneId) cloned.childIds.push(childCloneId);
          }

          return cloneId;
        };

        rootCloneId = '';
        const clonedId = cloneTrack(trackId, newParentId);

        // Insert into parent's child list or rootTracks
        if (newParentId) {
          const parent = state.project.tracks[newParentId];
          if (parent) {
            if (index !== undefined) {
              parent.childIds.splice(index, 0, clonedId);
            } else {
              parent.childIds.push(clonedId);
            }
          }
        } else {
          if (index !== undefined) {
            state.project.rootTracks.splice(index, 0, clonedId);
          } else {
            state.project.rootTracks.push(clonedId);
          }
        }
      });

      return rootCloneId;
    },

    reorderTrack: (trackId: string, direction: 'up' | 'down') => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        // Protect master track from reordering
        if (track.typeId === 'master') return;

        const list = track.parentId
          ? state.project.tracks[track.parentId]?.childIds
          : state.project.rootTracks;

        if (!list) return;

        const index = list.indexOf(trackId);
        if (index === -1) return;

        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= list.length) return;

        // Swap
        [list[index], list[newIndex]] = [list[newIndex], list[index]];
      });
    },

    groupTracks: (trackIds: string[]) => {
      if (trackIds.length < 2) return null;

      const groupId = generateId();

      set((state) => {
        // Verify all tracks exist
        const tracks = trackIds.map((id) => state.project.tracks[id]).filter(Boolean);
        if (tracks.length !== trackIds.length) return;

        // Create the group track at root level (no parent)
        const groupTrack: Track = {
          id: groupId,
          name: 'Group',
          typeId: 'base',
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [],
          childIds: [...trackIds],
          parentId: undefined, // Always at root
        };

        // Add group track to project
        state.project.tracks[groupId] = groupTrack;

        // Remove each track from its current parent and update parentId
        for (const track of tracks) {
          const oldParentId = track.parentId;

          // Remove from old parent's childIds or rootTracks
          if (oldParentId) {
            const oldParent = state.project.tracks[oldParentId];
            if (oldParent) {
              oldParent.childIds = oldParent.childIds.filter((id) => id !== track.id);
            }
          } else {
            state.project.rootTracks = state.project.rootTracks.filter((id) => id !== track.id);
          }

          // Update to new parent
          track.parentId = groupId;
        }

        // Add group to root tracks
        state.project.rootTracks.push(groupId);
      });

      return groupId;
    },

    addBlock: (trackId: string, blockData: Omit<Block, 'id'>) => {
      const blockId = generateId();

      set((state) => {
        const track = state.project.tracks[trackId];
        if (track) {
          track.blocks.push({ ...blockData, id: blockId });
        }
      });

      return blockId;
    },

    updateBlock: (trackId: string, blockId: string, updates: Partial<Block>) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        const block = track.blocks.find(b => b.id === blockId);
        if (block) {
          Object.assign(block, updates);
        }
      });
    },

    deleteBlock: (trackId: string, blockId: string) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (track) {
          track.blocks = track.blocks.filter(b => b.id !== blockId);
        }
      });
    },

    moveBlock: (sourceTrackId: string, blockId: string, targetTrackId: string) => {
      set((state) => {
        const sourceTrack = state.project.tracks[sourceTrackId];
        const targetTrack = state.project.tracks[targetTrackId];
        if (!sourceTrack || !targetTrack) return;

        const blockIndex = sourceTrack.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        const [block] = sourceTrack.blocks.splice(blockIndex, 1);
        targetTrack.blocks.push(block);
      });
    },

    splitBlockAtPosition: (trackId: string, blockId: string, splitBar: number, beatsPerBar: number) => {
      const newBlockId = generateId();
      let success = false;

      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        const blockIndex = track.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        const block = track.blocks[blockIndex];
        const blockEndBar = block.startBar + block.durationBars;

        // Don't split if playhead is at or outside block boundaries
        // Use small epsilon to avoid floating point issues
        const epsilon = 0.001;
        if (splitBar <= block.startBar + epsilon || splitBar >= blockEndBar - epsilon) {
          return;
        }

        const firstDuration = splitBar - block.startBar;
        const secondDuration = blockEndBar - splitBar;

        // For looped MIDI blocks, keep both halves looped with the same events
        // The resolution code handles expanding the loop during playback
        if (block.loop && !block.audioData) {
          // Simply split the duration - events stay the same, loop continues
          block.durationBars = firstDuration;
          // block.loop stays true, block.streams stay the same

          const secondBlock: Block = {
            id: newBlockId,
            startBar: splitBar,
            durationBars: secondDuration,
            loop: true,
            streams: block.streams.map(s => ({ events: s.events.map(e => ({ ...e })) })),
          };

          track.blocks.splice(blockIndex + 1, 0, secondBlock);
          success = true;
          return;
        }

        // For non-looped blocks or audio blocks, split the events
        const splitBeat = (splitBar - block.startBar) * beatsPerBar;
        const blockEvents = block.streams[0]?.events || [];

        const firstBlockEvents: Event[] = [];
        const secondBlockEvents: Event[] = [];

        for (const event of blockEvents) {
          const eventEnd = event.startTimeInBeats + event.duration;

          if (event.startTimeInBeats < splitBeat) {
            // Event starts before split
            if (eventEnd <= splitBeat) {
              // Event fully in first block
              firstBlockEvents.push({ ...event });
            } else {
              // Event spans split - truncate to first block
              firstBlockEvents.push({
                ...event,
                duration: splitBeat - event.startTimeInBeats,
              });
            }
          } else {
            // Event starts at or after split - goes to second block
            // Adjust timing relative to second block's start
            secondBlockEvents.push({
              ...event,
              startTimeInBeats: event.startTimeInBeats - splitBeat,
            });
          }
        }

        // Update first block
        block.durationBars = firstDuration;
        block.streams = [{ events: firstBlockEvents }];

        // Create second block
        const secondBlock: Block = {
          id: newBlockId,
          startBar: splitBar,
          durationBars: secondDuration,
          loop: false,
          streams: [{ events: secondBlockEvents }],
        };

        // Copy audio data if present (with offset adjustment would be needed for full support)
        if (block.audioData) {
          secondBlock.audioData = { ...block.audioData };
        }

        // Insert second block right after the first
        track.blocks.splice(blockIndex + 1, 0, secondBlock);
        success = true;
      });

      return success ? newBlockId : null;
    },

    updateBlockDrums: (trackId: string, blockId: string, events: Event[]) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        const block = track.blocks.find(b => b.id === blockId);
        if (!block) return;

        // Update the block's streams with the drum events
        block.streams = [{ events }];
      });
    },

    updateBlockEvents: (trackId: string, blockId: string, events: Event[]) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        const block = track.blocks.find(b => b.id === blockId);
        if (!block) return;

        block.streams = [{ events }];
      });
    },

    joinBlocks: (trackId: string, blockIds: string[], beatsPerBar: number) => {
      if (blockIds.length < 2) return null;

      let joinedId: string | null = null;

      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        // Find and validate all blocks
        const blocks = blockIds
          .map(id => track.blocks.find(b => b.id === id))
          .filter((b): b is Block => !!b);

        if (blocks.length < 2) return;
        if (blocks.some(b => b.loop)) return; // no looped blocks

        // Sort by start position
        blocks.sort((a, b) => a.startBar - b.startBar);

        const firstStart = blocks[0].startBar;
        const lastEnd = Math.max(...blocks.map(b => b.startBar + b.durationBars));
        const totalDuration = lastEnd - firstStart;

        // Merge all events, offsetting times relative to the new block start
        const mergedEvents: Event[] = [];
        for (const block of blocks) {
          const blockOffsetBeats = (block.startBar - firstStart) * beatsPerBar;
          for (const stream of block.streams) {
            for (const event of stream.events) {
              mergedEvents.push({
                ...event,
                startTimeInBeats: event.startTimeInBeats + blockOffsetBeats,
              });
            }
          }
        }

        // Create merged block
        const newId = generateId();
        const mergedBlock: Block = {
          id: newId,
          startBar: firstStart,
          durationBars: totalDuration,
          loop: false,
          streams: [{ events: mergedEvents }],
        };

        // Remove old blocks and insert merged one
        track.blocks = track.blocks.filter(b => !blockIds.includes(b.id));
        track.blocks.push(mergedBlock);
        track.blocks.sort((a, b) => a.startBar - b.startBar);

        joinedId = newId;
      });

      return joinedId;
    },

    addVisualPlugin: (trackId: string, pluginId: string) => {
      const instanceId = generateId();

      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track) return;

        // Dynamically import to avoid circular dependency
        const { getPlugin } = require('@daw/plugins');
        const plugin = getPlugin(pluginId);
        if (!plugin) return;

        const instance: PluginInstance = {
          id: instanceId,
          pluginId,
          enabled: true,
          settings: { ...plugin.defaultSettings },
        };

        if (!track.visualPlugins) {
          track.visualPlugins = [];
        }
        track.visualPlugins.push(instance);
      });

      return instanceId;
    },

    updateVisualPlugin: (trackId: string, instanceId: string, updates: Partial<PluginInstance>) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track?.visualPlugins) return;

        const plugin = track.visualPlugins.find((p) => p.id === instanceId);
        if (plugin) {
          Object.assign(plugin, updates);
        }
      });
    },

    deleteVisualPlugin: (trackId: string, instanceId: string) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (track?.visualPlugins) {
          track.visualPlugins = track.visualPlugins.filter((p) => p.id !== instanceId);
        }
      });
    },

    reorderVisualPlugins: (trackId: string, fromIndex: number, toIndex: number) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (!track?.visualPlugins) return;

        const plugins = [...track.visualPlugins];
        const [moved] = plugins.splice(fromIndex, 1);
        plugins.splice(toIndex, 0, moved);
        track.visualPlugins = plugins;
      });
    },

    // Scene operations
    addScene: (name?: string) => {
      const trackId = generateId();

      set((state) => {
        const track: Track = {
          id: trackId,
          name: name || 'Scene',
          typeId: 'scene',
          instrumentId: 'sceneGate',
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [],
          childIds: [],
        };

        state.project.tracks[trackId] = track;
        state.project.rootScenes.push(trackId);
      });

      return trackId;
    },

    deleteScene: (sceneId: string) => {
      set((state) => {
        const scene = state.project.tracks[sceneId];
        if (!scene) return;

        // Protect main scene track from deletion
        if (sceneId === state.project.mainSceneTrackId) return;

        // Recursively delete children (mask tracks)
        const deleteRecursive = (id: string) => {
          const t = state.project.tracks[id];
          if (!t) return;
          for (const childId of t.childIds) {
            deleteRecursive(childId);
          }
          delete state.project.tracks[id];
        };

        // Unset sceneId on any tracks assigned to this scene
        for (const track of Object.values(state.project.tracks)) {
          if (track.sceneId === sceneId) {
            track.sceneId = undefined;
          }
        }

        // Remove from rootScenes
        state.project.rootScenes = state.project.rootScenes.filter(id => id !== sceneId);

        deleteRecursive(sceneId);
      });
    },

    addMaskToScene: (sceneId: string, maskInstrumentId: string) => {
      const { getInstrument } = require('@daw/instruments');
      const trackId = generateId();

      set((state) => {
        const scene = state.project.tracks[sceneId];
        if (!scene) return;

        const instrument = getInstrument(maskInstrumentId);
        const track: Track = {
          id: trackId,
          name: instrument?.name || 'Mask',
          typeId: 'base',
          instrumentId: maskInstrumentId,
          instrumentSettings: instrument?.defaultSettings ? { ...instrument.defaultSettings } : undefined,
          muted: false,
          solo: false,
          collapsed: false,
          blocks: [{
            id: generateId(),
            startBar: 0,
            durationBars: state.project.totalBars,
            loop: true,
            streams: [{ events: [] }],
          }],
          childIds: [],
          parentId: sceneId,
        };

        state.project.tracks[trackId] = track;
        scene.childIds.push(trackId);
      });

      return trackId;
    },

    assignTrackToScene: (trackId: string, sceneId: string | undefined) => {
      set((state) => {
        const track = state.project.tracks[trackId];
        if (track) {
          track.sceneId = sceneId;
        }
      });
    },

    setBpm: (bpm: number) => {
      set((state) => {
        state.project.bpm = Math.max(20, Math.min(300, bpm));
      });
    },

    setTotalBars: (bars: number) => {
      set((state) => {
        state.project.totalBars = Math.max(1, Math.min(512, bars));
      });
    },

    resetProject: () => {
      set((state) => {
        state.project = createDefaultProject();
      });
    },

    loadProject: (project: Project) => {
      // Migration: default rootScenes to [] if missing (schema v1 → v2)
      if (!project.rootScenes) {
        project.rootScenes = [];
      }
      // Migration: assign sceneGate instrument to existing scene tracks
      for (const sceneId of project.rootScenes) {
        const scene = project.tracks[sceneId];
        if (scene && scene.typeId === 'scene' && !scene.instrumentId) {
          scene.instrumentId = 'sceneGate';
        }
      }
      // Migration: ensure master track exists for old projects
      ensureMasterTrack(project);
      // Migration: ensure main scene track exists for old projects
      ensureMainSceneTrack(project);
      set((state) => {
        state.project = project;
      });
    },

    createNewProject: () => {
      const newProject = createDefaultProject();
      const metadata = storage.projectToMetadata(newProject);

      // Disable history during project creation
      useHistoryStore.getState().setEnabled(false);

      set((state) => {
        state.project = newProject;
        state.projectList = [metadata, ...state.projectList];
      });

      storage.saveProject(newProject);
      storage.saveProjectList(get().projectList);
      storage.setCurrentProjectId(newProject.id);

      // Re-enable and clear history
      useHistoryStore.getState().setEnabled(true);
      useHistoryStore.getState().clearHistory();

      return newProject.id;
    },

    switchProject: (id: string) => {
      const project = storage.getProject(id);
      if (!project) return;

      // Migration: ensure master track exists for old projects
      ensureMasterTrack(project);
      // Migration: ensure main scene track exists for old projects
      ensureMainSceneTrack(project);

      // Disable history during project switch
      useHistoryStore.getState().setEnabled(false);

      set((state) => {
        state.project = project;
      });

      storage.setCurrentProjectId(id);

      // Re-enable and clear history
      useHistoryStore.getState().setEnabled(true);
      useHistoryStore.getState().clearHistory();
    },

    deleteProjectById: (id: string) => {
      const currentProject = get().project;
      const currentView = useUIStore.getState().currentView;

      storage.deleteProject(id);

      set((state) => {
        state.projectList = state.projectList.filter((p) => p.id !== id);
      });

      // If we're on homepage, just stay there (don't auto-switch)
      if (currentView === 'home') {
        return;
      }

      // If we deleted the current project while in editor, switch to another or go home
      if (currentProject.id === id) {
        const remaining = get().projectList;
        if (remaining.length > 0) {
          get().switchProject(remaining[0].id);
        } else {
          useUIStore.getState().setCurrentView('home');
        }
      }
    },

    renameProject: (id: string, name: string) => {
      set((state) => {
        const metadata = state.projectList.find((p) => p.id === id);
        if (metadata) {
          metadata.name = name;
          metadata.updatedAt = Date.now();
        }
        if (state.project.id === id) {
          state.project.name = name;
        }
      });

      // Save updated metadata list
      storage.saveProjectList(get().projectList);

      // If it's the current project, save the full project too
      if (get().project.id === id) {
        storage.saveProject(get().project);
      } else {
        // Load, update, and save the other project
        const project = storage.getProject(id);
        if (project) {
          project.name = name;
          storage.saveProject(project);
        }
      }
    },

    refreshProjectList: () => {
      set((state) => {
        state.projectList = storage.getProjectList();
      });
    },
  }))
);

// Helper to add a track from a preset
export function addTrackFromPreset(presetId: string, parentId?: string): string | null {
  const preset = PATTERN_PRESETS.find(p => p.id === presetId);
  if (!preset) return null;

  return useProjectStore.getState().addTrack(parentId, preset);
}

// Helper to add a track from an instrument
export function addTrackFromInstrument(instrumentId: string, parentId?: string): string {
  const { getInstrument } = require('@daw/instruments');
  const instrument = getInstrument(instrumentId);

  const trackId = generateId();

  const track: Track = {
    id: trackId,
    name: instrument?.name || 'New Track',
    typeId: 'base',
    instrumentId,
    instrumentSettings: instrument?.defaultSettings ? { ...instrument.defaultSettings } : undefined,
    muted: false,
    solo: false,
    collapsed: false,
    blocks: [],
    childIds: [],
    parentId,
  };

  useProjectStore.setState((state) => {
    state.project.tracks[trackId] = track;

    if (parentId) {
      const parent = state.project.tracks[parentId];
      if (parent) {
        parent.childIds.push(trackId);
      }
    } else {
      state.project.rootTracks.push(trackId);
    }
  });

  return trackId;
}
