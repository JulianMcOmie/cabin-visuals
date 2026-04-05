'use client';

import { useState, useCallback, useMemo, DragEvent } from 'react';
import { Track, TrackTypeId } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { TRACK_TYPES } from '@daw/core/trackTypes';
import { INSTRUMENTS, getInstrument, getInstrumentOptions, getAllInstruments, getMaskInstruments } from '@daw/instruments';
import { PluginInspector } from './PluginInspector';
import { FontPicker } from './FontPicker';
import { SettingsSchema } from '@daw/instruments/types';
import { getAvailableVariants } from '@daw/utils/fonts';
import { getPlugin } from '@daw/plugins';
import { storeVideoFile } from '@daw/services/videoStorage';
import { generateId } from '@daw/utils/id';

type InspectorTab = 'settings' | 'effects';

interface TrackInspectorProps {
  track: Track;
}

const TRACK_TYPE_OPTIONS: { id: TrackTypeId; label: string; category: string }[] = [
  { id: 'base', label: 'Base', category: 'Source' },
  { id: 'rest', label: 'Rest', category: 'Source' },
  { id: 'add', label: 'Add', category: 'Combiner' },
  { id: 'override', label: 'Override', category: 'Combiner' },
  { id: 'gate', label: 'Gate', category: 'Modifier' },
  { id: 'shift', label: 'Shift', category: 'Modifier' },
  { id: 'transpose', label: 'Transpose', category: 'Modifier' },
  { id: 'scale', label: 'Scale Velocity', category: 'Modifier' },
  { id: 'scaleShift', label: 'Scale Shift', category: 'Modifier' },
  { id: 'harmonyMap', label: 'Harmony Map', category: 'Mapper' },
];

// Get instrument options for dropdown (static base list)
const ALL_INSTRUMENT_OPTIONS = getInstrumentOptions();

// Find inherited instrument (with visual capability) by walking up the parent chain
function getInheritedInstrument(
  track: Track,
  tracks: Record<string, Track>
): string | undefined {
  const instrument = track.instrumentId ? getInstrument(track.instrumentId) : undefined;
  if (instrument?.hasVisual) return track.instrumentId;
  if (!track.parentId) return undefined;

  let current = tracks[track.parentId];
  while (current) {
    const parentInstrument = current.instrumentId ? getInstrument(current.instrumentId) : undefined;
    if (parentInstrument?.hasVisual) return current.instrumentId;
    if (!current.parentId) break;
    current = tracks[current.parentId];
  }
  return undefined;
}

export function TrackInspector({ track }: TrackInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('settings');
  const [videoDragOver, setVideoDragOver] = useState(false);
  const { updateTrack, deleteTrack } = useProjectStore();
  const tracks = useProjectStore((s) => s.project.tracks);
  const selectTrack = useUIStore((s) => s.selectTrack);

  const rootScenes = useProjectStore((s) => s.project.rootScenes);
  const { assignTrackToScene, addMaskToScene } = useProjectStore();
  const isVideoSampler = track.instrumentId === 'videoSampler';

  // Filter singleton instruments already in use on other tracks
  const instrumentOptions = useMemo(() => {
    const singletonIds = new Set(
      getAllInstruments().filter((i) => i.singleton).map((i) => i.id),
    );
    const usedSingletons = new Set(
      Object.values(tracks)
        .filter((t) => t.id !== track.id && t.instrumentId && singletonIds.has(t.instrumentId))
        .map((t) => t.instrumentId!),
    );
    return ALL_INSTRUMENT_OPTIONS.filter((opt) => !usedSingletons.has(opt.id));
  }, [tracks, track.id]);

  const handleVideoDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setVideoDragOver(false);
      if (!isVideoSampler) return;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      const videoExts = /\.(mp4|webm|mov)$/i;
      if (!videoExts.test(file.name)) return;

      try {
        const videoStorageId = generateId();

        const metadata = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
            URL.revokeObjectURL(video.src);
          };
          video.onerror = () => {
            URL.revokeObjectURL(video.src);
            reject(new Error('Failed to load video metadata'));
          };
          video.src = URL.createObjectURL(file);
        });

        await storeVideoFile(videoStorageId, file, {
          fileName: file.name,
          mimeType: file.type,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
        });

        updateTrack(track.id, {
          instrumentSettings: {
            ...track.instrumentSettings,
            videoStorageId,
          },
        });
      } catch (error) {
        console.error('Error replacing video:', error);
      }
    },
    [isVideoSampler, track.id, track.instrumentSettings, updateTrack]
  );

  const handleVideoDragOver = useCallback(
    (e: DragEvent) => {
      if (!isVideoSampler) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setVideoDragOver(true);
    },
    [isVideoSampler]
  );

  const handleVideoDragLeave = useCallback(
    (e: DragEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement;
      const currentTarget = e.currentTarget as HTMLElement;
      if (!currentTarget.contains(relatedTarget)) {
        setVideoDragOver(false);
      }
    },
    []
  );

  const trackType = TRACK_TYPES[track.typeId];
  const instrument = track.instrumentId ? getInstrument(track.instrumentId) : undefined;

  // Check if track has a visual instrument (for showing Effects tab)
  // Also show for groups (tracks with children) so they can apply effects to children
  const effectiveInstrumentForEffects = getInheritedInstrument(track, tracks);
  const hasVisualInstrument = effectiveInstrumentForEffects
    ? getInstrument(effectiveInstrumentForEffects)?.hasVisual
    : false;
  const isGroup = track.childIds.length > 0;
  const showEffectsTab = hasVisualInstrument || isGroup;

  // Get effective instrument (own or inherited for visual settings)
  const effectiveInstrumentId = getInheritedInstrument(track, tracks);
  const effectiveInstrument = effectiveInstrumentId ? getInstrument(effectiveInstrumentId) : undefined;
  const isInherited = effectiveInstrumentId && !track.instrumentId;

  const handleDelete = () => {
    if (confirm('Delete this track and all its children?')) {
      deleteTrack(track.id);
      selectTrack(null);
    }
  };

  const handleInstrumentChange = (instrumentId: string | undefined) => {
    const newInstrument = instrumentId ? getInstrument(instrumentId) : undefined;
    updateTrack(track.id, {
      instrumentId: instrumentId || undefined,
      instrumentSettings: newInstrument ? { ...newInstrument.defaultSettings } : undefined,
    });
  };

  const handleSettingChange = (key: string, value: unknown) => {
    updateTrack(track.id, {
      instrumentSettings: {
        ...track.instrumentSettings,
        [key]: value,
      },
    });
  };

  return (
    <div
      className="space-y-4"
      onDrop={handleVideoDrop}
      onDragOver={handleVideoDragOver}
      onDragLeave={handleVideoDragLeave}
    >
      {/* Video drop zone indicator */}
      {isVideoSampler && videoDragOver && (
        <div className="rounded-lg border-2 border-dashed border-accent-from/60 bg-accent-from/10 p-4 text-center">
          <p className="text-sm text-accent-from">Drop video to replace</p>
        </div>
      )}

      {/* Tab switcher */}
      {showEffectsTab && (
        <div className="flex gap-1 p-1 bg-background rounded-lg">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'settings'
                ? 'bg-surface text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setActiveTab('effects')}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'effects'
                ? 'bg-surface text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Effects
            {(track.visualPlugins?.length ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-accent-from/20 text-accent-from rounded">
                {track.visualPlugins?.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Effects Tab */}
      {activeTab === 'effects' && showEffectsTab && <PluginInspector track={track} />}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <>
          {/* Track Name */}
          <div>
            <label htmlFor="track-name" className="block text-xs text-muted-foreground mb-1">Name</label>
            <input
              id="track-name"
              type="text"
              value={track.name}
              onChange={(e) => updateTrack(track.id, { name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
            />
          </div>

          {/* Scene settings (scene tracks only) */}
          {track.typeId === 'scene' && (
            <>
              <div>
                <label htmlFor="add-mask" className="block text-xs text-muted-foreground mb-1">Add Mask</label>
                <select
                  id="add-mask"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addMaskToScene(track.id, e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
                >
                  <option value="">Select mask...</option>
                  {getMaskInstruments().map((mask) => (
                    <option key={mask.id} value={mask.id}>
                      {mask.icon} {mask.name}
                    </option>
                  ))}
                </select>
                {track.childIds.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {track.childIds.length} mask{track.childIds.length !== 1 ? 's' : ''} applied (multiply)
                  </p>
                )}
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={track.sceneOpaque ?? false}
                    onChange={(e) => updateTrack(track.id, { sceneOpaque: e.target.checked })}
                    className="rounded border-border bg-background accent-accent-from"
                  />
                  <span className="text-sm text-foreground">Opaque background</span>
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  When enabled, empty areas in this scene block content behind it
                </p>
              </div>
            </>
          )}

          {/* Track Type */}
          <div>
            <label htmlFor="track-type" className="block text-xs text-muted-foreground mb-1">Track Type</label>
            <select
              id="track-type"
              value={track.typeId}
              onChange={(e) => updateTrack(track.id, { typeId: e.target.value as TrackTypeId })}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
            >
              {TRACK_TYPE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} ({opt.category})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">{trackType?.description}</p>
          </div>

          {/* Unified Instrument (hidden for automation tracks) */}
          {!track.automationConfig && (
            <div>
              <label htmlFor="track-instrument" className="block text-xs text-muted-foreground mb-1">Instrument</label>
              <select
                id="track-instrument"
                value={track.instrumentId || ''}
                onChange={(e) => handleInstrumentChange(e.target.value || undefined)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
              >
                <option value="">None (modifier only)</option>
                {instrumentOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {instrument && (
                <p className="text-xs text-muted-foreground mt-1">
                  {instrument.description}
                  {instrument.hasAudio && instrument.hasVisual && ' (Audio + Visual)'}
                  {instrument.hasAudio && !instrument.hasVisual && ' (Audio)'}
                  {!instrument.hasAudio && instrument.hasVisual && ' (Visual)'}
                </p>
              )}
            </div>
          )}

          {/* Scene Assignment (only for visual tracks when scenes exist) */}
          {!track.automationConfig && hasVisualInstrument && rootScenes.length > 0 && (
            <div>
              <label htmlFor="track-scene" className="block text-xs text-muted-foreground mb-1">Scene</label>
              <select
                id="track-scene"
                value={track.sceneId || ''}
                onChange={(e) => assignTrackToScene(track.id, e.target.value || undefined)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
              >
                <option value="">Main (default)</option>
                {rootScenes.map((sceneId) => {
                  const sceneTrack = tracks[sceneId];
                  return (
                    <option key={sceneId} value={sceneId}>
                      {sceneTrack?.name || sceneId}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Instrument Settings - Dynamic based on settingsSchema (hidden for automation tracks) */}
          {/* Use own instrument if it has a schema (e.g. masks), otherwise fall back to inherited */}
          {!track.automationConfig && (instrument?.settingsSchema || effectiveInstrument?.settingsSchema) && (
            <div className="space-y-3 pl-3 border-l-2 border-accent-from/30">
              <label className="block text-xs text-muted-foreground">
                Settings{!instrument?.settingsSchema && isInherited && ' (inherited instrument)'}
              </label>

              {Object.entries((instrument?.settingsSchema || effectiveInstrument?.settingsSchema)!).map(([key, field]) => (
                <div key={key}>
                  {field.type === 'number' && (
                    <>
                      <label className="block text-xs text-muted-foreground mb-1">
                        {field.label}
                      </label>
                      <input
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={(track.instrumentSettings?.[key] as number) ?? field.default}
                        onChange={(e) => handleSettingChange(key, parseFloat(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
                      />
                    </>
                  )}

                  {field.type === 'boolean' && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(track.instrumentSettings?.[key] as boolean) ?? field.default}
                        onChange={(e) => handleSettingChange(key, e.target.checked)}
                        className="w-4 h-4 rounded border-border accent-accent-from"
                      />
                      <span className="text-sm">{field.label}</span>
                    </label>
                  )}

                  {field.type === 'string' && (
                    <>
                      <label className="block text-xs text-muted-foreground mb-1">
                        {field.label}
                      </label>
                      <textarea
                        value={(track.instrumentSettings?.[key] as string) ?? (field.default as string)}
                        onChange={(e) => handleSettingChange(key, e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from resize-y min-h-[4rem]"
                      />
                    </>
                  )}
                  {field.type === 'select' && field.options && (
                    <>
                      <label className="block text-xs text-muted-foreground mb-1">
                        {field.label}
                      </label>
                      <select
                        value={(track.instrumentSettings?.[key] as string) ?? field.default}
                        onChange={(e) => handleSettingChange(key, e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
                      >
                        {field.options.map((opt) => (
                          <option key={String(opt.value)} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {field.type === 'font' && (
                    <>
                      <label className="block text-xs text-muted-foreground mb-1">
                        {field.label}
                      </label>
                      <FontPicker
                        value={(track.instrumentSettings?.[key] as string) ?? (field.default as string)}
                        onChange={(v) => handleSettingChange(key, v)}
                      />
                    </>
                  )}

                  {field.type === 'fontVariant' && (() => {
                    const currentFont = (track.instrumentSettings?.fontFamily as string) ?? 'Impact';
                    const variants = getAvailableVariants(currentFont);
                    const currentValue = (track.instrumentSettings?.[key] as string) ?? (field.default as string);
                    const isValid = variants.some((v) => v.value === currentValue);
                    // Show the closest valid value in the dropdown; the runtime
                    // in TextDisplay already falls back via ?? on the default
                    const effectiveValue = isValid ? currentValue : variants[0]?.value ?? currentValue;
                    return variants.length > 1 ? (
                      <>
                        <label className="block text-xs text-muted-foreground mb-1">
                          {field.label}
                        </label>
                        <select
                          value={effectiveValue}
                          onChange={(e) => handleSettingChange(key, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
                        >
                          {variants.map((v) => (
                            <option key={v.value} value={v.value}>{v.label}</option>
                          ))}
                        </select>
                      </>
                    ) : null;
                  })()}

                  {field.type === 'color' && (
                    <>
                      <label className="block text-xs text-muted-foreground mb-1">
                        {field.label}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={(track.instrumentSettings?.[key] as string) ?? (field.default as string)}
                          onChange={(e) => handleSettingChange(key, e.target.value)}
                          className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                        />
                        <input
                          type="text"
                          value={(track.instrumentSettings?.[key] as string) ?? (field.default as string)}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(v.slice(1)) && v.startsWith('#')) {
                              handleSettingChange(key, v);
                            }
                          }}
                          maxLength={7}
                          className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-from"
                        />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Automation Track Config */}
          {track.automationConfig && (() => {
            const parentTrack = track.parentId ? tracks[track.parentId] : undefined;
            const parentInstrument = parentTrack?.instrumentId ? getInstrument(parentTrack.instrumentId) : undefined;
            const instrumentSchema = parentInstrument?.settingsSchema as SettingsSchema | undefined;
            const instrumentParams = instrumentSchema
              ? Object.entries(instrumentSchema).filter(([, field]) => field.type === 'number')
              : [];

            // Gather plugin params from parent's visualPlugins
            const pluginParams: { instanceId: string; pluginName: string; key: string; label: string }[] = [];
            for (const pi of parentTrack?.visualPlugins ?? []) {
              const plugin = getPlugin(pi.pluginId);
              // Always add "Enabled" as a virtual param
              pluginParams.push({ instanceId: pi.id, pluginName: plugin?.name ?? pi.pluginId, key: 'enabled', label: 'Enabled' });
              if (!plugin?.settingsSchema) continue;
              for (const [key, field] of Object.entries(plugin.settingsSchema)) {
                if (field.type === 'number') {
                  pluginParams.push({ instanceId: pi.id, pluginName: plugin.name, key, label: field.label });
                }
              }
            }

            // Encode selection as "paramKey" for instrument or "plugin:instanceId:paramKey" for plugins
            const currentValue = track.automationConfig!.pluginInstanceId
              ? `plugin:${track.automationConfig!.pluginInstanceId}:${track.automationConfig!.targetParam}`
              : track.automationConfig!.targetParam;

            const handleTargetChange = (encoded: string) => {
              if (encoded.startsWith('plugin:')) {
                const parts = encoded.split(':');
                const instanceId = parts[1];
                const paramKey = parts.slice(2).join(':');
                const pi = parentTrack?.visualPlugins?.find(p => p.id === instanceId);
                const plugin = pi ? getPlugin(pi.pluginId) : undefined;
                const label = paramKey === 'enabled' ? 'Enabled' : (plugin?.settingsSchema?.[paramKey]?.label ?? paramKey);
                updateTrack(track.id, {
                  name: `${plugin?.name ?? 'Effect'}: ${label}`,
                  automationConfig: {
                    ...track.automationConfig!,
                    targetParam: paramKey,
                    pluginInstanceId: instanceId,
                  },
                });
              } else {
                const label = (instrumentSchema?.[encoded]?.label ?? encoded) || 'Automation';
                updateTrack(track.id, {
                  name: label,
                  automationConfig: {
                    ...track.automationConfig!,
                    targetParam: encoded,
                    pluginInstanceId: undefined,
                  },
                });
              }
            };

            return (
              <div className="space-y-3 pl-3 border-l-2 border-accent-from/30">
                <label htmlFor="automation-target" className="block text-xs text-muted-foreground">Automation</label>

                {/* Hierarchical target parameter picker */}
                <div>
                  <label htmlFor="automation-target" className="block text-xs text-muted-foreground mb-1">Target Parameter</label>
                  <select
                    id="automation-target"
                    value={currentValue}
                    onChange={(e) => handleTargetChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
                  >
                    {!currentValue && (
                      <option value="">Select parameter...</option>
                    )}
                    {instrumentParams.length > 0 && (
                      <optgroup label={parentInstrument?.name ?? 'Instrument'}>
                        {instrumentParams.map(([key, field]) => (
                          <option key={key} value={key}>{field.label}</option>
                        ))}
                      </optgroup>
                    )}
                    {/* Group plugin params by plugin instance */}
                    {(() => {
                      const grouped = new Map<string, typeof pluginParams>();
                      for (const pp of pluginParams) {
                        const key = pp.instanceId;
                        if (!grouped.has(key)) grouped.set(key, []);
                        grouped.get(key)!.push(pp);
                      }
                      return Array.from(grouped.entries()).map(([instanceId, params]) => (
                        <optgroup key={instanceId} label={params[0].pluginName}>
                          {params.map(pp => (
                            <option key={`${instanceId}:${pp.key}`} value={`plugin:${instanceId}:${pp.key}`}>
                              {pp.label}
                            </option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  {/* Show current default value for the selected parameter */}
                  {currentValue && (() => {
                    let defaultVal: string | undefined;
                    if (currentValue.startsWith('plugin:')) {
                      const parts = currentValue.split(':');
                      const instanceId = parts[1];
                      const paramKey = parts.slice(2).join(':');
                      const pi = parentTrack?.visualPlugins?.find(p => p.id === instanceId);
                      if (paramKey === 'enabled') {
                        defaultVal = pi?.enabled ? 'On' : 'Off';
                      } else {
                        const plugin = pi ? getPlugin(pi.pluginId) : undefined;
                        const val = pi?.settings?.[paramKey];
                        const schemaDefault = plugin?.settingsSchema?.[paramKey]?.default;
                        defaultVal = val !== undefined ? String(val) : (schemaDefault !== undefined ? String(schemaDefault) : undefined);
                      }
                    } else {
                      const val = parentTrack?.instrumentSettings?.[currentValue];
                      const schemaDefault = instrumentSchema?.[currentValue]?.default;
                      defaultVal = val !== undefined ? String(val) : (schemaDefault !== undefined ? String(schemaDefault) : undefined);
                    }
                    return defaultVal !== undefined ? (
                      <p className="text-xs text-muted-foreground mt-1">Current default: <span className="text-foreground">{defaultVal}</span></p>
                    ) : null;
                  })()}
                </div>

                <div>
                  <label htmlFor="automation-interpolation" className="block text-xs text-muted-foreground mb-1">Interpolation</label>
                  <select
                    id="automation-interpolation"
                    value={track.automationConfig!.interpolation ?? (track.automationConfig!.interpolate ? 'linear' : 'step')}
                    onChange={(e) =>
                      updateTrack(track.id, {
                        automationConfig: {
                          ...track.automationConfig!,
                          interpolation: e.target.value as import('@daw/core/types').InterpolationMode,
                          interpolate: e.target.value !== 'step',
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
                  >
                    <option value="step">Step (instant)</option>
                    <option value="linear">Linear</option>
                    <option value="ease-in">Ease In</option>
                    <option value="ease-out">Ease Out</option>
                    <option value="ease-in-out">Ease In-Out</option>
                    <option value="exponential">Exponential</option>
                    <option value="smooth-step">Smooth Step</option>
                  </select>
                </div>
              </div>
            );
          })()}

          {/* Mute Toggle */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={track.muted}
                onChange={(e) => updateTrack(track.id, { muted: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent-from"
              />
              <span className="text-sm">Muted</span>
            </label>
          </div>

          {/* Stats */}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {track.blocks.length} block{track.blocks.length !== 1 ? 's' : ''} •{' '}
              {track.childIds.length} child track{track.childIds.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Delete Button (hidden for master track) */}
          {track.typeId !== 'master' && (
            <div className="pt-4">
              <button
                onClick={handleDelete}
                className="w-full px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Delete Track
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
