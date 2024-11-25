import { type OpSchema } from '@toeverything/infra/op';

import type { ConnectionStatus } from '../connection';
import type {
  BlobRecord,
  DocClock,
  DocClocks,
  DocDiff,
  DocRecord,
  DocUpdate,
  HistoryFilter,
  ListedBlobRecord,
  ListedHistory,
  StorageOptions,
  StorageType,
} from '../storage';

export interface SpaceStorageOps extends OpSchema {
  // init
  addStorage: [{ name: string; opts: StorageOptions }, void];

  // connection
  connect: [void, void];
  disconnect: [void, void];
  connection: [
    void,
    { storage: StorageType; status: ConnectionStatus; error?: Error },
  ];
  destroy: [void, void];

  // doc
  getDoc: [string, DocRecord | null];
  getDocDiff: [{ docId: string; state?: Uint8Array }, DocDiff | null];
  pushDocUpdate: [{ update: DocUpdate; origin?: string }, DocClock];
  getDocTimestamps: [Date, DocClocks];
  deleteDoc: [string, void];
  subscribeDocUpdate: [void, { update: DocRecord; origin?: string }];

  // history
  listHistory: [{ docId: string; filter?: HistoryFilter }, ListedHistory[]];
  getHistory: [DocClock, DocRecord | null];
  deleteHistory: [DocClock, void];
  rollbackDoc: [DocClock & { editor?: string }, void];

  // blob
  getBlob: [string, BlobRecord | null];
  setBlob: [BlobRecord, void];
  deleteBlob: [{ key: string; permanently: boolean }, void];
  releaseBlobs: [void, void];
  listBlobs: [void, ListedBlobRecord[]];

  // sync
  getPeerClocks: [string, DocClocks];
  setPeerClock: [{ peer: string } & DocClock, void];
  getPeerPushedClocks: [string, DocClocks];
  setPeerPushedClock: [{ peer: string } & DocClock, void];
  clearClocks: [void, void];
}
