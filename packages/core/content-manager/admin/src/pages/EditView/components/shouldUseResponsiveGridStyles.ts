export const shouldUseResponsiveGridStyles = (userAgent?: string) =>
  !userAgent?.toLowerCase().includes('jsdom');
