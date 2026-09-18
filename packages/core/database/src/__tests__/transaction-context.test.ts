import assert from 'node:assert/strict';
import type { Knex } from 'knex';

import { Database } from '../index';
import { transactionCtx } from '../transaction-context';

const createTransaction = () => {
  let completed = false;
  const transaction = {
    commit() {
      assert.equal(completed, false, 'a transaction must not commit twice');
      completed = true;
      return Promise.resolve();
    },
    rollback() {
      assert.equal(completed, false, 'a transaction must not roll back twice');
      completed = true;
      return Promise.resolve();
    },
    isCompleted: () => completed,
  };

  return transaction as unknown as Knex.Transaction;
};

// Exercise the real transaction orchestration without a SQL connection or constructor side effects.
const createDatabase = () => {
  const transactions: Knex.Transaction[] = [];
  const database = Object.create(Database.prototype) as Database;
  database.connection = {
    transaction() {
      const trx = createTransaction();
      transactions.push(trx);
      return Promise.resolve(trx);
    },
  } as unknown as Knex;

  return { database, transactions };
};

const createGate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};

// These tests use Node assertions so the same cases can also run in an isolated source harness.
describe('transaction context ownership', () => {
  it('shares commit hooks through nested scopes of the same transaction', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];

    await database.transaction(async ({ onCommit, trx }) => {
      onCommit(() => calls.push('outer'));
      await database.transaction(async ({ onCommit, trx: nestedTrx }) => {
        assert.equal(nestedTrx, trx);
        onCommit(() => calls.push('nested'));
        await database.transaction(({ onCommit }) => {
          onCommit(() => calls.push('deepest'));
        });
        assert.deepEqual(calls, []);
      });
      assert.deepEqual(calls, []);
    });

    assert.equal(transactions.length, 1);
    assert.deepEqual(calls, ['outer', 'nested', 'deepest']);
    assert.equal(transactionCtx.get(), undefined);
  });

  it('shares rollback hooks through nested scopes of the same transaction', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    const failure = new Error('roll back the shared transaction');

    await assert.rejects(
      database.transaction(async ({ onCommit, onRollback }) => {
        onCommit(() => calls.push('unexpected commit'));
        onRollback(() => calls.push('outer'));
        await database.transaction(({ onRollback }) => {
          onRollback(() => calls.push('nested'));
          throw failure;
        });
      }),
      (error) => error === failure
    );

    assert.equal(transactions.length, 1);
    assert.deepEqual(calls, ['outer', 'nested']);
    assert.equal(transactionCtx.get(), undefined);
  });

  it("does not run a rolled-back transaction's commit hooks in a recovery transaction", async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    const failure = new Error('original transaction failed');
    let recovery: Promise<unknown> | undefined;

    await assert.rejects(
      database.transaction(({ onCommit, onRollback }) => {
        onCommit(() => calls.push('unexpected original commit'));
        onRollback(() => {
          calls.push('original rollback');
          recovery = database.transaction(({ onCommit }) => {
            onCommit(() => calls.push('recovery commit'));
          });
        });
        throw failure;
      }),
      (error) => error === failure
    );
    assert.ok(recovery);
    await recovery;

    assert.equal(transactions.length, 2);
    assert.deepEqual(calls, ['original rollback', 'recovery commit']);
  });

  it("does not run a committed transaction's rollback hooks when a follow-up rolls back", async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    let followUp: Promise<unknown> | undefined;

    await database.transaction(({ onCommit, onRollback }) => {
      onRollback(() => calls.push('unexpected original rollback'));
      onCommit(() => {
        calls.push('original commit');
        followUp = database.transaction(async ({ onRollback, rollback }) => {
          onRollback(() => calls.push('follow-up rollback'));
          await rollback();
        });
      });
    });
    assert.ok(followUp);
    await followUp;

    assert.equal(transactions.length, 2);
    assert.deepEqual(calls, ['original commit', 'follow-up rollback']);
  });

  it('runs independent commit hooks once when started by an onCommit hook', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    let followUp: Promise<unknown> | undefined;

    await database.transaction(({ onCommit }) => {
      onCommit(() => {
        calls.push('original');
        followUp = database.transaction(({ onCommit }) => {
          onCommit(() => calls.push('follow-up'));
        });
      });
    });
    assert.ok(followUp);
    await followUp;

    assert.equal(transactions.length, 2);
    assert.deepEqual(calls, ['original', 'follow-up']);
  });

  it('runs independent rollback hooks once when started by an onRollback hook', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    let followUp: Promise<unknown> | undefined;

    await database.transaction(async ({ onRollback, rollback }) => {
      onRollback(() => {
        calls.push('original');
        followUp = database.transaction(async ({ onRollback, rollback }) => {
          onRollback(() => calls.push('follow-up'));
          await rollback();
        });
      });
      await rollback();
    });
    assert.ok(followUp);
    await followUp;

    assert.equal(transactions.length, 2);
    assert.deepEqual(calls, ['original', 'follow-up']);
  });

  (['commit', 'rollback'] as const).forEach((finalization) => {
    it(`rejects work in all shared scopes after a nested scope calls the outer ${finalization}`, async () => {
      const { database, transactions } = createDatabase();

      await database.transaction(async (outer) => {
        await database.transaction(async () => {
          await outer[finalization]();
          assert.throws(() => database.inTransaction(), /Transaction is closed/);
        });
        assert.throws(() => transactionCtx.get(), /Transaction is closed/);
        await assert.rejects(database.transaction(() => {}), /Transaction is closed/);
        await assert.rejects(database.transaction(), /Transaction is closed/);
      });

      assert.equal(transactions.length, 1);
      // Work started outside the completed scope is still independent.
      await database.transaction(() => {});
      assert.equal(transactions.length, 2);
    });

    it(`does not detach an unrelated active transaction when an independent handle uses ${finalization}`, async () => {
      const { database, transactions } = createDatabase();
      const handle = await database.transaction();
      const calls: string[] = [];

      await database.transaction(async ({ trx, onCommit, onRollback }) => {
        onCommit(() => calls.push('active commit'));
        onRollback(() => calls.push('unexpected active rollback'));
        assert.notEqual(trx, handle.get());
        await handle[finalization]();
        assert.equal(transactionCtx.get(), trx);
        assert.deepEqual(calls, []);
      });

      assert.equal(transactions.length, 2);
      assert.deepEqual(calls, ['active commit']);
    });

    it(`does not detach an active transaction when an already-finalized handle repeats ${finalization}`, async () => {
      const { database, transactions } = createDatabase();
      const handle = await database.transaction();
      const calls: string[] = [];
      await handle[finalization]();

      await database.transaction(async ({ trx, onCommit, onRollback }) => {
        onCommit(() => calls.push('active commit'));
        onRollback(() => calls.push('unexpected active rollback'));
        await handle[finalization]();
        assert.equal(transactionCtx.get(), trx);
      });

      assert.equal(transactions.length, 2);
      assert.deepEqual(calls, ['active commit']);
    });
  });

  it('restores the active parent context after a nested callback throws and is caught', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    const failure = new Error('handled nested failure');

    await database.transaction(async ({ trx, onCommit }) => {
      await assert.rejects(
        database.transaction(() => {
          throw failure;
        }),
        (error) => error === failure
      );
      assert.equal(transactionCtx.get(), trx);
      onCommit(() => calls.push('outer'));
    });

    assert.equal(transactions.length, 1);
    assert.deepEqual(calls, ['outer']);
  });

  it('does not share hooks with a different transactor inside an active scope', async () => {
    const outer = createTransaction();
    const separate = createTransaction();
    const calls: string[] = [];

    await transactionCtx.run(outer, async () => {
      transactionCtx.onCommit(() => calls.push('outer'));
      await transactionCtx.run(separate, async () => {
        transactionCtx.onCommit(() => calls.push('separate'));
        await transactionCtx.commit(separate);
      });
      assert.equal(transactionCtx.get(), outer);
      assert.deepEqual(calls, ['separate']);
      await transactionCtx.commit(outer);
    });

    assert.deepEqual(calls, ['separate', 'outer']);
  });

  it('isolates callbacks when a new context is entered synchronously from a commit hook', async () => {
    const outer = createTransaction();
    const calls: string[] = [];
    let followUp: Promise<unknown> | undefined;

    await transactionCtx.run(outer, async () => {
      transactionCtx.onCommit(() => {
        calls.push('outer');
        // Bound the regression on the unfixed implementation instead of allowing recursive replay.
        if (calls.length !== 1) return;
        const separate = createTransaction();
        followUp = transactionCtx.run(separate, async () => {
          transactionCtx.onCommit(() => calls.push('separate'));
          await transactionCtx.commit(separate);
        });
      });
      await transactionCtx.commit(outer);
    });
    assert.ok(followUp);
    await followUp;

    assert.deepEqual(calls, ['outer', 'separate']);
  });

  it('isolates interleaved root transactions with different outcomes', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    let releaseFirst: () => void = () => assert.fail('release promise was not initialized');
    let signalFirst: () => void = () => assert.fail('ready promise was not initialized');
    const ready = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = database.transaction(async ({ trx, onCommit, onRollback }) => {
      onCommit(() => calls.push('first commit'));
      onRollback(() => calls.push('unexpected first rollback'));
      signalFirst();
      await release;
      assert.equal(transactionCtx.get(), trx);
    });

    await ready;
    try {
      await database.transaction(async ({ trx, onCommit, onRollback, rollback }) => {
        onCommit(() => calls.push('unexpected second commit'));
        onRollback(() => calls.push('second rollback'));
        assert.notEqual(trx, transactions[0]);
        await rollback();
      });
    } finally {
      releaseFirst();
    }
    await first;

    assert.equal(transactions.length, 2);
    assert.deepEqual(calls, ['second rollback', 'first commit']);
  });

  it('keeps explicitly finalized transactions idempotent', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];

    await database.transaction(async ({ onCommit, commit }) => {
      onCommit(() => calls.push('commit'));
      await commit();
      await commit();
    });

    assert.equal(transactions.length, 1);
    assert.deepEqual(calls, ['commit']);
  });

  it('runs rollback hooks when commit rejects before the transactor completes', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    const failure = new Error('commit failed before completion');

    await assert.rejects(
      database.transaction(({ trx, onCommit, onRollback }) => {
        trx.commit = () => Promise.reject(failure);
        onCommit(() => calls.push('unexpected commit'));
        onRollback(() => calls.push('rollback'));
      }),
      (error) => error === failure
    );

    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].isCompleted(), true);
    assert.deepEqual(calls, ['rollback']);
    assert.equal(transactionCtx.get(), undefined);
  });

  it('keeps recovery hooks isolated after rolling back a failed commit', async () => {
    const { database, transactions } = createDatabase();
    const calls: string[] = [];
    const failure = new Error('commit failed before completion');
    let recovery: Promise<unknown> | undefined;

    await assert.rejects(
      database.transaction(({ trx, onCommit, onRollback }) => {
        trx.commit = () => Promise.reject(failure);
        onCommit(() => calls.push('unexpected original commit'));
        onRollback(() => {
          calls.push('original rollback');
          recovery = database.transaction(({ onCommit }) => {
            onCommit(() => calls.push('recovery commit'));
          });
        });
      }),
      (error) => error === failure
    );
    assert.ok(recovery);
    await recovery;

    assert.equal(transactions.length, 2);
    assert.deepEqual(calls, ['original rollback', 'recovery commit']);
  });

  (['commit', 'rollback'] as const).forEach((operation) => {
    it(`does not start a second transaction while ${operation} is in flight`, async () => {
      const { database, transactions } = createDatabase();
      const finalizerGate = createGate();
      const detachedGate = createGate();
      let detached!: Promise<unknown>;

      await database.transaction(async (outer) => {
        const finalize = outer.trx[operation].bind(outer.trx);
        outer.trx[operation] = async () => {
          await finalizerGate.promise;
          return finalize();
        };
        await database.transaction(() => {
          detached = detachedGate.promise.then(() => database.transaction(() => {}));
        });

        const finalizing = outer[operation]();
        detachedGate.resolve();
        try {
          await assert.rejects(detached, /Transaction is finalizing/);
          assert.equal(transactions.length, 1);
          assert.throws(() => transactionCtx.get(), /Transaction is finalizing/);
          assert.throws(() => outer.onCommit(() => {}), /Transaction is finalizing/);
          assert.throws(() => outer.onRollback(() => {}), /Transaction is finalizing/);
        } finally {
          finalizerGate.resolve();
          await finalizing;
        }
      });

      assert.equal(transactions.length, 1);
    });

    it(`rejects detached work after ${operation} completes`, async () => {
      const { database, transactions } = createDatabase();
      const detachedGate = createGate();
      let detached!: Promise<unknown>;

      await database.transaction(async (outer) => {
        await database.transaction(() => {
          detached = detachedGate.promise.then(async () => {
            assert.throws(() => transactionCtx.get(), /Transaction is closed/);
            assert.throws(() => outer.onCommit(() => {}), /Transaction is closed/);
            assert.throws(() => outer.onRollback(() => {}), /Transaction is closed/);
            await assert.rejects(
              transactionCtx.run(outer.trx, () => {}),
              /Transaction is closed/
            );
            await database.transaction(() => {});
          });
        });
        await outer[operation]();
      });

      detachedGate.resolve();
      await assert.rejects(detached, /Transaction is closed/);
      assert.equal(transactions.length, 1);
    });

    it(`runs async ${operation} hooks outside the closed context without freeing old descendants`, async () => {
      const { database, transactions } = createDatabase();
      const gate = createGate();
      const calls: string[] = [];
      let followUp!: Promise<unknown>;
      let detached!: Promise<unknown>;

      await database.transaction(async (outer) => {
        const register = operation === 'commit' ? outer.onCommit : outer.onRollback;
        register(() => {
          assert.equal(transactionCtx.get(), undefined);
          followUp = gate.promise.then(() =>
            database.transaction(({ onCommit }) => {
              onCommit(() => calls.push('follow-up'));
            })
          );
        });
        await database.transaction(() => {
          detached = gate.promise.then(() => database.transaction(() => {}));
        });
        await outer[operation]();
      });

      gate.resolve();
      await assert.rejects(detached, /Transaction is closed/);
      await followUp;
      assert.equal(transactions.length, 2);
      assert.deepEqual(calls, ['follow-up']);
    });

    it(`coalesces repeated ${operation} helpers while the driver finalizer is pending`, async () => {
      const { database, transactions } = createDatabase();
      const gate = createGate();
      const calls: string[] = [];
      let finalizations = 0;

      await database.transaction(async (outer) => {
        const finalize = outer.trx[operation].bind(outer.trx);
        outer.trx[operation] = async () => {
          finalizations += 1;
          // Some drivers report completion before the finalizer promise resolves.
          const result = finalize();
          await gate.promise;
          return result;
        };
        const register = operation === 'commit' ? outer.onCommit : outer.onRollback;
        register(() => calls.push(operation));
        const first = outer[operation]();
        const second = outer[operation]();
        try {
          assert.equal(finalizations, 1);
          assert.deepEqual(calls, []);
          const competing = operation === 'commit' ? outer.rollback : outer.commit;
          await assert.rejects(competing(), /Transaction is finalizing/);
        } finally {
          gate.resolve();
          await Promise.all([first, second]);
        }
      });

      assert.equal(transactions.length, 1);
      assert.deepEqual(calls, [operation]);
    });

    it(`clears both hook lists before a ${operation} hook throws`, async () => {
      const { database, transactions } = createDatabase();
      const calls: string[] = [];
      const failure = new Error('completion hook failed');
      let followUp!: Promise<unknown>;

      await assert.rejects(
        database.transaction(async (outer) => {
          const register = operation === 'commit' ? outer.onCommit : outer.onRollback;
          register(() => {
            calls.push('original');
            assert.equal(transactionCtx.get(), undefined);
            followUp = database.transaction(({ onCommit }) => {
              onCommit(() => calls.push('follow-up'));
            });
            throw failure;
          });
          await outer[operation]();
        }),
        (error) => error === failure
      );
      await followUp;
      assert.equal(transactions.length, 2);
      assert.deepEqual(calls, ['original', 'follow-up']);
    });
  });

  it('rejects nested work during a failed commit and preserves rollback recovery hooks', async () => {
    const { database, transactions } = createDatabase();
    const detachedGate = createGate();
    const commitGate = createGate();
    const failure = new Error('commit failed before completion');
    const calls: string[] = [];
    let detached!: Promise<unknown>;
    let recovery!: Promise<unknown>;

    await assert.rejects(
      database.transaction(async (outer) => {
        outer.trx.commit = async () => {
          await commitGate.promise;
          throw failure;
        };
        outer.onCommit(() => calls.push('unexpected commit'));
        outer.onRollback(() => {
          calls.push('rollback');
          recovery = database.transaction(({ onCommit }) => {
            onCommit(() => calls.push('recovery'));
          });
        });
        await database.transaction(() => {
          detached = detachedGate.promise.then(() => database.transaction(() => {}));
        });
        const finalizing = outer.commit();
        detachedGate.resolve();
        try {
          await assert.rejects(detached, /Transaction is finalizing/);
          assert.equal(transactions.length, 1);
        } finally {
          commitGate.resolve();
          await finalizing;
        }
      }),
      (error) => error === failure
    );
    await recovery;
    assert.equal(transactions.length, 2);
    assert.deepEqual(calls, ['rollback', 'recovery']);
  });

  it('keeps the context closed when rollback itself fails', async () => {
    const { database } = createDatabase();
    const gate = createGate();
    const failure = new Error('rollback failed');
    let detached!: Promise<unknown>;
    const calls: string[] = [];

    await assert.rejects(
      database.transaction(async (outer) => {
        outer.trx.rollback = () => Promise.reject(failure);
        outer.onCommit(() => calls.push('unexpected commit'));
        outer.onRollback(() => calls.push('unexpected rollback'));
        detached = gate.promise.then(() => database.transaction(() => {}));
        throw new Error('original failure');
      }),
      (error) => error === failure
    );
    gate.resolve();
    await assert.rejects(detached, /Transaction is closed/);
    assert.deepEqual(calls, []);
  });
});
