import { useProjectStore } from './projectStore';
import { useUIStore } from './uiStore';
import { useHistoryStore } from './history';
import * as storage from '@daw/services/storage';
import { debounce } from '@daw/utils/debounce';

let initialized = false;
let unsubscribe: (() => void) | null = null;

const saveCurrentProject = debounce(() => {
  const { project, projectList } = useProjectStore.getState();

  // Save the full project
  storage.saveProject(project);

  // Update metadata in the list
  const existingIndex = projectList.findIndex((p) => p.id === project.id);
  if (existingIndex >= 0) {
    const updatedList = [...projectList];
    updatedList[existingIndex] = storage.updateMetadataFromProject(
      updatedList[existingIndex],
      project
    );
    storage.saveProjectList(updatedList);
    useProjectStore.setState({ projectList: updatedList });
  }
}, 1000);

export function initializePersistence(): void {
  if (initialized) return;
  initialized = true;

  // Migrate storage if needed
  storage.migrateStorageIfNeeded();

  // Load project list
  const projectList = storage.getProjectList();
  useProjectStore.setState({ projectList });

  // Try to load the last opened project
  const currentId = storage.getCurrentProjectId();
  let loaded = false;

  if (currentId) {
    const project = storage.getProject(currentId);
    if (project) {
      // Disable history during initial load
      useHistoryStore.getState().setEnabled(false);
      useProjectStore.getState().loadProject(project);
      useHistoryStore.getState().setEnabled(true);
      useHistoryStore.getState().clearHistory();

      useUIStore.getState().setCurrentView('editor');
      loaded = true;
    }
  }

  // If no project loaded, stay on homepage (or create default project for first visit)
  if (!loaded) {
    if (projectList.length > 0) {
      // Projects exist but none currently open - stay on homepage
      useUIStore.getState().setCurrentView('home');
    } else {
      // First visit - stay on homepage, no need to create a project
      useUIStore.getState().setCurrentView('home');
    }
  }

  // Subscribe to store changes for auto-save
  unsubscribe = useProjectStore.subscribe((state, prevState) => {
    // Only save if project actually changed (not just projectList)
    if (state.project !== prevState.project) {
      saveCurrentProject();
    }
  });
}

export function cleanupPersistence(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  initialized = false;
}
