-- Raise the video bucket's per-file cap to the new Pro-tier clip limit
-- (videoUploads.ts PRO_MAX_MB = 1024 MB, up from 250). Same contract as 0004:
-- the picker rejects oversized files instantly (50 MB free / 1 GB Pro,
-- client-side) and the bucket backstops everyone at the Pro cap - if
-- PRO_MAX_MB changes, change both. Requires the project-wide Storage upload
-- limit (dashboard: Storage -> Settings) to be >= 1 GB, or the global cap
-- silently wins and uploads fail only at the end.
UPDATE storage.buckets SET file_size_limit = 1073741824 WHERE id = 'project-videos';
