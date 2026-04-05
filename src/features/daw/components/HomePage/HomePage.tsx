'use client';

import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { ProjectCard } from './ProjectCard';

export function HomePage() {
  const projectList = useProjectStore((state) => state.projectList);
  const { createNewProject, switchProject, deleteProjectById, renameProject } = useProjectStore();
  const setCurrentView = useUIStore((state) => state.setCurrentView);

  const handleNewProject = () => {
    createNewProject();
    setCurrentView('editor');
  };

  const handleOpenProject = (id: string) => {
    switchProject(id);
    setCurrentView('editor');
  };

  // Sort by updatedAt descending (most recent first)
  const sortedProjects = [...projectList].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-8 border-b border-border bg-surface">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-accent-from to-accent-to bg-clip-text text-transparent">
          Pattern Composer
        </h1>
        <button
          onClick={handleNewProject}
          className="px-4 py-2 bg-gradient-to-r from-accent-from to-accent-to text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </button>
      </header>

      {/* Content */}
      <main className="p-8">
        {sortedProjects.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-24 h-24 mb-6 rounded-full bg-gradient-to-r from-accent-from/20 to-accent-to/20 flex items-center justify-center">
              <svg className="w-12 h-12 text-accent-from" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              Create your first project to start composing patterns with layered tracks and instruments.
            </p>
            <button
              onClick={handleNewProject}
              className="px-6 py-3 bg-gradient-to-r from-accent-from to-accent-to text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Project
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-medium text-foreground">Your Projects</h2>
              <p className="text-sm text-muted-foreground">
                {sortedProjects.length} project{sortedProjects.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Project Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {sortedProjects.map((metadata) => (
                <ProjectCard
                  key={metadata.id}
                  metadata={metadata}
                  onOpen={() => handleOpenProject(metadata.id)}
                  onRename={(name) => renameProject(metadata.id, name)}
                  onDelete={() => deleteProjectById(metadata.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
