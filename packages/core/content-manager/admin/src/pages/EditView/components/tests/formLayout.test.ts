import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shouldUseResponsiveGridStyles } from '../shouldUseResponsiveGridStyles';

describe('responsive edit grid styles', () => {
  it('keeps responsive styles for a real browser even when Jest runs with NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(
      shouldUseResponsiveGridStyles(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'
      )
    ).toBe(true);
  });

  it('disables responsive styles for JSDOM only', () => {
    expect(shouldUseResponsiveGridStyles('Mozilla/5.0 jsdom/26.1.0')).toBe(false);
    expect(shouldUseResponsiveGridStyles()).toBe(true);
  });

  it('uses the JSDOM-specific guard instead of NODE_ENV in FormLayout', () => {
    const source = readFileSync(join(__dirname, '..', 'FormLayout.tsx'), 'utf8');

    expect(source).toContain('shouldUseResponsiveGridStyles(userAgent)');
    expect(source).not.toContain("process.env.NODE_ENV !== 'test'");
  });
});
