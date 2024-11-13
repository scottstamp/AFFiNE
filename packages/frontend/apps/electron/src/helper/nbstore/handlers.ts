import {
  type BlobRecord,
  type DocClock,
  type DocUpdate,
  parseUniversalId,
  SpaceStorage,
  type SpaceType,
  type StorageType,
} from '@affine/nbstore';
import { Subject } from 'rxjs';

import { logger } from '../logger';
import type { MainEventRegister } from '../type';
import { SqliteBlobStorage } from './blob';
import { SqliteDocStorage } from './doc';
import { SqliteSyncStorage } from './sync';

const STORE_CACHE = new Map<string, SpaceStorage>();
const CONNECTION$ = new Subject<{
  peer: string;
  spaceType: SpaceType;
  spaceId: string;
  storage: StorageType;
  status: string;
  error?: Error;
}>();

process.on('beforeExit', () => {
  CONNECTION$.complete();
  STORE_CACHE.forEach(store => {
    store.destroy().catch(err => {
      logger.error('[nbstore] destroy store failed', err);
    });
  });
});

async function ensureStore(universalId: string) {
  const { peer, type, id } = parseUniversalId(universalId);
  let store = STORE_CACHE.get(universalId);

  if (!store) {
    const opts = {
      peer,
      type,
      id,
    };
    store = new SpaceStorage([
      new SqliteDocStorage(opts),
      new SqliteBlobStorage(opts),
      new SqliteSyncStorage(opts),
    ]);

    store.on('connection', ({ storage, status, error }) => {
      CONNECTION$.next({
        peer,
        spaceType: type,
        spaceId: id,
        storage,
        status,
        error,
      });
      logger.info(
        `[nbstore] status changed: ${status}, spaceType: ${type}, spaceId: ${id}, storage: ${storage}`
      );
      if (error) {
        logger.error(`[nbstore] connection error: ${error}`);
      }
    });

    await store.connect();

    STORE_CACHE.set(universalId, store);
  }

  return store;
}

export const nbstoreHandlers = {
  connect: async (id: string) => {
    await ensureStore(id);
  },

  close: async (id: string) => {
    const store = STORE_CACHE.get(id);
    if (store) {
      await store.disconnect();
      // The store may be shared with other tabs, so we don't delete it from cache
      // the underlying connection will handle the close correctly
      // STORE_CACHE.delete(`${spaceType}:${spaceId}`);
    }
  },

  pushDocUpdate: async (id: string, update: DocUpdate) => {
    const store = await ensureStore(id);
    return store.get('doc').pushDocUpdate(update);
  },

  getDoc: async (id: string, docId: string) => {
    const store = await ensureStore(id);
    return store.get('doc').getDoc(docId);
  },

  deleteDoc: async (id: string, docId: string) => {
    const store = await ensureStore(id);
    return store.get('doc').deleteDoc(docId);
  },

  getDocTimestamps: async (id: string, after?: Date) => {
    const store = await ensureStore(id);
    return store.get('doc').getDocTimestamps(after);
  },

  setBlob: async (id: string, blob: BlobRecord) => {
    const store = await ensureStore(id);
    return store.get('blob').set(blob);
  },

  getBlob: async (id: string, key: string) => {
    const store = await ensureStore(id);
    return store.get('blob').get(key);
  },

  deleteBlob: async (id: string, key: string, permanently: boolean) => {
    const store = await ensureStore(id);
    return store.get('blob').delete(key, permanently);
  },

  listBlobs: async (id: string) => {
    const store = await ensureStore(id);
    return store.get('blob').list();
  },

  releaseBlobs: async (id: string) => {
    const store = await ensureStore(id);
    return store.get('blob').release();
  },

  getPeerClocks: async (id: string, peer: string) => {
    const store = await ensureStore(id);
    return store.get('sync').getPeerClocks(peer);
  },

  setPeerClock: async (id: string, peer: string, clock: DocClock) => {
    const store = await ensureStore(id);
    return store.get('sync').setPeerClock(peer, clock);
  },

  getPeerPushedClocks: async (id: string, peer: string) => {
    const store = await ensureStore(id);
    return store.get('sync').getPeerPushedClocks(peer);
  },

  setPeerPushedClock: async (id: string, peer: string, clock: DocClock) => {
    const store = await ensureStore(id);
    return store.get('sync').setPeerPushedClock(peer, clock);
  },

  clearClocks: async (id: string) => {
    const store = await ensureStore(id);
    return store.get('sync').clearClocks();
  },
};

export const nbstoreEvents = {
  onConnectionStatusChanged: (
    fn: (payload: {
      peer: string;
      spaceType: SpaceType;
      spaceId: string;
      storage: StorageType;
      status: string;
      error?: Error;
    }) => void
  ) => {
    const sub = CONNECTION$.subscribe({
      next: fn,
    });
    return () => {
      sub.unsubscribe();
    };
  },
} satisfies Record<string, MainEventRegister>;
