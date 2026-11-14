import { useRef } from 'react';

export function usePageMotion<T extends HTMLElement>() {
  return useRef<T>(null);
}
