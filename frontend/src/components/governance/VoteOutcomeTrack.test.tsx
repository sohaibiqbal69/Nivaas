import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoteOutcomeTrack } from './VoteOutcomeTrack';

describe('VoteOutcomeTrack', () => {
  it('visualizes only the returned vote counts and exposes them accessibly', () => {
    const markup = renderToStaticMarkup(<VoteOutcomeTrack yes={6} no={3} abstain={1} />);
    expect(markup).toContain('Recorded votes: 6 yes, 3 no, 1 abstain');
    expect(markup).toContain('width:60%');
    expect(markup).toContain('width:30%');
    expect(markup).toContain('width:10%');
  });

  it('keeps empty results at zero width without dividing by zero', () => {
    const markup = renderToStaticMarkup(<VoteOutcomeTrack yes={0} no={0} abstain={0} />);
    expect(markup.match(/width:0%/g)).toHaveLength(3);
  });
});
