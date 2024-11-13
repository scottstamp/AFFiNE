import {
  type DocClock,
  type DocClocks,
  share,
  SyncStorage,
} from '@affine/nbstore';

import { NativeDBConnection } from './db';

export class SqliteSyncStorage extends SyncStorage {
  override connection = share(
    new NativeDBConnection(this.peer, this.spaceType, this.spaceId)
  );

  get db() {
    return this.connection.inner;
  }

  override async getPeerClocks(peer: string) {
    const records = await this.db.getPeerClocks(peer);
    return records.reduce((clocks, { docId, timestamp }) => {
      clocks[docId] = timestamp;
      return clocks;
    }, {} as DocClocks);
  }

  override async setPeerClock(peer: string, clock: DocClock) {
    await this.db.setPeerClock(peer, clock.docId, clock.timestamp);
  }

  override async getPeerPushedClocks(peer: string) {
    const records = await this.db.getPeerPushedClocks(peer);
    return records.reduce((clocks, { docId, timestamp }) => {
      clocks[docId] = timestamp;
      return clocks;
    }, {} as DocClocks);
  }

  override async setPeerPushedClock(peer: string, clock: DocClock) {
    await this.db.setPeerPushedClock(peer, clock.docId, clock.timestamp);
  }

  override async clearClocks() {
    await this.db.clearClocks();
  }
}
