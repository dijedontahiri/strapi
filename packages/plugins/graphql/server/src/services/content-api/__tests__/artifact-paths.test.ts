import path from 'node:path';

import { makeSchema } from 'nexus';
import type { Core } from '@strapi/types';

import createContentApi from '..';

jest.mock('nexus', () => ({
  makeSchema: jest.fn(() => ({
    getQueryType: () => ({ getFields: () => ({}) }),
  })),
}));

jest.mock('@graphql-tools/utils', () => ({
  pruneSchema: jest.fn((schema) => schema),
}));

jest.mock('@graphql-tools/schema', () => ({
  mergeSchemas: jest.fn(() => ({})),
  addResolversToSchema: jest.fn(({ schema }) => schema),
}));

jest.mock('../wrap-resolvers', () => ({
  wrapResolvers: jest.fn(({ schema }) => schema),
}));

jest.mock('../register-functions', () => ({
  registerSingleType: jest.fn(),
  registerCollectionType: jest.fn(),
  registerComponent: jest.fn(),
  registerScalars: jest.fn(),
  registerInternals: jest.fn(),
  registerPolymorphicContentType: jest.fn(),
  registerEnumsDefinition: jest.fn(),
  registerInputsDefinition: jest.fn(),
  registerFiltersDefinition: jest.fn(),
  registerDynamicZonesDefinition: jest.fn(),
}));

const mockMakeSchema = jest.mocked(makeSchema);

const createStrapi = (artifactConfig: { schema: string | boolean; typegen: string | boolean }) => {
  const registry = { definitions: [], register: jest.fn() };
  const extensionService = {
    generate: jest.fn(() => ({ types: [], typeDefs: [], resolvers: {}, plugins: [] })),
    shadowCRUD: jest.fn(),
  };
  const services = {
    constants: { KINDS: {}, GENERIC_MORPH_TYPENAME: 'GenericMorph' },
    extension: extensionService,
    'type-registry': { new: jest.fn(() => registry) },
    builders: { new: jest.fn(() => ({})) },
  };
  const configValues: Record<string, unknown> = {
    shadowCRUD: false,
    generateArtifacts: true,
    'artifacts.schema': artifactConfig.schema,
    'artifacts.typegen': artifactConfig.typegen,
  };
  const plugin = {
    config: jest.fn((key: string, fallback?: unknown) => configValues[key] ?? fallback),
    service: jest.fn((name: keyof typeof services) => services[name]),
  };

  return {
    plugin: jest.fn(() => plugin),
    config: { get: jest.fn(() => 'development') },
    components: {},
    contentTypes: {},
    dirs: { app: { root: '/workspace/strapi-app' } },
  } as unknown as Core.Strapi;
};

const getFinalMakeSchemaOptions = () => {
  const calls = mockMakeSchema.mock.calls;
  return calls[calls.length - 1][0];
};

describe('GraphQL artifact paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves relative schema and typegen paths from the Strapi application root', () => {
    const strapi = createStrapi({
      schema: './public/generated/schema.graphql',
      typegen: 'src/generated/graphql-types.ts',
    });

    createContentApi({ strapi }).buildSchema();

    expect(getFinalMakeSchemaOptions().outputs).toEqual({
      schema: path.resolve('/workspace/strapi-app', './public/generated/schema.graphql'),
      typegen: path.resolve('/workspace/strapi-app', 'src/generated/graphql-types.ts'),
    });
  });

  it('preserves absolute paths and disabled artifact outputs', () => {
    const schema = path.resolve('/tmp/generated/schema.graphql');
    const strapi = createStrapi({ schema, typegen: false });

    createContentApi({ strapi }).buildSchema();

    expect(getFinalMakeSchemaOptions().outputs).toEqual({
      schema,
      typegen: false,
    });
  });
});
