import { share } from '../../connection';
import { type DocClock, SyncStorage } from '../../storage';
import { NativeDBConnection } from './db';

export class SqliteSyncStorage extends SyncStorage {
  override connection = share(
    new NativeDBConnection(this.peer, this.spaceType, this.spaceId)
  );

  get db() {
    return this.connection.apis;
  }

  override async getPeerClocks(peer: string) {
    return this.db.getPeerClocks(peer);
  }

  override async setPeerClock(peer: string, clock: DocClock) {
    await this.db.setPeerClock(peer, clock);
  }

  override async getPeerPushedClocks(peer: string) {
    return this.db.getPeerPushedClocks(peer);
  }

  override async setPeerPushedClock(peer: string, clock: DocClock) {
    await this.db.setPeerPushedClock(peer, clock);
  }

  override async clearClocks() {
    await this.db.clearClocks();
  }
}
