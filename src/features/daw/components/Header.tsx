'use client';

import { useState, useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { usePlayback } from '@daw/hooks/usePlayback';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { UndoRedoButtons } from './UndoRedoButtons';
import { ExportModal } from './ExportModal';

export function Header() {
  const { isPlaying, play, pause, seekTo, setBpm, setPlaybackSpeed } = usePlayback();
  const playbackSpeed = useUIStore((s) => s.playbackSpeed);
  // Granular selectors - only re-render when specific values change
  const projectId = useProjectStore((state) => state.project.id);
  const projectName = useProjectStore((state) => state.project.name);
  const bpm = useProjectStore((state) => state.project.bpm);
  const totalBars = useProjectStore((state) => state.project.totalBars);
  const beatsPerBar = useProjectStore((state) => state.project.beatsPerBar);
  const { setTotalBars, renameProject } = useProjectStore();
  const toggleLibrary = useUIStore((s) => s.toggleLibrary);
  const toggleInspector = useUIStore((s) => s.toggleInspector);
  const showLibrary = useUIStore((s) => s.showLibrary);
  const showInspector = useUIStore((s) => s.showInspector);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const setShowExportModal = useUIStore((s) => s.setShowExportModal);

  // Imperative beat display refs (avoids 60fps re-renders)
  const barDisplayRef = useRef<HTMLSpanElement>(null);
  const beatDisplayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId: number;
    const update = () => {
      const currentBeat = useUIStore.getState().currentBeat;
      const currentBar = Math.floor(currentBeat / beatsPerBar) + 1;
      const beatInBar = Math.floor(currentBeat % beatsPerBar) + 1;
      if (barDisplayRef.current) barDisplayRef.current.textContent = String(currentBar);
      if (beatDisplayRef.current) beatDisplayRef.current.textContent = String(beatInBar);
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [beatsPerBar]);

  // Local state for inputs to allow free typing without immediate clamping
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const [barsInput, setBarsInput] = useState(String(totalBars));
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(projectName);

  // Sync local state when project values change externally
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

  useEffect(() => {
    setBarsInput(String(totalBars));
  }, [totalBars]);

  useEffect(() => {
    setEditName(projectName);
  }, [projectName]);

  const handleSaveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== projectName) {
      renameProject(projectId, trimmed);
    } else {
      setEditName(projectName);
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      setEditName(projectName);
      setIsEditingName(false);
    }
  };

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-surface border-b border-border">
      {/* Left Section - Home Button, Project Name & Controls */}
      <div className="flex items-center gap-4">
        {/* Home Button */}
        <button
          onClick={() => setCurrentView('home')}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          title="Home"
        >
          <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>

        {/* Editable Project Name */}
        {isEditingName ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={handleNameKeyDown}
            autoFocus
            className="px-2 py-1 text-xl font-bold bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
          />
        ) : (
          <button
            onClick={() => setIsEditingName(true)}
            className="px-2 py-1 rounded-lg hover:bg-muted transition-colors"
            title="Click to rename"
          >
            <span className="text-xl font-bold bg-gradient-to-r from-accent-from to-accent-to bg-clip-text text-transparent">
              {projectName}
            </span>
          </button>
        )}

        <button
          onClick={() => toggleLibrary()}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            showLibrary
              ? 'bg-gradient-to-r from-accent-from/20 to-accent-to/20 text-accent-from'
              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
          }`}
        >
          Library
        </button>

        <UndoRedoButtons />
      </div>

      {/* Center Section - Transport */}
      <div className="flex items-center gap-6">
        {/* Transport Control - Stop/Rewind + Play */}
        <div className="flex rounded-lg bg-white/[0.04] p-1 my-1">
          {/* Stop / Rewind Button */}
          <button
            onClick={() => {
              if (isPlaying) {
                pause();
              } else if (useUIStore.getState().currentBeat > 0) {
                seekTo(0);
              }
            }}
            className="w-12 h-12 rounded-l-md flex items-center justify-center text-lg transition-all active:bg-muted/80 active:scale-95 bg-surface hover:bg-muted text-foreground"
            aria-label={isPlaying ? 'Pause' : 'Stop'}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="5" width="4" height="14" />
                <polygon points="20,5 20,19 9,12" />
              </svg>
            )}
          </button>
          {/* Play Button */}
          <button
            onClick={() => {
              if (!isPlaying) {
                play();
              }
            }}
            className={`w-12 h-12 rounded-r-md flex items-center justify-center text-lg transition-all active:scale-95 ${
              isPlaying
                ? 'bg-gradient-to-r from-accent-from to-accent-to text-white glow-accent'
                : 'bg-surface hover:bg-muted text-foreground active:bg-muted/80'
            }`}
            aria-label="Play"
          >
            <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </button>
        </div>

        {/* Speed Toggle */}
        <button
          onClick={() => {
            const next = playbackSpeed === 1 ? 0.5 : playbackSpeed === 0.5 ? 0.25 : 1;
            setPlaybackSpeed(next);
          }}
          className={`px-2 py-1 rounded-lg text-sm font-mono transition-colors ${
            playbackSpeed !== 1
              ? 'bg-gradient-to-r from-accent-from/20 to-accent-to/20 text-accent-from'
              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
          }`}
          title="Playback speed"
        >
          {playbackSpeed === 1 ? '1x' : playbackSpeed === 0.5 ? '1/2x' : '1/4x'}
        </button>

        {/* Position Display */}
        <div className="bg-background rounded-lg px-4 py-2 font-mono text-lg w-20 text-center">
          <span ref={barDisplayRef} className="text-foreground">1</span>
          <span className="text-muted-foreground">.</span>
          <span ref={beatDisplayRef} className="text-muted-foreground">1</span>
        </div>

        {/* BPM Control */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">BPM</label>
          <input
            type="text"
            inputMode="numeric"
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={() => {
              const val = parseInt(bpmInput);
              if (isNaN(val) || val < 20) {
                setBpm(20);
                setBpmInput('20');
              } else if (val > 300) {
                setBpm(300);
                setBpmInput('300');
              } else {
                setBpm(val);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="w-16 px-2 py-1 rounded-lg bg-background border border-border text-center text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
          />
          <input
            type="range"
            value={bpm}
            onChange={(e) => setBpm(parseInt(e.target.value))}
            className="w-24"
            min={20}
            max={300}
          />
        </div>

        {/* Bars Control */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Bars</label>
          <input
            type="text"
            inputMode="numeric"
            value={barsInput}
            onChange={(e) => setBarsInput(e.target.value)}
            onBlur={() => {
              const val = parseInt(barsInput);
              if (isNaN(val) || val < 1) {
                setTotalBars(1);
                setBarsInput('1');
              } else if (val > 512) {
                setTotalBars(512);
                setBarsInput('512');
              } else {
                setTotalBars(val);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="w-14 px-2 py-1 rounded-lg bg-background border border-border text-center text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
          />
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-blue-500 hover:bg-blue-400 text-white font-medium transition-all duration-200 hover:scale-105 hover:shadow-[0_0_12px_rgba(59,130,246,0.7)]"
        >
          <Download size={14} strokeWidth={2.5} />
          Export
        </button>
        <button
          onClick={() => toggleInspector()}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            showInspector
              ? 'bg-gradient-to-r from-accent-from/20 to-accent-to/20 text-accent-from'
              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
          }`}
        >
          Inspector
        </button>
      </div>

      <ExportModal />
    </header>
  );
}
