'use client';

import { useEffect } from 'react';
import { Panel, Group, Separator, usePanelRef } from 'react-resizable-panels';
import { Header } from './Header';
import { Library } from './Library/Library';
import { ArrangementView } from './ArrangementView';
import { Inspector } from './Inspector/Inspector';
import { BlockEditor } from './BlockEditor';
import { VisualFullscreen } from './VisualView';
import { useUIStore } from '@daw/stores/uiStore';
import { useKeyboard } from '@daw/hooks/useKeyboard';

export function DAWView() {
  const showLibrary = useUIStore((s) => s.showLibrary);
  const showInspector = useUIStore((s) => s.showInspector);
  const visualFullscreen = useUIStore((s) => s.visualFullscreen);

  // Panel refs for imperative collapse/expand control
  const libraryPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();

  // Setup keyboard shortcuts
  useKeyboard();

  // Sync library toggle with panel collapse/expand
  useEffect(() => {
    if (showLibrary) {
      libraryPanelRef.current?.expand();
    } else {
      libraryPanelRef.current?.collapse();
    }
  }, [showLibrary]);

  // Sync inspector toggle with panel collapse/expand
  useEffect(() => {
    if (showInspector) {
      inspectorPanelRef.current?.expand();
    } else {
      inspectorPanelRef.current?.collapse();
    }
  }, [showInspector]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <Header />

      <Group orientation="horizontal" className="flex-1">
        {/* Library - Left Sidebar */}
        <Panel
          panelRef={libraryPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize="224px"
          minSize="50px"
          maxSize="400px"
          id="library-panel"
        >
          <aside className="h-full border-r border-border bg-surface overflow-y-auto">
            <Library />
          </aside>
        </Panel>

        <Separator className="w-1.5 bg-white/[0.06] hover:bg-accent-from/50 transition-colors cursor-col-resize flex flex-col items-center justify-center group">
          <div className="h-12 w-0.5 rounded-full bg-white/10 group-hover:bg-accent-from/70 transition-colors" />
        </Separator>

        {/* Main Content Area */}
        <Panel minSize="400px" id="main-content-panel">
          <main className="h-full flex flex-col overflow-hidden">
            <Group orientation="vertical" id="editor-layout-v2">
              {/* ArrangementView - Unified scrolling for tracks and timeline */}
              <Panel defaultSize={60} minSize={10} id="main-panel-v2">
                <ArrangementView />
              </Panel>

              {/* Bottom Panel - Block Editor / Visual View */}
              <Separator className="h-1.5 bg-white/[0.06] hover:bg-accent-from/50 transition-colors cursor-row-resize flex items-center justify-center group">
                <div className="w-12 h-0.5 rounded-full bg-white/10 group-hover:bg-accent-from/70 transition-colors" />
              </Separator>
              <Panel defaultSize={40} minSize={15} collapsible collapsedSize={0} id="editor-panel-v2">
                <BlockEditor />
              </Panel>
            </Group>
          </main>
        </Panel>

        <Separator className="w-1.5 bg-white/[0.06] hover:bg-accent-from/50 transition-colors cursor-col-resize flex flex-col items-center justify-center group">
          <div className="h-12 w-0.5 rounded-full bg-white/10 group-hover:bg-accent-from/70 transition-colors" />
        </Separator>

        {/* Inspector - Right Sidebar */}
        <Panel
          panelRef={inspectorPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize="288px"
          minSize="50px"
          maxSize="500px"
          id="inspector-panel"
        >
          <aside className="h-full border-l border-border bg-surface overflow-y-auto">
            <Inspector />
          </aside>
        </Panel>
      </Group>

      {visualFullscreen && <VisualFullscreen />}
    </div>
  );
}
