import { Project, ProjectMetadata, PreviewTrackData, CURRENT_SCHEMA_VERSION } from '@daw/core/types';
import { getInstrument } from '@daw/instruments';

const STORAGE_KEYS = {
  PROJECT_LIST: 'pc_project_list',
  PROJECT_PREFIX: 'pc_project_',
  CURRENT_ID: 'pc_current_id',
  SCHEMA_VERSION: 'pc_schema_version',
} as const;

export function getProjectList(): ProjectMetadata[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.PROJECT_LIST);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveProjectList(list: ProjectMetadata[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PROJECT_LIST, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save project list:', e);
  }
}

export function getProject(id: string): Project | null {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.PROJECT_PREFIX + id);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.PROJECT_PREFIX + project.id,
      JSON.stringify(project)
    );
  } catch (e) {
    console.error('Failed to save project:', e);
  }
}

export function deleteProject(id: string): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.PROJECT_PREFIX + id);
    const list = getProjectList().filter((p) => p.id !== id);
    saveProjectList(list);
  } catch (e) {
    console.error('Failed to delete project:', e);
  }
}

export function getCurrentProjectId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_ID);
  } catch {
    return null;
  }
}

export function setCurrentProjectId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CURRENT_ID, id);
  } catch (e) {
    console.error('Failed to save current project ID:', e);
  }
}

export function generatePreviewTracks(project: Project): PreviewTrackData[] {
  const previewTracks: PreviewTrackData[] = [];

  function processTrack(trackId: string, level: number) {
    const track = project.tracks[trackId];
    if (!track) return;

    // Get color from instrument or use default
    const instrument = track.instrumentId ? getInstrument(track.instrumentId) : undefined;
    const color = instrument?.color || '#6b7280';

    // Extract block ranges
    const blocks = track.blocks.map((block) => ({
      startBar: block.startBar,
      endBar: block.startBar + block.durationBars,
    }));

    if (blocks.length > 0) {
      previewTracks.push({ color, blocks, level });
    }

    // Process children
    for (const childId of track.childIds) {
      processTrack(childId, level + 1);
    }
  }

  // Process root tracks
  for (const rootId of project.rootTracks) {
    processTrack(rootId, 0);
  }

  return previewTracks;
}

export function projectToMetadata(project: Project): ProjectMetadata {
  return {
    id: project.id,
    name: project.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bpm: project.bpm,
    totalBars: project.totalBars,
    trackCount: Object.keys(project.tracks).length,
    previewTracks: generatePreviewTracks(project),
  };
}

export function updateMetadataFromProject(
  metadata: ProjectMetadata,
  project: Project
): ProjectMetadata {
  return {
    ...metadata,
    name: project.name,
    updatedAt: Date.now(),
    bpm: project.bpm,
    totalBars: project.totalBars,
    trackCount: Object.keys(project.tracks).length,
    previewTracks: generatePreviewTracks(project),
  };
}

export function getSchemaVersion(): number {
  try {
    const version = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
    return version ? parseInt(version, 10) : 0;
  } catch {
    return 0;
  }
}

export function setSchemaVersion(version: number): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, version.toString());
  } catch (e) {
    console.error('Failed to save schema version:', e);
  }
}

export function migrateStorageIfNeeded(): void {
  const storedVersion = getSchemaVersion();
  if (storedVersion < CURRENT_SCHEMA_VERSION) {
    // Migrate preview data for existing projects
    const projectList = getProjectList();
    const updatedList = projectList.map((metadata) => {
      if (!metadata.previewTracks) {
        const project = getProject(metadata.id);
        if (project) {
          return {
            ...metadata,
            previewTracks: generatePreviewTracks(project),
          };
        }
      }
      return metadata;
    });
    saveProjectList(updatedList);
    setSchemaVersion(CURRENT_SCHEMA_VERSION);
  }
}
