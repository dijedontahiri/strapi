const isJSDOM = (
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
): boolean => userAgent.toLowerCase().includes('jsdom');

export { isJSDOM };
