import { shouldUseResponsiveGridStyles } from '../FormLayout';

describe('shouldUseResponsiveGridStyles', () => {
  it('keeps responsive styles for a real browser even when tests run with NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(
      shouldUseResponsiveGridStyles(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'
      )
    ).toBe(true);
  });

  it('disables responsive styles only for JSDOM', () => {
    expect(shouldUseResponsiveGridStyles('Mozilla/5.0 jsdom/26.1.0')).toBe(false);
  });

  it('keeps responsive styles when navigator is unavailable during a build', () => {
    expect(shouldUseResponsiveGridStyles()).toBe(true);
  });
});
