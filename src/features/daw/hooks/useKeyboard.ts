'use client';

import { useEffect, useCallback } from 'react';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { useHistoryStore } from '@daw/stores/history';
import { usePlayback } from './usePlayback';

export function useKeyboard() {
  const { toggle } = usePlayback();
  const selectedTrackId = useUIStore((s) => s.selectedTrackId);
  const selectedTrackIds = useUIStore((s) => s.selectedTrackIds);
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds);
  const selectTrack = useUIStore((s) => s.selectTrack);
  const selectBlock = useUIStore((s) => s.selectBlock);
  const clearBlockSelection = useUIStore((s) => s.clearBlockSelection);
  const setPixelsPerBeat = useUIStore((s) => s.setPixelsPerBeat);
  const pixelsPerBeat = useUIStore((s) => s.pixelsPerBeat);

  const { deleteTrack, deleteBlock, splitBlockAtPosition, groupTracks, joinBlocks } = useProjectStore();
  const project = useProjectStore((state) => state.project);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if focused on input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Check if we're inside an editor panel (chord editor, drum editor, etc.)
      // These panels handle their own delete key behavior
      const isInEditorPanel = target.closest('[data-editor-panel]') !== null;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          toggle();
          break;

        case 'Delete':
        case 'Backspace':
          // Skip if inside an editor panel - let the panel handle it
          if (isInEditorPanel) {
            return;
          }
          if (selectedBlockIds.size > 0) {
            // Delete all selected blocks
            // We need to find which track each block belongs to
            const tracks = Object.values(project.tracks);
            selectedBlockIds.forEach((blockId) => {
              for (const track of tracks) {
                const block = track.blocks.find((b) => b.id === blockId);
                if (block) {
                  deleteBlock(track.id, blockId);
                  break;
                }
              }
            });
            clearBlockSelection();
          } else if (selectedTrackId) {
            deleteTrack(selectedTrackId);
            selectTrack(null);
          }
          break;

        case 'Escape':
          selectTrack(null);
          clearBlockSelection();
          break;

        case 'Equal':
        case 'NumpadAdd':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setPixelsPerBeat(pixelsPerBeat + 5);
          }
          break;

        case 'Minus':
        case 'NumpadSubtract':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setPixelsPerBeat(pixelsPerBeat - 5);
          }
          break;

        case 'KeyM':
          if (selectedTrackId) {
            const track = project.tracks[selectedTrackId];
            if (track) {
              useProjectStore.getState().updateTrack(selectedTrackId, { muted: !track.muted });
            }
          }
          break;

        case 'KeyS':
          if (selectedTrackId && !e.metaKey && !e.ctrlKey) {
            const track = project.tracks[selectedTrackId];
            if (track) {
              useProjectStore.getState().updateTrack(selectedTrackId, { solo: !track.solo });
            }
          }
          break;

        case 'ArrowUp':
          if (selectedTrackId) {
            e.preventDefault();
            // Find previous visible track
            const trackIds = Object.keys(project.tracks);
            const currentIndex = trackIds.indexOf(selectedTrackId);
            if (currentIndex > 0) {
              selectTrack(trackIds[currentIndex - 1]);
            }
          }
          break;

        case 'ArrowDown':
          if (selectedTrackId) {
            e.preventDefault();
            // Find next visible track
            const trackIds = Object.keys(project.tracks);
            const currentIndex = trackIds.indexOf(selectedTrackId);
            if (currentIndex < trackIds.length - 1) {
              selectTrack(trackIds[currentIndex + 1]);
            }
          }
          break;

        case 'KeyZ':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) {
              useHistoryStore.getState().redo();
            } else {
              useHistoryStore.getState().undo();
            }
          }
          break;

        case 'KeyY':
          if (e.ctrlKey) {
            e.preventDefault();
            useHistoryStore.getState().redo();
          }
          break;

        case 'KeyT':
          // Cmd/Ctrl + T: Split selected blocks at playhead
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (selectedBlockIds.size > 0) {
              const tracks = Object.values(project.tracks);
              const beatsPerBar = project.beatsPerBar;
              const playheadBar = useUIStore.getState().currentBeat / beatsPerBar;

              // Track new block IDs for selection
              const newBlockIds: string[] = [];

              selectedBlockIds.forEach((blockId) => {
                for (const track of tracks) {
                  const block = track.blocks.find((b) => b.id === blockId);
                  if (block) {
                    // Check if playhead is inside this block
                    const blockEnd = block.startBar + block.durationBars;
                    if (playheadBar > block.startBar && playheadBar < blockEnd) {
                      const newBlockId = splitBlockAtPosition(
                        track.id,
                        blockId,
                        playheadBar,
                        beatsPerBar
                      );
                      if (newBlockId) {
                        newBlockIds.push(newBlockId);
                      }
                    }
                    break;
                  }
                }
              });

              // Add new blocks to selection
              if (newBlockIds.length > 0) {
                useUIStore.getState().selectBlocks([
                  ...Array.from(selectedBlockIds),
                  ...newBlockIds,
                ]);
              }
            }
          }
          break;

        case 'KeyJ':
          // Cmd/Ctrl + J: Join selected blocks
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (selectedBlockIds.size >= 2) {
              const tracks = Object.values(project.tracks);
              const beatsPerBar = project.beatsPerBar;

              // Find which track contains the selected blocks — all must be on same track
              let targetTrackId: string | null = null;
              const foundBlockIds: string[] = [];

              for (const track of tracks) {
                const matching = track.blocks.filter(b => selectedBlockIds.has(b.id));
                if (matching.length > 0) {
                  if (targetTrackId && targetTrackId !== track.id) {
                    // Blocks on multiple tracks — can't join
                    targetTrackId = null;
                    break;
                  }
                  targetTrackId = track.id;
                  foundBlockIds.push(...matching.map(b => b.id));

                  // Reject if any are looped
                  if (matching.some(b => b.loop)) {
                    targetTrackId = null;
                    break;
                  }
                }
              }

              if (targetTrackId && foundBlockIds.length >= 2) {
                const newId = joinBlocks(targetTrackId, foundBlockIds, beatsPerBar);
                if (newId) {
                  useUIStore.getState().selectBlock(newId, targetTrackId);
                }
              }
            }
          }
          break;

        case 'KeyG':
          // Cmd/Ctrl + Shift + G: Group selected tracks
          if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            // Get fresh state to avoid stale closure
            const currentSelectedTrackIds = useUIStore.getState().selectedTrackIds;
            if (currentSelectedTrackIds.size >= 2) {
              const trackIdsToGroup = Array.from(currentSelectedTrackIds);
              const groupId = groupTracks(trackIdsToGroup);
              if (groupId) {
                // Select the new group
                selectTrack(groupId);
              }
            }
          }
          break;
      }
    },
    [
      toggle,
      selectedTrackId,
      selectedTrackIds,
      selectedBlockIds,
      deleteTrack,
      deleteBlock,
      splitBlockAtPosition,
      joinBlocks,
      groupTracks,
      selectTrack,
      clearBlockSelection,
      setPixelsPerBeat,
      pixelsPerBeat,
      project.tracks,
      project.beatsPerBar,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
