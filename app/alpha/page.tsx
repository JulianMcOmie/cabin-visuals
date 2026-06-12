'use client';

import React, { useEffect, useState, Suspense } from 'react';
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  usePanelRef,
} from 'react-resizable-panels';
import TimelineView from '../../src/components/TimelineView/TimelineView';
import VisualizerView from '../../src/components/VisualizerView';
import PlaybarView from '../../src/components/PlaybarView/PlaybarView';
import DetailView from '../../src/components/DetailView/DetailView';
import AudioLoader from '../../src/components/AudioLoader/AudioLoader';
import InstrumentSidebar from '../../src/components/InstrumentSidebar/InstrumentSidebar';
import useStore from '../../src/store/store';
import { loadAudioFile } from '../../src/lib/idbHelper';
import { initializeStore } from '../../src/store/store';
import styles from '../editor/editor.module.css';

function AlphaPageContent() {
  const [isLoading, setIsLoading] = useState(true);
  const sidebarPanelRef = usePanelRef();
  const isInstrumentSidebarVisible = useStore((state) => state.isInstrumentSidebarVisible);
  const loadAudioAction = useStore((state) => state.loadAudio);
  const isPlaying = useStore((state) => state.isPlaying);
  const play = useStore((state) => state.play);
  const pause = useStore((state) => state.pause);

  useEffect(() => {
    if (sidebarPanelRef.current) {
      if (isInstrumentSidebarVisible) sidebarPanelRef.current.expand();
      else sidebarPanelRef.current.collapse();
    }
  }, [isInstrumentSidebarVisible]);

  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      try {
        await initializeStore();
        const persistedFile = await loadAudioFile();
        if (persistedFile) {
          const arrayBuffer = await persistedFile.arrayBuffer();
          const fileName = persistedFile instanceof File ? persistedFile.name : 'persisted-audio';
          await loadAudioAction(arrayBuffer, fileName);
        }
      } catch (error) {
        console.error('Alpha page initialization failed:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadInitialData();
  }, [loadAudioAction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        const target = e.target as HTMLElement;
        const isTyping =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable;
        if (!isTyping) {
          e.preventDefault();
          if (isPlaying) pause();
          else play();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, play, pause]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black gap-4">
        <div className="w-8 h-8 border-2 border-slate-700 border-t-[#00a8ff] rounded-full animate-spin"></div>
        <p className="text-slate-500 text-sm font-light">loading...</p>
      </div>
    );
  }

  return (
    <div className={`${styles.editorPageWrapper} flex flex-col h-screen bg-black text-white`}>
      <main className={`${styles.mainContainer} flex-grow flex flex-col`}>
        <div className={styles.playbarContainer}>
          <PlaybarView user={null} />
        </div>

        <PanelGroup orientation="horizontal" className={`${styles.contentPanelGroup} flex-grow`}>
          <Panel
            panelRef={sidebarPanelRef}
            defaultSize="20%" minSize="15%" maxSize="35%"
            collapsible={true} collapsedSize="0%"
            id="sidebar-panel"
            className={styles.panelStyles}
          >
            <div className={styles.sidebarArea}>
              <InstrumentSidebar />
            </div>
          </Panel>
          <PanelResizeHandle className={`${styles.resizeHandle} ${styles.horizontalHandle}`} />
          <Panel id="main-content-panel" className={styles.panelStyles}>
            <PanelGroup orientation="vertical" className={styles.mainContentPanelGroup}>
              <Panel defaultSize="60%" minSize="20%" id="top-panel" className={styles.panelStyles}>
                <PanelGroup orientation="horizontal" className={styles.topPanelGroup}>
                  <Panel defaultSize="50%" minSize="20%" id="detail-panel" className={styles.panelStyles}>
                    <div className={styles.detailContainer}>
                      <DetailView />
                    </div>
                  </Panel>
                  <PanelResizeHandle className={`${styles.resizeHandle} ${styles.horizontalHandle}`} />
                  <Panel minSize="20%" id="visualizer-panel" className={styles.panelStyles}>
                    <div className={styles.visualizerContainer}>
                      <VisualizerView />
                    </div>
                  </Panel>
                </PanelGroup>
              </Panel>
              <PanelResizeHandle className={`${styles.resizeHandle} ${styles.verticalHandle}`} />
              <Panel defaultSize="40%" minSize="20%" id="timeline-panel" className={styles.panelStyles}>
                <div className={styles.bottomSection}>
                  <div className={styles.timelineViewWrapper}>
                    <TimelineView />
                  </div>
                  <div className={styles.audioLoaderWrapper}>
                    <AudioLoader />
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </main>
    </div>
  );
}

export default function AlphaPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AlphaPageContent />
    </Suspense>
  );
}
