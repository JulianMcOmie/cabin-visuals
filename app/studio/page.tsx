'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { initializePersistence } from '@daw/stores/persistence';

const DAWView = dynamic(
  () => import('@daw/components/PatternComposer').then((mod) => mod.DAWView),
  { ssr: false }
);

export default function StudioPage() {
  useEffect(() => {
    initializePersistence();
  }, []);

  return <DAWView />;
}
