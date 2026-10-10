import { animate, createScope, type Scope, utils } from 'animejs';

export type MotionRoot = HTMLElement | null;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createMotionScope(root: MotionRoot): Scope | null {
  if (!root || prefersReducedMotion()) return null;
  return createScope({ root });
}

export function revealPage(root: MotionRoot): Scope | null {
  const scope = createMotionScope(root);
  if (!scope) return null;

  scope.add(() => {
    animate('.motion-item', {
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 500,
      delay: utils.stagger(55),
      ease: 'out(3)',
    });
  });
  return scope;
}

export function pressFeedback(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  animate(element, {
    scale: [0.98, 1],
    duration: 220,
    ease: 'out(3)',
  });
}
