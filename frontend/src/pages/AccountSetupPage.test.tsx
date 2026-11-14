import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AccountSetupPage } from './AccountSetupPage';

describe('AccountSetupPage brand and credential fields', () => {
  it('uses the shared Nivaas authentication composition and preserves setup controls', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AccountSetupPage /></MemoryRouter>);

    expect(html).toContain('/assets/nivaas-wordmark.png');
    expect(html).toContain('Governance begins at home.');
    expect(html).toContain('id="credential"');
    expect(html).toContain('id="new-password"');
    expect(html).toContain('id="confirm-password"');
    expect(html).toContain('Complete setup');
    expect(html).toContain('Back to sign in');
  });
});
