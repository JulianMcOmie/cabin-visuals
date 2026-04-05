'use client';

import { Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { getPlugin } from '@daw/plugins';
import { PluginPicker } from './PluginPicker';

interface PluginInspectorProps {
  track: Track;
}

export function PluginInspector({ track }: PluginInspectorProps) {
  const { addVisualPlugin, updateVisualPlugin, deleteVisualPlugin, reorderVisualPlugins } =
    useProjectStore();
  const plugins = track.visualPlugins ?? [];

  const handleAddPlugin = (pluginId: string) => {
    addVisualPlugin(track.id, pluginId);
  };

  const handleToggle = (instanceId: string, enabled: boolean) => {
    updateVisualPlugin(track.id, instanceId, { enabled });
  };

  const handleDelete = (instanceId: string) => {
    deleteVisualPlugin(track.id, instanceId);
  };

  const handleMoveUp = (index: number) => {
    if (index > 0) {
      reorderVisualPlugins(track.id, index, index - 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (index < plugins.length - 1) {
      reorderVisualPlugins(track.id, index, index + 1);
    }
  };

  const handleSettingChange = (instanceId: string, key: string, value: unknown) => {
    const instance = plugins.find((p) => p.id === instanceId);
    if (!instance) return;

    updateVisualPlugin(track.id, instanceId, {
      settings: {
        ...instance.settings,
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Plugin chain */}
      {plugins.length > 0 && (
        <div className="space-y-2">
          {plugins.map((instance, index) => {
            const plugin = getPlugin(instance.pluginId);
            if (!plugin) return null;

            return (
              <div
                key={instance.id}
                className={`rounded-lg border ${
                  instance.enabled ? 'border-border bg-surface' : 'border-border/50 bg-surface/50'
                }`}
              >
                {/* Plugin header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => handleToggle(instance.id, !instance.enabled)}
                    className={`w-5 h-5 rounded flex items-center justify-center text-xs ${
                      instance.enabled
                        ? 'bg-accent-from text-white'
                        : 'bg-muted-foreground/20 text-muted-foreground'
                    }`}
                  >
                    {instance.enabled ? '✓' : '○'}
                  </button>

                  {/* Plugin name */}
                  <span
                    className={`flex-1 text-sm font-medium ${
                      instance.enabled ? '' : 'text-muted-foreground'
                    }`}
                  >
                    {plugin.name}
                  </span>

                  {/* Reorder buttons */}
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === plugins.length - 1}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    ↓
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(instance.id)}
                    className="p-1 text-red-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>

                {/* Plugin settings (inline for now, floating window later) */}
                {instance.enabled && plugin.settingsSchema && (
                  <div className="p-3 space-y-3">
                    {Object.entries(plugin.settingsSchema).map(([key, field]) => (
                      <div key={key}>
                        {field.type === 'number' && (
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-muted-foreground w-20">
                              {field.label}
                            </label>
                            <input
                              type="range"
                              min={field.min}
                              max={field.max}
                              step={field.step}
                              value={(instance.settings[key] as number) ?? field.default}
                              onChange={(e) =>
                                handleSettingChange(instance.id, key, parseFloat(e.target.value))
                              }
                              className="flex-1"
                            />
                            <span className="text-xs text-muted-foreground w-10 text-right">
                              {((instance.settings[key] as number) ?? field.default).toFixed(1)}
                            </span>
                          </div>
                        )}

                        {field.type === 'boolean' && (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(instance.settings[key] as boolean) ?? field.default}
                              onChange={(e) =>
                                handleSettingChange(instance.id, key, e.target.checked)
                              }
                              className="w-4 h-4 rounded border-border accent-accent-from"
                            />
                            <span className="text-sm">{field.label}</span>
                          </label>
                        )}

                        {field.type === 'select' && field.options && (
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-muted-foreground w-20">
                              {field.label}
                            </label>
                            <select
                              value={(instance.settings[key] as string) ?? field.default}
                              onChange={(e) =>
                                handleSettingChange(instance.id, key, e.target.value)
                              }
                              className="flex-1 px-2 py-1 rounded bg-background border border-border text-sm"
                            >
                              {field.options.map((opt) => (
                                <option key={String(opt.value)} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {plugins.length === 0 && (
        <div className="text-center py-6 text-muted-foreground text-sm">
          No effects added yet
        </div>
      )}

      {/* Add plugin button */}
      <PluginPicker onSelect={handleAddPlugin} />
    </div>
  );
}
