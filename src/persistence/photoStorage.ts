import { getSupabase } from './supabase'
import { signedUrlFor } from './signedUrlCache'
import { mintMediaPath, uploadMediaTo } from './mediaStorage'

const BUCKET = 'project-photos'

export function mintPhotoPath(projectId: string): Promise<string> {
  return mintMediaPath(projectId)
}

export function uploadPhotoTo(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return uploadMediaTo(BUCKET, path, file, onProgress)
}

export function getPhotoUrl(path: string): Promise<string> {
  return signedUrlFor(BUCKET, path)
}

export async function deletePhoto(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from(BUCKET).remove([path])
  if (error) throw error
}
