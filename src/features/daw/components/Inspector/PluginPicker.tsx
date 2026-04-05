'use client';

import { useState, useRef, useEffect } from 'react';
import { getAllPlugins } from '@daw/plugins';
import { PluginCategory } from '@daw/plugins/types';

interface PluginPickerProps {
  onSelect: (pluginId: string) => void;
}

const CATEGORY_LABELS: Record<PluginCategory, string> = {
  transform: 'Transform',
  shader: 'Shader',
  clone: 'Clone',
};

const CATEGORY_ORDER: PluginCategory[] = ['transform', 'shader', 'clone'];

export function PluginPicker({ onSelect }: PluginPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const plugins = getAllPlugins();

  // Group plugins by category
  const pluginsByCategory = CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = plugins.filter((p) => p.category === category);
      return acc;
    },
    {} as Record<PluginCategory, typeof plugins>
  );

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (pluginId: string) => {
    onSelect(pluginId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 rounded-lg bg-accent-from/20 text-accent-from hover:bg-accent-from/30 transition-colors text-sm font-medium"
      >
        + Add Effect
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {CATEGORY_ORDER.map((category) => {
            const categoryPlugins = pluginsByCategory[category];
            if (categoryPlugins.length === 0) return null;

            return (
              <div key={category}>
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-background/50">
                  {CATEGORY_LABELS[category]}
                </div>
                {categoryPlugins.map((plugin) => (
                  <button
                    key={plugin.id}
                    onClick={() => handleSelect(plugin.id)}
                    className="w-full px-3 py-2 text-left hover:bg-accent-from/10 transition-colors"
                  >
                    <div className="text-sm font-medium">{plugin.name}</div>
                    <div className="text-xs text-muted-foreground">{plugin.description}</div>
                  </button>
                ))}
              </div>
            );
          })}

          {plugins.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              No plugins available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
