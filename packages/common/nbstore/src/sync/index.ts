import type { DocStorage, SpaceStorage } from '../storage';
import { DocSyncEngine } from './doc';

export class SyncEngine {
  constructor(
    readonly local: SpaceStorage,
    readonly peers: SpaceStorage[]
  ) {}

  async run(signal?: AbortSignal) {
    const doc = this.local.tryGet('doc');
    const sync = this.local.tryGet('sync');

    if (doc && sync) {
      const peerDocs = this.peers
        .map(peer => peer.tryGet('doc'))
        .filter((v): v is DocStorage => !!v);

      const engine = new DocSyncEngine(doc, sync, peerDocs);
      await engine.run(signal);
    }
  }
}
