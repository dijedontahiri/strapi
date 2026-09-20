import { resolveProductionConfig } from './config';
import type { BuildContext } from '../create-build-context';

jest.mock('browserslist-to-esbuild', () => ({
  __esModule: true,
  default: jest.fn(() => ['chrome100']),
}));

describe('Vite PostCSS configuration', () => {
  it('uses inline PostCSS options so parent configs are not discovered (#23045)', async () => {
    const cwd = process.cwd();
    const ctx = {
      cwd,
      target: ['last 3 major versions'],
      basePath: '/admin',
      adminPath: '/admin',
      distDir: 'dist/build',
      appDir: cwd,
      entry: '.strapi/client/app.js',
      distPath: `${cwd}/dist/build`,
      env: {},
      runtimeDir: `${cwd}/.strapi/client`,
      logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
      strapi: { internal_config: {} },
      bundler: 'vite' as const,
      options: {
        minify: true,
        sourcemap: false,
      },
      plugins: [],
      tsconfig: undefined,
      customisations: undefined,
      features: undefined,
    } as unknown as BuildContext;

    const config = await resolveProductionConfig(ctx);

    expect(config.css?.postcss).toEqual({});
  });
});
