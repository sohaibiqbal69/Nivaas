import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressTrack } from './ProgressTrack';

describe('ProgressTrack', () => {
  it('exposes a clamped, accessible percentage while retaining source amounts', () => {
    const html = renderToStaticMarkup(
      <ProgressTrack value={125} max={100} label="Budget use" valueText="₹125 spent of ₹100 allocated" />,
    );

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Budget use"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuetext="₹125 spent of ₹100 allocated"');
  });

  it('does not render a misleading track when its maximum is not a valid positive number', () => {
    const html = renderToStaticMarkup(<ProgressTrack value={0} max={0} label="Budget use" />);
    expect(html).toBe('');
  });
});
