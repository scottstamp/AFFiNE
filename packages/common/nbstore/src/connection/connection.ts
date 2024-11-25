import EventEmitter2 from 'eventemitter2';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';

export abstract class Connection<T = any> {
  private readonly event = new EventEmitter2();
  private _inner: T | null = null;
  private _status: ConnectionStatus = 'idle';
  protected error?: Error;
  private refCount = 0;

  constructor() {
    this.autoReconnect();
  }

  get shareId(): string | undefined {
    return undefined;
  }

  get maybeConnection() {
    return this._inner;
  }

  get inner(): T {
    if (!this._inner) {
      throw new Error(
        `Connection ${this.constructor.name} has not been established.`
      );
    }

    return this._inner;
  }

  protected set inner(inner: T | null) {
    this._inner = inner;
  }

  get status() {
    return this._status;
  }

  protected setStatus(status: ConnectionStatus, error?: Error) {
    const shouldEmit = status !== this._status && error !== this.error;
    this._status = status;
    this.error = error;
    if (shouldEmit) {
      this.emitStatusChanged(status, error);
    }
  }

  abstract doConnect(): Promise<T>;
  abstract doDisconnect(conn: T): Promise<void>;

  ref() {
    this.refCount++;
  }

  deref() {
    this.refCount = Math.max(0, this.refCount - 1);
  }

  async connect() {
    if (this.status === 'idle' || this.status === 'error') {
      this.setStatus('connecting');
      try {
        this._inner = await this.doConnect();
        this.setStatus('connected');
      } catch (error) {
        this.setStatus('error', error as any);
      }
    }
  }

  async disconnect() {
    this.deref();
    if (this.refCount > 0) {
      return;
    }

    if (this.status === 'connected') {
      try {
        if (this._inner) {
          await this.doDisconnect(this._inner);
          this._inner = null;
        }
        this.setStatus('closed');
      } catch (error) {
        this.setStatus('error', error as any);
      }
    }
  }

  private autoReconnect() {
    // TODO:
    //   - maximum retry count
    //   - dynamic sleep time (attempt < 3 ? 1s : 1min)?
    this.onStatusChanged(() => {
      this.connect().catch(() => {});
    });
  }

  waitForConnected(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (this.status === 'connected') {
        resolve();
        return;
      }

      this.onStatusChanged(status => {
        if (status === 'connected') {
          resolve();
        }
      });

      signal?.addEventListener('abort', reason => {
        reject(reason);
      });
    });
  }

  onStatusChanged(
    cb: (status: ConnectionStatus, error?: Error) => void
  ): () => void {
    this.event.on('statusChanged', cb);
    return () => {
      this.event.off('statusChanged', cb);
    };
  }

  private readonly emitStatusChanged = (
    status: ConnectionStatus,
    error?: Error
  ) => {
    this.event.emit('statusChanged', status, error);
  };
}

export class DummyConnection extends Connection<undefined> {
  doConnect() {
    return Promise.resolve(undefined);
  }

  doDisconnect() {
    return Promise.resolve(undefined);
  }
}
