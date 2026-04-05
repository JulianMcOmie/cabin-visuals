import { Project, Track, Block, Event, Output, ProcessContext, HarmonyInfo } from './types';
import { getTrackType } from './trackTypes';
import { findHarmonyInOutput, deriveScaleFromHarmony } from './harmony';
import { getInstrument } from '@daw/instruments';
import { getPlugin } from '@daw/plugins';

/**
 * Check if a track should be skipped given solo state among its siblings.
 * If any sibling is solo'd, non-solo'd tracks are skipped. Muted tracks always skip.
 */
function isTrackSkipped(track: Track, anySiblingsSoloed: boolean): boolean {
  if (track.muted) return true;
  if (anySiblingsSoloed && !track.solo) return true;
  return false;
}

export interface BlackoutRegion {
  startBeat: number;
  endBeat: number;
}

export interface AutomationKeyframe {
  beatTime: number;
  value: number;  // already mapped from pitch to param value
}

export interface AutomationLane {
  paramKey: string;
  pluginInstanceId?: string;  // if set, targets a plugin's param
  interpolate: boolean;
  interpolation: import('./types').InterpolationMode;
  keyframes: AutomationKeyframe[];  // sorted by beatTime
}

export interface ResolvedTrack {
  trackId: string;
  instrumentId?: string; // Unified instrument ID
  instrumentSettings?: Record<string, unknown>; // Track-level settings
  output: Output;
  blackoutRegions?: BlackoutRegion[];
  automationLanes?: AutomationLane[];
}

interface ModifierResolution {
  pattern: Output;
  instrumentedResults: ResolvedTrack[];
}

interface CategorizedChildren {
  modifiers: Track[];
  regular: Track[];
  automation: Track[];
}

/**
 * Separates a track's children into modifier tracks and regular tracks.
 * Modifier tracks (without instruments) affect the parent's output.
 * Regular tracks process independently and inherit the parent's output.
 */
function categorizeChildren(track: Track, project: Project): CategorizedChildren {
  const modifiers: Track[] = [];
  const regular: Track[] = [];
  const automation: Track[] = [];

  const children = track.childIds
    .map(id => project.tracks[id])
    .filter((t): t is Track => !!t);
  const anyChildSoloed = children.some(t => t.solo);

  for (const childTrack of children) {
    if (isTrackSkipped(childTrack, anyChildSoloed)) continue;

    if (childTrack.automationConfig) {
      automation.push(childTrack);
    } else {
      const childType = getTrackType(childTrack.typeId);
      if (childType.category === 'modifier' && !childTrack.instrumentId) {
        modifiers.push(childTrack);
      } else {
        regular.push(childTrack);
      }
    }
  }

  return { modifiers, regular, automation };
}

interface ApplyModifiersResult {
  output: Output;
  results: ResolvedTrack[];
  context: ProcessContext;
  blackoutRegions: BlackoutRegion[];
}

/**
 * Applies modifier children to a track's output.
 * Each modifier transforms the output, and any instrumented results from
 * modifier subtrees are collected.
 */
function applyModifiers(
  selfOutput: Output,
  modifierChildren: Track[],
  project: Project,
  context: ProcessContext,
  parentOutput: Output | undefined
): ApplyModifiersResult {
  const results: ResolvedTrack[] = [];
  const blackoutRegions: BlackoutRegion[] = [];
  let output = selfOutput;
  let modifierContext = buildContext(context, parentOutput, output);

  for (const modifierTrack of modifierChildren) {
    const modifierResolution = resolveModifierOutput(modifierTrack, project, modifierContext, output);
    const modifierType = getTrackType(modifierTrack.typeId);

    // Collect blackout regions from mute-type modifiers
    if (modifierTrack.typeId === 'mute') {
      for (const event of modifierResolution.pattern.events) {
        blackoutRegions.push({
          startBeat: event.startTimeInBeats,
          endBeat: event.startTimeInBeats + (event.duration ?? 0.25),
        });
      }
    }

    output = modifierType.combine(output, modifierResolution.pattern, modifierContext);
    results.push(...modifierResolution.instrumentedResults);
    modifierContext = buildContext(context, parentOutput, output);
  }

  return { output, results, context: modifierContext, blackoutRegions };
}

/**
 * Builds the resolved track outputs for a track.
 * With unified instruments, a track has one instrumentId that can have audio, visual, or both.
 */
function buildTrackOutputs(
  track: Track,
  selfOutput: Output,
  combinedOutput: Output,
  inheritedInstrumentId: string | undefined,
  blackoutRegions?: BlackoutRegion[]
): ResolvedTrack[] {
  const results: ResolvedTrack[] = [];

  const instrument = track.instrumentId ? getInstrument(track.instrumentId) : undefined;
  const isAudioPlayer = track.instrumentId === 'audioPlayer';
  const hasAudioBlocks = isAudioPlayer && track.blocks.some(b => b.audioData);

  // Check if instrument has audio or visual capabilities
  const hasAudio = instrument?.hasAudio && combinedOutput.events.length > 0;
  const hasVisual = instrument?.hasVisual && combinedOutput.events.length > 0;

  // Check for inherited visual with settings override
  const hasSettings = track.instrumentSettings && Object.keys(track.instrumentSettings).length > 0;
  const inheritedInstrument = inheritedInstrumentId ? getInstrument(inheritedInstrumentId) : undefined;
  const hasInheritedVisualOutput = !track.instrumentId &&
    hasSettings &&
    inheritedInstrument?.hasVisual &&
    selfOutput.events.length > 0;

  // Main output (audio and/or visual)
  if (hasAudioBlocks || hasAudio || hasVisual) {
    results.push({
      trackId: track.id,
      instrumentId: track.instrumentId,
      instrumentSettings: track.instrumentSettings,
      output: combinedOutput,
      blackoutRegions: blackoutRegions?.length ? blackoutRegions : undefined,
    });
  }

  // Inherited visual output (visual-only, using selfOutput with settings override)
  if (hasInheritedVisualOutput) {
    results.push({
      trackId: track.id,
      instrumentId: inheritedInstrumentId,
      instrumentSettings: track.instrumentSettings,
      output: selfOutput,
      blackoutRegions: blackoutRegions?.length ? blackoutRegions : undefined,
    });
  }

  // Utility instruments (e.g. colorPalette) need a resolved entry
  // so the visual engine can read their events (active notes, etc.)
  // Use selfOutput (not combinedOutput) so parent events don't leak in
  const isUtilityInstrument = instrument && !instrument.hasAudio && !instrument.hasVisual;
  if (results.length === 0 && isUtilityInstrument && selfOutput.events.length > 0) {
    results.push({
      trackId: track.id,
      instrumentId: track.instrumentId,
      instrumentSettings: track.instrumentSettings,
      output: selfOutput,
      blackoutRegions: blackoutRegions?.length ? blackoutRegions : undefined,
    });
  }

  // Groups with visual plugins but no instrument still need a resolved entry
  // so automation lanes can be attached and evaluated
  if (results.length === 0 && track.visualPlugins && track.visualPlugins.length > 0) {
    results.push({
      trackId: track.id,
      instrumentId: undefined,
      instrumentSettings: undefined,
      output: combinedOutput,
      blackoutRegions: blackoutRegions?.length ? blackoutRegions : undefined,
    });
  }

  // Scene tracks always need a resolved entry so their instrumentSettings
  // (scale, offsetX, offsetY) are available, plus blackout regions and gate events
  if (results.length === 0 && track.typeId === 'scene') {
    results.push({
      trackId: track.id,
      instrumentId: track.instrumentId,
      instrumentSettings: track.instrumentSettings,
      output: combinedOutput,
      blackoutRegions,
    });
  }

  return results;
}

function resolveModifierOutput(
  modifierTrack: Track,
  project: Project,
  context: ProcessContext,
  targetOutput: Output
): ModifierResolution {
  const instrumentedResults: ResolvedTrack[] = [];

  // Get modifier's own pattern
  let modifierPattern = resolveBlocks(modifierTrack.blocks, project, context);

  // Separate nested children
  const nestedModifiers: Track[] = [];
  const nestedRegular: Track[] = [];

  const modChildren = modifierTrack.childIds
    .map(id => project.tracks[id])
    .filter((t): t is Track => !!t);
  const anyModChildSoloed = modChildren.some(t => t.solo);

  for (const childTrack of modChildren) {
    if (isTrackSkipped(childTrack, anyModChildSoloed)) continue;

    const childType = getTrackType(childTrack.typeId);
    if (childType.category === 'modifier' && !childTrack.instrumentId) {
      nestedModifiers.push(childTrack);
    } else {
      nestedRegular.push(childTrack);
    }
  }

  // Apply nested modifiers to this modifier's pattern (recursively)
  let nestedContext = buildContext(context, targetOutput, modifierPattern);

  for (const nestedModifier of nestedModifiers) {
    const nestedResolution = resolveModifierOutput(
      nestedModifier, project, nestedContext, modifierPattern
    );

    const nestedType = getTrackType(nestedModifier.typeId);
    modifierPattern = nestedType.combine(modifierPattern, nestedResolution.pattern, nestedContext);
    instrumentedResults.push(...nestedResolution.instrumentedResults);
    nestedContext = buildContext(context, targetOutput, modifierPattern);
  }

  // Process regular children with the transformed output
  const modifierType = getTrackType(modifierTrack.typeId);
  const transformedTarget = modifierType.combine(targetOutput, modifierPattern, context);

  for (const regularChild of nestedRegular) {
    const childResults = resolveTrack(regularChild, project, nestedContext, transformedTarget);
    instrumentedResults.push(...childResults);
  }

  return { pattern: modifierPattern, instrumentedResults };
}

/**
 * Builds automation lanes from automation child tracks.
 * Each automation child's events are converted: pitch → param value using parent's settingsSchema.
 */
function buildAutomationLanes(
  automationChildren: Track[],
  parentTrack: Track,
  project: Project,
  context: ProcessContext
): AutomationLane[] {
  const parentInstrument = parentTrack.instrumentId ? getInstrument(parentTrack.instrumentId) : undefined;
  const lanes: AutomationLane[] = [];

  for (const autoTrack of automationChildren) {
    const config = autoTrack.automationConfig!;
    if (!config.targetParam) continue;

    // Determine which schema to use: plugin or instrument
    let schema: Record<string, { type: string; min?: number; max?: number; step?: number; label: string; default: unknown }> | undefined;
    if (config.pluginInstanceId) {
      // Find the plugin instance on the parent track
      const pluginInstance = parentTrack.visualPlugins?.find(p => p.id === config.pluginInstanceId);
      if (!pluginInstance) continue;
      const plugin = getPlugin(pluginInstance.pluginId);
      schema = plugin?.settingsSchema;
    } else {
      schema = parentInstrument?.settingsSchema;
    }
    // "enabled" is a virtual param (on/off toggle), not in settingsSchema
    let paramMin: number;
    let paramMax: number;
    if (config.targetParam === 'enabled') {
      paramMin = 0;
      paramMax = 1;
    } else {
      if (!schema) continue;
      const field = schema[config.targetParam];
      if (!field || field.type !== 'number') continue;
      paramMin = field.min ?? 0;
      paramMax = field.max ?? 1;
    }

    // "enabled" uses a simple 0-1 pitch range; others use instrument noteRange
    const noteRange = config.targetParam === 'enabled'
      ? { min: 0, max: 1 }
      : (parentInstrument?.noteRange ?? { min: 36, max: 96 });
    const pitchMin = noteRange.min;
    const pitchMax = noteRange.max;
    const pitchSpan = pitchMax - pitchMin;

    // Resolve this automation track's events
    const output = resolveBlocks(autoTrack.blocks, project, context);

    let keyframes: AutomationKeyframe[] = output.events.map(e => {
      const t = Math.max(0, Math.min(1, (e.pitch - pitchMin) / pitchSpan));
      return {
        beatTime: e.startTimeInBeats,
        value: paramMin + t * (paramMax - paramMin),
      };
    });

    // Apply suppress children: filter out keyframes in suppress regions
    const autoChildren = autoTrack.childIds
      .map(id => project.tracks[id])
      .filter((t): t is Track => !!t);
    const anyAutoChildSoloed = autoChildren.some(t => t.solo);

    for (const child of autoChildren) {
      if (isTrackSkipped(child, anyAutoChildSoloed)) continue;
      const childType = getTrackType(child.typeId);
      if (childType.category === 'modifier' && child.typeId === 'suppress') {
        const suppressOutput = resolveBlocks(child.blocks, project, context);
        if (suppressOutput.events.length > 0) {
          keyframes = keyframes.filter(kf => {
            for (const se of suppressOutput.events) {
              const start = se.startTimeInBeats;
              const end = start + (se.duration ?? 0.25);
              if (kf.beatTime >= start && kf.beatTime < end) return false;
            }
            return true;
          });
        }
      }
    }

    // Sort by beat time
    keyframes.sort((a, b) => a.beatTime - b.beatTime);

    lanes.push({
      paramKey: config.targetParam,
      pluginInstanceId: config.pluginInstanceId,
      interpolate: config.interpolate,
      interpolation: config.interpolation ?? (config.interpolate ? 'linear' : 'step'),
      keyframes,
    });
  }

  return lanes;
}

export function resolveProject(project: Project): ResolvedTrack[] {
  const results: ResolvedTrack[] = [];
  const baseContext: ProcessContext = {
    bpm: project.bpm,
    beatsPerBar: project.beatsPerBar,
    totalBars: project.totalBars,
    currentBar: 0,
  };

  // Process root tracks (respect solo)
  const rootTracks = project.rootTracks
    .map(id => project.tracks[id])
    .filter((t): t is Track => !!t);
  const anyRootSoloed = rootTracks.some(t => t.solo);

  for (const track of rootTracks) {
    if (isTrackSkipped(track, anyRootSoloed)) continue;

    const resolved = resolveTrack(track, project, baseContext);
    results.push(...resolved);
  }

  // Also resolve scene tracks (and their mask children)
  const sceneTracks = (project.rootScenes ?? [])
    .map(id => project.tracks[id])
    .filter((t): t is Track => !!t);

  for (const track of sceneTracks) {
    const resolved = resolveTrack(track, project, baseContext);
    results.push(...resolved);
  }

  return results;
}

export function resolveTrack(
  track: Track,
  project: Project,
  context: ProcessContext,
  parentOutput?: Output,
  inheritedInstrumentId?: string,
  parentBlackoutRegions: BlackoutRegion[] = []
): ResolvedTrack[] {
  const results: ResolvedTrack[] = [];

  // Step 1: Resolve this track's blocks
  let selfOutput = resolveBlocks(track.blocks, project, context);

  // Step 2: Separate children into modifiers, regular, and automation tracks
  const { modifiers, regular, automation } = categorizeChildren(track, project);

  // Step 3: Apply modifier children to selfOutput
  const modifierResult = applyModifiers(selfOutput, modifiers, project, context, parentOutput);
  selfOutput = modifierResult.output;
  results.push(...modifierResult.results);

  // Step 4: Combine modified self with parent
  const trackType = getTrackType(track.typeId);
  const enrichedContext = buildContext(context, parentOutput, selfOutput);
  const combinedOutput = trackType.combine(
    parentOutput || { events: [] },
    selfOutput,
    enrichedContext
  );

  // Step 5: Build automation lanes from automation children
  const automationLanes = automation.length > 0
    ? buildAutomationLanes(automation, track, project, enrichedContext)
    : undefined;

  // Step 6: Build this track's resolved outputs (merge parent blackout regions)
  const mergedBlackoutRegions = [...parentBlackoutRegions, ...modifierResult.blackoutRegions];
  const trackOutputs = buildTrackOutputs(track, selfOutput, combinedOutput, inheritedInstrumentId, mergedBlackoutRegions);
  // Attach automation lanes to track outputs
  if (automationLanes && automationLanes.length > 0) {
    for (const output of trackOutputs) {
      output.automationLanes = automationLanes;
    }
  }
  results.push(...trackOutputs);

  // Step 7: Process regular children recursively
  // Inherit instrument if it has visual capabilities (for visual inheritance)
  const instrument = track.instrumentId ? getInstrument(track.instrumentId) : undefined;
  const instrumentToInherit = instrument?.hasVisual ? track.instrumentId : inheritedInstrumentId;
  for (const childTrack of regular) {
    const childResults = resolveTrack(childTrack, project, enrichedContext, combinedOutput, instrumentToInherit, mergedBlackoutRegions);
    results.push(...childResults);
  }

  return results;
}

export function resolveBlocks(
  blocks: Block[],
  project: Project,
  context: ProcessContext
): Output {
  const allEvents: Event[] = [];
  const totalBeats = context.totalBars * context.beatsPerBar;

  for (const block of blocks) {
    const blockStartBeat = block.startBar * context.beatsPerBar;
    const blockDurationBeats = block.durationBars * context.beatsPerBar;

    // Get events from block
    const blockEvents = resolveBlockEvents(block, project, context);

    // Handle looping
    if (block.loop) {
      // Get the natural duration of the events
      const maxEventTime = blockEvents.reduce(
        (max, e) => Math.max(max, e.startTimeInBeats + (e.duration || 0)),
        0
      );
      // Round up to the nearest bar to ensure patterns loop on bar boundaries
      const loopLength = maxEventTime > 0
        ? Math.ceil(maxEventTime / context.beatsPerBar) * context.beatsPerBar
        : blockDurationBeats;

      // Loop events to fill block duration
      let currentOffset = 0;
      while (currentOffset < blockDurationBeats) {
        for (const event of blockEvents) {
          const eventTime = blockStartBeat + currentOffset + event.startTimeInBeats;
          if (eventTime < blockStartBeat + blockDurationBeats && eventTime < totalBeats) {
            allEvents.push({
              ...event,
              startTimeInBeats: eventTime,
            });
          }
        }
        currentOffset += loopLength;
      }
    } else {
      // No looping - just offset events
      for (const event of blockEvents) {
        const eventTime = blockStartBeat + event.startTimeInBeats;
        if (eventTime < blockStartBeat + blockDurationBeats && eventTime < totalBeats) {
          allEvents.push({
            ...event,
            startTimeInBeats: eventTime,
          });
        }
      }
    }
  }

  // Sort by time
  allEvents.sort((a, b) => a.startTimeInBeats - b.startTimeInBeats);

  return { events: allEvents };
}

export function resolveBlockEvents(
  block: Block,
  project: Project,
  context: ProcessContext
): Event[] {
  // If block has inline events (streams), use those
  if (block.streams && block.streams.length > 0) {
    return block.streams.flatMap(s => s.events);
  }

  // If block references another block/track
  if (block.sourceTrackId) {
    const sourceTrack = project.tracks[block.sourceTrackId];
    if (!sourceTrack) return [];

    // Find the referenced block
    if (block.sourceBlockId) {
      const sourceBlock = sourceTrack.blocks.find(b => b.id === block.sourceBlockId);
      if (sourceBlock) {
        const events = resolveBlockEvents(sourceBlock, project, context);
        return extractEvents(events, block.extractMode || 'all');
      }
    }

    // Or use all blocks from source track
    const sourceOutput = resolveBlocks(sourceTrack.blocks, project, context);
    return extractEvents(sourceOutput.events, block.extractMode || 'all');
  }

  return [];
}

export function extractEvents(events: Event[], mode: 'timing' | 'pitch' | 'velocity' | 'all'): Event[] {
  switch (mode) {
    case 'timing':
      // Keep timing, use default pitch (C4) and velocity
      return events.map(e => ({ startTimeInBeats: e.startTimeInBeats, pitch: 60, velocity: 100, duration: e.duration }));
    case 'pitch':
      // Keep pitch and timing, use default velocity
      return events.map(e => ({ startTimeInBeats: e.startTimeInBeats, pitch: e.pitch, velocity: 100, duration: e.duration }));
    case 'velocity':
      // Keep velocity and timing, use default pitch (C4)
      return events.map(e => ({ startTimeInBeats: e.startTimeInBeats, pitch: 60, velocity: e.velocity, duration: e.duration }));
    case 'all':
    default:
      return events;
  }
}

export function buildContext(
  baseContext: ProcessContext,
  parentOutput?: Output,
  selfOutput?: Output
): ProcessContext {
  const context = { ...baseContext };

  // Try to find harmony info
  let harmony: HarmonyInfo | undefined;

  if (parentOutput) {
    harmony = findHarmonyInOutput(parentOutput);
    context.parentOutput = parentOutput;
  }

  if (!harmony && selfOutput) {
    harmony = findHarmonyInOutput(selfOutput);
  }

  if (harmony) {
    context.harmony = harmony;
    context.scale = deriveScaleFromHarmony(harmony);
  }

  return context;
}

// Helper to get all events from a project for a specific time range
export function getEventsInRange(
  resolvedTracks: ResolvedTrack[],
  startBeat: number,
  endBeat: number
): { trackId: string; instrumentId: string; events: Event[] }[] {
  return resolvedTracks
    .filter(rt => rt.instrumentId)
    .map(rt => ({
      trackId: rt.trackId,
      instrumentId: rt.instrumentId!,
      events: rt.output.events.filter(e => e.startTimeInBeats >= startBeat && e.startTimeInBeats < endBeat),
    }));
}
