'use client';

import { useState, useRef, useEffect } from 'react';
import { FONT_OPTIONS, loadAllFonts } from '@daw/utils/fonts';

interface FontPickerProps {
  value: string;
  onChange: (value: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  display: 'Display',
  script: 'Script',
  marker: 'Marker',
  comic: 'Fun',
  serif: 'Serif',
  mono: 'Mono',
  sans: 'Sans',
};

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAllFonts();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = FONT_OPTIONS.find((f) => f.value === value) || FONT_OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-left flex items-center justify-between hover:border-accent-from/50 transition-colors"
      >
        <span
          style={{ fontFamily: `"${current.value}", sans-serif` }}
          className="text-sm truncate"
        >
          {current.label}
        </span>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ml-2 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-surface border border-border shadow-xl">
          {FONT_OPTIONS.map((font) => (
            <button
              key={font.value}
              type="button"
              onClick={() => {
                onChange(font.value);
                setOpen(false);
              }}
              className={`w-full px-3 py-2.5 text-left hover:bg-accent-from/10 transition-colors flex items-center gap-3 ${
                font.value === value
                  ? 'bg-accent-from/15 text-accent-from'
                  : 'text-foreground'
              }`}
            >
              <span
                style={{ fontFamily: `"${font.value}", sans-serif` }}
                className="text-base truncate flex-1"
              >
                {font.label}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0 opacity-60">
                {CATEGORY_LABELS[font.category] || font.category}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
