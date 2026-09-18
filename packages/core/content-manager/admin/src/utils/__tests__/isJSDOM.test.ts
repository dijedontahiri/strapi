import { isJSDOM } from '../isJSDOM';

describe('isJSDOM', () => {
  it('detects the JSDOM user agent used by browser tests', () => {
    expect(
      isJSDOM(
        'Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0'
      )
    ).toBe(true);
  });

  it('keeps real browser runtimes responsive even when NODE_ENV is test', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    try {
      expect(
        isJSDOM(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
        )
      ).toBe(false);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('does not identify a non-browser runtime as JSDOM', () => {
    expect(isJSDOM('')).toBe(false);
  });
});
