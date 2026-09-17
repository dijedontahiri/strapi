import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import packageJson from '../../package.json';
import buildConfig from '../../tsconfig.build.json';

describe('published declaration entry', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'strapi-cli-types-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('points to declarations emitted with the package build layout', () => {
    const packageDirectory = path.join(root, 'node_modules/create-strapi-app');
    mkdirSync(path.join(packageDirectory, 'src'), { recursive: true });
    writeFileSync(
      path.join(packageDirectory, 'src/index.ts'),
      'export function run(args: string[]): void {}\n'
    );
    writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify(packageJson));

    const config = ts.parseJsonConfigFileContent(
      {
        compilerOptions: {
          ...buildConfig.compilerOptions,
          declaration: true,
          emitDeclarationOnly: true,
          types: [],
        },
        include: buildConfig.include,
      },
      ts.sys,
      packageDirectory
    );
    expect(config.errors).toEqual([]);

    const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
    expect(ts.getPreEmitDiagnostics(program)).toEqual([]);
    expect(program.emit().emitSkipped).toBe(false);

    const declarationPath = path.resolve(packageDirectory, packageJson.types);
    expect(existsSync(declarationPath)).toBe(true);
    expect(readFileSync(declarationPath, 'utf8')).toContain('export declare function run');

    const resolved = ts.resolveModuleName(
      packageJson.name,
      path.join(root, 'consumer.ts'),
      { moduleResolution: ts.ModuleResolutionKind.Node10 },
      ts.sys
    ).resolvedModule;
    expect(resolved?.resolvedFileName).toBe(declarationPath);
    expect(resolved?.extension).toBe(ts.Extension.Dts);
  });
});
