import { NextResponse } from 'next/server'
import { DEV_FILES_ENABLED, listProjects } from '@/devtools/projectFiles'

// Dev-only: the on-disk projects (projects/<name>/project.json). See
// src/devtools/projectFiles.ts and tools/cabin.

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!DEV_FILES_ENABLED) return new NextResponse(null, { status: 404 })
  return NextResponse.json({ projects: await listProjects() })
}
