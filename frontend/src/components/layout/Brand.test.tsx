import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Brand } from './Brand';

describe('Brand lockup', () => {
  it('pairs the supplied architectural mark with the full Nivaas wordmark', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Brand /></MemoryRouter>);

    expect(html).toContain('/assets/nivaas-mark-small.png');
    expect(html).toContain('/assets/nivaas-wordmark.png');
    expect(html).toContain('aria-label="Nivaas dashboard"');
  });
});
