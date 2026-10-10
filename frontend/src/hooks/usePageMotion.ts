import { useEffect, useRef } from 'react';
import { revealPage } from '@/lib/motion';

export function usePageMotion<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const scope = revealPage(ref.current);
    return () => scope?.revert();
  }, []);

  return ref;
}
