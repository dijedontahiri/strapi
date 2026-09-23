import { errors } from '@strapi/utils';

import createAuthentication from '..';

class ForeignAuthError extends Error {
  details: Record<string, unknown>;

  constructor(name: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = name;
    this.details = details;
  }
}

const createAuthInfo = (error: Error) => {
  const strategy = {
    name: 'foreign-auth-strategy',
    authenticate: jest.fn(async () => ({ authenticated: false })),
    verify: jest.fn(async () => {
      throw error;
    }),
  };

  return {
    service: createAuthentication(),
    auth: {
      strategy,
      credentials: null,
      ability: null,
    },
  };
};

describe('authentication service error normalization', () => {
  it.each([
    ['UnauthorizedError', errors.UnauthorizedError],
    ['ForbiddenError', errors.ForbiddenError],
    ['PolicyError', errors.PolicyError],
  ])('normalizes a foreign %s into the local error class', async (name, ExpectedError) => {
    const foreignError = new ForeignAuthError(name, 'auth failed', { source: 'nested-utils' });
    const { service, auth } = createAuthInfo(foreignError);

    let received: unknown;

    try {
      await service.verify(auth);
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(ExpectedError);
    expect(received).not.toBe(foreignError);
    expect(received).toMatchObject({
      name,
      message: 'auth failed',
      details: { source: 'nested-utils' },
    });
  });

  it('preserves local Strapi auth errors', async () => {
    const localError = new errors.ForbiddenError('local failure', { source: 'core' });
    const { service, auth } = createAuthInfo(localError);

    await expect(service.verify(auth)).rejects.toBe(localError);
  });

  it('preserves unrelated strategy errors', async () => {
    const originalError = new Error('strategy crashed');
    originalError.name = 'UnexpectedStrategyError';
    const { service, auth } = createAuthInfo(originalError);

    await expect(service.verify(auth)).rejects.toBe(originalError);
  });
});
