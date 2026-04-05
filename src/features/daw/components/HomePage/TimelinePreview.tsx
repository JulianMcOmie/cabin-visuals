'use client';

import { PreviewTrackData } from '@daw/core/types';

interface TimelinePreviewProps {
  tracks: PreviewTrackData[];
  totalBars: number;
  width?: number;
  height?: number;
}

export function TimelinePreview({
  tracks,
  totalBars,
  width = 280,
  height = 80,
}: TimelinePreviewProps) {
  const padding = 4;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const barWidth = innerWidth / totalBars;
  const trackHeight = tracks.length > 0 ? Math.min(12, innerHeight / tracks.length) : 12;
  const trackGap = 2;

  return (
    <svg
      width={width}
      height={height}
      className="bg-background rounded"
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Bar grid lines */}
      {Array.from({ length: totalBars + 1 }, (_, i) => (
        <line
          key={i}
          x1={padding + i * barWidth}
          y1={padding}
          x2={padding + i * barWidth}
          y2={height - padding}
          stroke="currentColor"
          strokeOpacity={i % 4 === 0 ? 0.15 : 0.05}
          strokeWidth={1}
        />
      ))}

      {/* Track blocks */}
      {tracks.map((track, trackIndex) => {
        const y = padding + trackIndex * (trackHeight + trackGap);
        return track.blocks.map((block, blockIndex) => {
          const x = padding + block.startBar * barWidth;
          const blockWidth = (block.endBar - block.startBar) * barWidth;
          // Add slight indent for nested tracks
          const indent = track.level * 2;
          return (
            <rect
              key={`${trackIndex}-${blockIndex}`}
              x={x + indent}
              y={y}
              width={Math.max(0, blockWidth - indent)}
              height={trackHeight}
              fill={track.color}
              opacity={0.8 - track.level * 0.15}
              rx={2}
            />
          );
        });
      })}

      {/* Empty state */}
      {tracks.length === 0 && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-muted-foreground text-xs"
        >
          No tracks
        </text>
      )}
    </svg>
  );
}
