import type { DocStorage, SyncStorage } from '../../storage';
import { DocSyncPeer } from './peer';

export class DocSyncEngine {
  constructor(
    readonly local: DocStorage,
    readonly sync: SyncStorage,
    readonly peers: DocStorage[]
  ) {}

  async run(signal?: AbortSignal) {
    await Promise.all(
      this.peers.map(peer =>
        new DocSyncPeer(this.local, this.sync, peer).mainLoop(signal)
      )
    );
  }
}
