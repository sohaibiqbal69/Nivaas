import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProofVerificationRail } from './ProofVerificationRail';

describe('ProofVerificationRail', () => {
  it('shows the returned record, registry and receipt states', () => {
    const markup = renderToStaticMarkup(<ProofVerificationRail recordIntegrity status="CONFIRMED" verified receiptStatus={1} />);
    expect(markup).toContain('Hash matches');
    expect(markup).toContain('Verified');
    expect(markup).toContain('Receipt status 1');
  });

  it('does not infer an integrity match or transaction receipt when they were not returned', () => {
    const markup = renderToStaticMarkup(<ProofVerificationRail status="UNVERIFIABLE" verified={false} />);
    expect(markup).toContain('Not returned');
    expect(markup).toContain('UNVERIFIABLE');
    expect(markup).not.toContain('Verified</span>');
  });
});
