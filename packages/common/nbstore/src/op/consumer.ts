import type { OpConsumer } from '@toeverything/infra/op';
import { Observable } from 'rxjs';

import { getAvailableStorageImplementations } from '../impls';
import {
  BlobStorage,
  DocStorage,
  HistoricalDocStorage,
  SpaceStorage,
  type Storage,
  type StorageOptions,
  SyncStorage,
} from '../storage';
import type { SpaceStorageOps } from './ops';

export class SpaceStorageConsumer extends SpaceStorage {
  constructor(private readonly consumer: OpConsumer<SpaceStorageOps>) {
    super([]);
    this.registerConnectionHandlers();
    this.listen();
  }

  listen() {
    this.consumer.listen();
  }

  add(name: string, options: StorageOptions) {
    const Storage = getAvailableStorageImplementations(name);
    const storage = new Storage(options);
    this.storages.set(storage.storageType, storage);
    this.registerStorageHandlers(storage);
  }

  override async destroy() {
    await super.destroy();
    this.consumer.destroy();
  }

  private registerConnectionHandlers() {
    this.consumer.register('addStorage', ({ name, opts }) => {
      this.add(name, opts);
    });
    this.consumer.register('connect', this.connect.bind(this));
    this.consumer.register('disconnect', this.disconnect.bind(this));
    this.consumer.register('connection', () => {
      return new Observable(subscriber => {
        subscriber.add(
          this.on('connection', payload => {
            subscriber.next(payload);
          })
        );
      });
    });
    this.consumer.register('destroy', this.destroy.bind(this));
  }

  private registerStorageHandlers(storage: Storage) {
    if (storage instanceof DocStorage) {
      this.registerDocHandlers(storage);
    } else if (storage instanceof BlobStorage) {
      this.registerBlobHandlers(storage);
    } else if (storage instanceof SyncStorage) {
      this.registerSyncHandlers(storage);
    }
  }

  private registerDocHandlers(storage: DocStorage) {
    this.consumer.register('getDoc', storage.getDoc.bind(storage));
    this.consumer.register('getDocDiff', ({ docId, state }) => {
      return storage.getDocDiff(docId, state);
    });
    this.consumer.register('pushDocUpdate', ({ update, origin }) => {
      return storage.pushDocUpdate(update, origin);
    });
    this.consumer.register(
      'getDocTimestamps',
      storage.getDocTimestamps.bind(storage)
    );
    this.consumer.register('deleteDoc', storage.deleteDoc.bind(storage));
    this.consumer.register('subscribeDocUpdate', () => {
      return new Observable(subscriber => {
        subscriber.add(
          storage.subscribeDocUpdate((update, origin) => {
            subscriber.next({ update, origin });
          })
        );
      });
    });

    if (storage instanceof HistoricalDocStorage) {
      this.consumer.register('listHistory', ({ docId, filter }) => {
        return storage.listHistories(docId, filter);
      });
      this.consumer.register('getHistory', ({ docId, timestamp }) => {
        return storage.getHistory(docId, timestamp);
      });
      this.consumer.register('deleteHistory', ({ docId, timestamp }) => {
        return storage.deleteHistory(docId, timestamp);
      });
      this.consumer.register('rollbackDoc', ({ docId, timestamp }) => {
        return storage.rollbackDoc(docId, timestamp);
      });
    }
  }

  private registerBlobHandlers(storage: BlobStorage) {
    this.consumer.register('getBlob', storage.get.bind(storage));
    this.consumer.register('setBlob', storage.set.bind(storage));
    this.consumer.register('deleteBlob', ({ key, permanently }) => {
      return storage.delete(key, permanently);
    });
    this.consumer.register('listBlobs', storage.list.bind(storage));
    this.consumer.register('releaseBlobs', storage.release.bind(storage));
  }

  private registerSyncHandlers(storage: SyncStorage) {
    this.consumer.register(
      'getPeerClocks',
      storage.getPeerRemoteClocks.bind(storage)
    );
    this.consumer.register('setPeerClock', ({ peer, ...clock }) => {
      return storage.setPeerRemoteClock(peer, clock);
    });
    this.consumer.register(
      'getPeerPushedClocks',
      storage.getPeerPushedClocks.bind(storage)
    );
    this.consumer.register('setPeerPushedClock', ({ peer, ...clock }) => {
      return storage.setPeerPushedClock(peer, clock);
    });
    this.consumer.register('clearClocks', storage.clearClocks.bind(storage));
  }
}
