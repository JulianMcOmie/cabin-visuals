import { getSupabase } from './supabase'
import { signedUrlFor } from './signedUrlCache'
import { mintMediaPath, uploadMediaTo } from './mediaStorage'

const BUCKET = 'project-audio'

export function mintAudioPath(projectId: string): Promise<string> {
  return mintMediaPath(projectId)
}

export function uploadAudioTo(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return uploadMediaTo(BUCKET, path, file, onProgress)
}

export function getAudioUrl(path: string): Promise<string> {
  return signedUrlFor(BUCKET, path)
}

export async function deleteAudio(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from(BUCKET).remove([path])
  if (error) throw error
}
