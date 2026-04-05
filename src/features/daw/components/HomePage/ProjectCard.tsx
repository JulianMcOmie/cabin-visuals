'use client';

import { useState } from 'react';
import { ProjectMetadata } from '@daw/core/types';
import { TimelinePreview } from './TimelinePreview';

interface ProjectCardProps {
  metadata: ProjectMetadata;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
}

export function ProjectCard({ metadata, onOpen, onRename, onDelete }: ProjectCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(metadata.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSaveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== metadata.name) {
      onRename(trimmed);
    } else {
      setEditName(metadata.name);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      setEditName(metadata.name);
      setIsEditing(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      onDelete();
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
    }
  };

  return (
    <div
      className="group relative bg-surface border border-border rounded-xl overflow-hidden transition-all hover:border-accent-from/50 hover:shadow-lg cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowDeleteConfirm(false);
      }}
      onClick={() => !isEditing && onOpen()}
    >
      {/* Timeline Preview */}
      <div className="p-3">
        <TimelinePreview
          tracks={metadata.previewTracks || []}
          totalBars={metadata.totalBars}
        />
      </div>

      {/* Project Info */}
      <div className="px-4 pb-4">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            className="w-full px-2 py-1 bg-background border border-border rounded text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-accent-from"
          />
        ) : (
          <h3 className="font-semibold text-foreground truncate">{metadata.name}</h3>
        )}

        <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
          <span>{metadata.bpm} BPM</span>
          <span className="text-muted-foreground/50">·</span>
          <span>{metadata.totalBars} bars</span>
          <span className="text-muted-foreground/50">·</span>
          <span>{metadata.trackCount} tracks</span>
        </div>

        <div className="mt-1 text-xs text-muted-foreground">
          {formatDate(metadata.updatedAt)}
        </div>
      </div>

      {/* Hover Actions */}
      {isHovered && !isEditing && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className="p-1.5 bg-surface/90 backdrop-blur border border-border rounded-lg hover:bg-muted transition-colors"
            title="Rename"
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className={`p-1.5 backdrop-blur border rounded-lg transition-colors ${
              showDeleteConfirm
                ? 'bg-red-500 border-red-500 text-white'
                : 'bg-surface/90 border-border hover:bg-muted'
            }`}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete'}
          >
            <svg className={`w-4 h-4 ${showDeleteConfirm ? 'text-white' : 'text-muted-foreground hover:text-red-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
