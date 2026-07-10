-- Pin the video bucket's per-file cap to the Pro-tier clip limit
-- (VideoClipBank PRO_MAX_MB = 250 MB). Requires the project-wide Storage
-- upload limit (dashboard: Storage -> Settings) to be >= 250 MB - the global
-- default (50 MB) previously applied invisibly while the client checked
-- against 100 MB, so a 50-100 MB file passed the picker, uploaded fully, and
-- was rejected only at the end (Tyler's 14-minute video). The picker now
-- rejects oversized files instantly (50 MB free / 250 MB Pro, client-side);
-- the bucket backstops everyone at the Pro cap. If PRO_MAX_MB changes,
-- change both.
UPDATE storage.buckets SET file_size_limit = 262144000 WHERE id = 'project-videos';
