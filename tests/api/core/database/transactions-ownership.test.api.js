'use strict';

const { createStrapiInstance } = require('api-tests/strapi');

const createGate = () => {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};

let strapi;

describe('transaction context ownership', () => {
  let original;
  beforeAll(async () => {
    strapi = await createStrapiInstance();
    original = await strapi.db
      .queryBuilder('strapi::core-store')
      .select(['*'])
      .where({ id: 1 })
      .execute();
  });

  afterAll(async () => {
    await strapi.destroy();
  });

  afterEach(async () => {
    await strapi.db
      .queryBuilder('strapi::core-store')
      .update({
        key: original[0].key,
      })
      .where({ id: 1 })
      .execute();
  });

  describe('transaction callback ownership', () => {
    test('does not emit a failed transaction commit hook when recovery commits', async () => {
      const failedCommit = jest.fn();
      const recoveryCommit = jest.fn();
      const failure = new Error('original transaction failed');
      let recovery;

      await expect(
        strapi.db.transaction(async ({ onCommit, onRollback }) => {
          onCommit(failedCommit);
          onRollback(() => {
            recovery = strapi.db.transaction(async ({ onCommit }) => {
              await strapi.db
                .queryBuilder('strapi::core-store')
                .update({ key: 'recovery key' })
                .where({ id: 1 })
                .execute();
              onCommit(recoveryCommit);
            });
          });
          await strapi.db
            .queryBuilder('strapi::core-store')
            .update({ key: 'rolled back key' })
            .where({ id: 1 })
            .execute();
          throw failure;
        })
      ).rejects.toBe(failure);

      expect(recovery).toBeDefined();
      await recovery;
      expect(failedCommit).not.toHaveBeenCalled();
      expect(recoveryCommit).toHaveBeenCalledTimes(1);
      const rows = await strapi.db
        .queryBuilder('strapi::core-store')
        .select(['key'])
        .where({ id: 1 })
        .execute();
      expect(rows[0].key).toEqual('recovery key');
    });

    test('does not emit a committed transaction rollback hook when a follow-up rolls back', async () => {
      const originalRollback = jest.fn();
      const followUpRollback = jest.fn();
      let followUp;

      await strapi.db.transaction(async ({ onCommit, onRollback }) => {
        onRollback(originalRollback);
        onCommit(() => {
          followUp = strapi.db.transaction(async ({ onRollback, rollback }) => {
            onRollback(followUpRollback);
            await strapi.db
              .queryBuilder('strapi::core-store')
              .update({ key: 'follow-up key' })
              .where({ id: 1 })
              .execute();
            await rollback();
          });
        });
        await strapi.db
          .queryBuilder('strapi::core-store')
          .update({ key: 'committed key' })
          .where({ id: 1 })
          .execute();
      });

      expect(followUp).toBeDefined();
      await followUp;
      expect(originalRollback).not.toHaveBeenCalled();
      expect(followUpRollback).toHaveBeenCalledTimes(1);
      const rows = await strapi.db
        .queryBuilder('strapi::core-store')
        .select(['key'])
        .where({ id: 1 })
        .execute();
      expect(rows[0].key).toEqual('committed key');
    });

    test.each(['commit', 'rollback'])(
      'rejects work after calling the outer %s helper inside a nested callback',
      async (finalization) => {
        await strapi.db.transaction(async (outer) => {
          await strapi.db.transaction(() => outer[finalization]());
          expect(() => strapi.db.inTransaction()).toThrow('Transaction is closed');
          await expect(
            strapi.db.transaction(async () => {
              await strapi.db
                .queryBuilder('strapi::core-store')
                .update({ key: 'unexpected fresh transaction' })
                .where({ id: 1 })
                .execute();
            })
          ).rejects.toThrow('Transaction is closed');
        });

        const rows = await strapi.db
          .queryBuilder('strapi::core-store')
          .select(['key'])
          .where({ id: 1 })
          .execute();
        expect(rows[0].key).toEqual(original[0].key);
      }
    );

    test('rolls back a failed commit and keeps recovery transaction hooks isolated', async () => {
      const failedCommit = jest.fn();
      const failedRollback = jest.fn();
      const recoveryCommit = jest.fn();
      const failure = new Error('commit failed before completion');
      let recovery;

      await expect(
        strapi.db.transaction(async ({ trx, onCommit, onRollback }) => {
          // Fail before Knex sends COMMIT, leaving a real transaction for the catch path to roll back.
          trx.commit = jest.fn().mockRejectedValue(failure);
          onCommit(failedCommit);
          onRollback(() => {
            failedRollback();
            recovery = strapi.db.transaction(async ({ onCommit }) => {
              const rows = await strapi.db
                .queryBuilder('strapi::core-store')
                .select(['key'])
                .where({ id: 1 })
                .execute();
              expect(rows[0].key).toEqual(original[0].key);
              await strapi.db
                .queryBuilder('strapi::core-store')
                .update({ key: 'recovery after failed commit' })
                .where({ id: 1 })
                .execute();
              onCommit(recoveryCommit);
            });
          });
          await strapi.db
            .queryBuilder('strapi::core-store')
            .update({ key: 'uncommitted key' })
            .where({ id: 1 })
            .execute();
        })
      ).rejects.toBe(failure);

      expect(recovery).toBeDefined();
      await recovery;
      expect(failedCommit).not.toHaveBeenCalled();
      expect(failedRollback).toHaveBeenCalledTimes(1);
      expect(recoveryCommit).toHaveBeenCalledTimes(1);
      const rows = await strapi.db
        .queryBuilder('strapi::core-store')
        .select(['key'])
        .where({ id: 1 })
        .execute();
      expect(rows[0].key).toEqual('recovery after failed commit');
    });
  });

  describe('transaction lifecycle boundaries', () => {
    test.each(['commit', 'rollback'])(
      'rejects a detached query after %s instead of autocommitting it',
      async (operation) => {
        const gate = createGate();
        let detached;
        await strapi.db.transaction(async (outer) => {
          await strapi.db.transaction(() => {
            detached = gate.promise.then(() =>
              strapi.db
                .queryBuilder('strapi::core-store')
                .update({ key: 'unexpected detached write' })
                .where({ id: 1 })
                .execute()
            );
          });
          await outer[operation]();
        });

        gate.resolve();
        const error = await detached.then(
          () => undefined,
          (reason) => reason
        );
        const rows = await strapi.db
          .queryBuilder('strapi::core-store')
          .select(['key'])
          .where({ id: 1 })
          .execute();
        expect(rows[0].key).toEqual(original[0].key);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('Transaction is closed');
      }
    );

    test.each(['commit', 'rollback'])(
      'rejects a detached transaction after %s instead of opening a new one',
      async (operation) => {
        const gate = createGate();
        let detached;
        await strapi.db.transaction(async (outer) => {
          await strapi.db.transaction(() => {
            detached = gate.promise.then(() =>
              strapi.db.transaction(async () => {
                await strapi.db
                  .queryBuilder('strapi::core-store')
                  .update({ key: 'unexpected independent write' })
                  .where({ id: 1 })
                  .execute();
              })
            );
          });
          await outer[operation]();
        });

        gate.resolve();
        await expect(detached).rejects.toThrow('Transaction is closed');
        const rows = await strapi.db
          .queryBuilder('strapi::core-store')
          .select(['key'])
          .where({ id: 1 })
          .execute();
        expect(rows[0].key).toEqual(original[0].key);
      }
    );

    test('a nested scope cannot commit independently while the outer commit is in flight', async () => {
      const commitFailure = new Error('commit failed before completion');
      const commitGate = createGate();
      const nestedGate = createGate();
      let nested;
      let nestedError;
      const rollback = jest.fn();
      const openTransaction = jest.spyOn(strapi.db.connection, 'transaction');

      try {
        await expect(
          strapi.db.transaction(async (outer) => {
            outer.onRollback(rollback);
            await strapi.db.transaction(() => {
              nested = nestedGate.promise.then(() =>
                strapi.db.transaction(async () => {
                  await strapi.db
                    .queryBuilder('strapi::core-store')
                    .update({ key: 'nested key' })
                    .where({ id: 1 })
                    .execute();
                })
              );
            });
            // Inject failure before COMMIT reaches Knex; rollback and reads use real SQL.
            outer.trx.commit = async () => {
              await commitGate.promise;
              throw commitFailure;
            };
            const finalizing = outer.commit();
            nestedGate.resolve();
            try {
              nestedError = await nested.then(
                () => undefined,
                (reason) => reason
              );
            } finally {
              commitGate.resolve();
              await finalizing;
            }
          })
        ).rejects.toBe(commitFailure);

        expect(openTransaction).toHaveBeenCalledTimes(1);
        expect(nestedError).toBeInstanceOf(Error);
        expect(nestedError.message).toContain('Transaction is finalizing');
        expect(rollback).toHaveBeenCalledTimes(1);
        const rows = await strapi.db
          .queryBuilder('strapi::core-store')
          .select(['key'])
          .where({ id: 1 })
          .execute();
        expect(rows[0].key).toEqual(original[0].key);
      } finally {
        commitGate.resolve();
        openTransaction.mockRestore();
      }
    });

    test.each(['commit', 'rollback'])(
      'allows delayed %s hook recovery but rejects pre-existing detached queries',
      async (operation) => {
        const gate = createGate();
        const followUpCommit = jest.fn();
        let followUp;
        let detached;
        await strapi.db.transaction(async (outer) => {
          const register = operation === 'commit' ? outer.onCommit : outer.onRollback;
          register(() => {
            expect(strapi.db.inTransaction()).toBe(false);
            followUp = gate.promise.then(() =>
              strapi.db.transaction(async ({ onCommit }) => {
                onCommit(followUpCommit);
                await strapi.db
                  .queryBuilder('strapi::core-store')
                  .update({ key: 'delayed recovery key' })
                  .where({ id: 1 })
                  .execute();
              })
            );
          });
          await strapi.db.transaction(() => {
            detached = gate.promise.then(() =>
              strapi.db
                .queryBuilder('strapi::core-store')
                .update({ key: 'unexpected stale write' })
                .where({ id: 1 })
                .execute()
            );
          });
          await outer[operation]();
        });

        gate.resolve();
        await expect(detached).rejects.toThrow('Transaction is closed');
        await followUp;
        expect(followUpCommit).toHaveBeenCalledTimes(1);
        const rows = await strapi.db
          .queryBuilder('strapi::core-store')
          .select(['key'])
          .where({ id: 1 })
          .execute();
        expect(rows[0].key).toEqual('delayed recovery key');
      }
    );
  });
});
