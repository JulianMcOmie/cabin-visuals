import dynamic from 'next/dynamic'

const EditorApp = dynamic(() => import('@/editor/App'), { ssr: false })

export default function EditorPage() {
  return <EditorApp />
} 