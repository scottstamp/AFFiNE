import { OpClient } from '@toeverything/infra/op';

import type { Storage } from '../storage';
import type { SpaceStorageOps } from './ops';

export { SpaceStorageConsumer } from './consumer';

export class SpaceStorageClient extends OpClient<SpaceStorageOps> {
  /**
   * Adding a storage implementation to the backend.
   *
   * NOTE:
   *  Because the storage beckend might be put behind a worker, we cant pass the instance but only
   *  the constructor name and its options to let the backend construct the instance.
   */
  async addStorage<T extends new (...args: any) => Storage>(
    Impl: T,
    ...opts: ConstructorParameters<T>
  ) {
    await this.call('addStorage', { name: Impl.name, opts: opts[0] });
  }

  async connect() {
    await this.call('connect');
  }

  async disconnect() {
    await this.call('disconnect');
  }

  override async destroy() {
    await this.call('destroy');
    super.destroy();
  }

  connection$() {
    return this.ob$('connection');
  }
}

export class SpaceStorageWorkerClient extends SpaceStorageClient {
  private readonly worker: Worker;
  constructor() {
    const worker = new Worker(new URL('./worker.ts', import.meta.url));
    super(worker);
    this.worker = worker;
  }

  override async destroy() {
    await super.destroy();
    this.worker.terminate();
  }
}
