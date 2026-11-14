import { animate, createScope, type Scope } from 'animejs';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createMotionScope(root: HTMLElement | null): Scope | null {
  if (!root || prefersReducedMotion()) return null;
  return createScope({ root });
}

export function revertMotionScope(scope: Scope | null): void {
  scope?.revert();
}

export function enterDrawer(element: HTMLElement | null): void {
  if (!element || prefersReducedMotion()) return;
  animate(element, {
    opacity: [0.85, 1],
    translateX: [-14, 0],
    duration: 220,
    ease: 'out(3)',
  });
}

export function pressFeedback(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  animate(element, {
    scale: [0.98, 1],
    duration: 220,
    ease: 'out(3)',
  });
}
