import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionScope, prefersReducedMotion } from './motion';

describe('motion architecture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not create an animation scope when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
    expect(createMotionScope(document.body)).toBeNull();
  });

  it('creates a scoped animation owner for normal motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const scope = createMotionScope(document.body);
    expect(scope).not.toBeNull();
    scope?.revert();
  });
});
