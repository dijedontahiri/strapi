import { AsyncLocalStorage } from 'node:async_hooks';
import { Knex } from 'knex';

/**
 * After the user calls the Knex transactor’s `commit` or `rollback` (e.g. via
 * the callback object returned from `Database#transaction`, or after the
 * container’s promise has settled in Knex), a second finalisation is invalid
 * and can throw (e.g. "Transaction query already complete"). Knex exposes
 * `isCompleted()` for this; optional for mocks that omit it.
 */
const isTransactorComplete = (trx: Knex.Transaction) => {
  const t = trx as Knex.Transaction & { isCompleted?: () => boolean };
  return typeof t.isCompleted === 'function' && t.isCompleted();
};

export type Callback = (...args: any[]) => Promise<any> | any;

export interface TransactionObject {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  get: () => Knex.Transaction;
}
export interface Store {
  trx: Knex.Transaction | null;
  commitCallbacks: Callback[];
  rollbackCallbacks: Callback[];
}

type Finalization = 'commit' | 'rollback';

interface TransactionStore extends Store {
  // Retain ownership after a failed commit so rollback can still find its hooks.
  owner: Knex.Transaction | null;
  phase: 'active' | 'finalizing' | 'closed';
  finalization?: { operation: Finalization; promise: Promise<void> };
}

const storage = new AsyncLocalStorage<TransactionStore>();

const getTransactionStore = (trx: Knex.Transaction) => {
  const store = storage.getStore();
  return store?.owner === trx ? store : undefined;
};

const assertActive = (store: TransactionStore | undefined) => {
  if (store && store.phase !== 'active') {
    throw new Error(`Transaction is ${store.phase}`);
  }
};

const closeStore = (store: TransactionStore | undefined) => {
  if (store) {
    // Descendants keep the closed state, but not the transactor or either set of hooks.
    store.phase = 'closed';
    store.trx = null;
    store.owner = null;
    store.commitCallbacks = [];
    store.rollbackCallbacks = [];
  }
};

const finalize = async (trx: Knex.Transaction, operation: Finalization) => {
  const store = getTransactionStore(trx);
  // Knex can report completion before its finalizer settles. Do not clear hooks early
  // or send a competing finalizer while the first one is still in flight.
  if (store?.finalization) {
    if (store.finalization.operation !== operation) {
      throw new Error('Transaction is finalizing');
    }
    return store.finalization.promise;
  }

  if (isTransactorComplete(trx)) {
    closeStore(store);
    return;
  }

  if (operation === 'commit') {
    assertActive(store);
  }
  if (store) {
    store.phase = 'finalizing';
  }

  const finish = async () => {
    try {
      await trx[operation]();
    } catch (error) {
      // An incomplete failed commit must remain closed to new work while its owner
      // and rollback hooks are retained for Database.transaction's catch path.
      if (operation === 'rollback' || isTransactorComplete(trx)) {
        closeStore(store);
      }
      throw error;
    }

    const callbacks = store?.[operation === 'commit' ? 'commitCallbacks' : 'rollbackCallbacks'];
    closeStore(store);
    // Only completion hooks (and async work they create) leave the closed context.
    // Preserve the existing synchronous, fire-and-forget callback dispatch contract.
    storage.exit(() => callbacks?.forEach((cb) => cb()));
  };

  const promise = finish();
  if (store) {
    store.finalization = { operation, promise };
  }
  try {
    await promise;
  } finally {
    if (store) {
      store.finalization = undefined;
    }
  }
};

const transactionCtx = {
  async run<TCallback extends Callback>(trx: Knex.Transaction, cb: TCallback) {
    const parentStore = storage.getStore();
    assertActive(parentStore);
    // Only scopes of the same active transaction share its lifecycle and callbacks.
    const store: TransactionStore =
      parentStore?.trx === trx
        ? parentStore
        : { owner: trx, trx, phase: 'active', commitCallbacks: [], rollbackCallbacks: [] };

    return storage.run<ReturnType<TCallback>, void[]>(store, cb);
  },

  get() {
    const store = storage.getStore();
    assertActive(store);
    return store?.trx;
  },

  async commit(trx: Knex.Transaction) {
    await finalize(trx, 'commit');
  },

  async rollback(trx: Knex.Transaction) {
    await finalize(trx, 'rollback');
  },

  onCommit(cb: Callback) {
    const store = storage.getStore();
    assertActive(store);
    store?.commitCallbacks.push(cb);
  },

  onRollback(cb: Callback) {
    const store = storage.getStore();
    assertActive(store);
    store?.rollbackCallbacks.push(cb);
  },
};

export { transactionCtx };
