import { apis, events } from '@affine/electron-api';

import { Connection, type ConnectionStatus } from '../../connection';
import { type SpaceType, universalId } from '../../storage';

type NativeDBApis = NonNullable<typeof apis>['nbstore'] extends infer APIs
  ? {
      [K in keyof APIs]: APIs[K] extends (...args: any[]) => any
        ? Parameters<APIs[K]> extends [string, ...infer Rest]
          ? (...args: Rest) => ReturnType<APIs[K]>
          : never
        : never;
    }
  : never;

export class NativeDBConnection extends Connection<void> {
  readonly apis: NativeDBApis;

  constructor(
    private readonly peer: string,
    private readonly type: SpaceType,
    private readonly id: string
  ) {
    super();
    if (!apis) {
      throw new Error('Not in electron context.');
    }

    this.apis = this.bindApis(apis.nbstore);
    this.listenToConnectionEvents();
  }

  override get shareId(): string {
    return `sqlite:${this.peer}:${this.type}:${this.id}`;
  }

  bindApis(originalApis: NonNullable<typeof apis>['nbstore']): NativeDBApis {
    const id = universalId({
      peer: this.peer,
      type: this.type,
      id: this.id,
    });
    return new Proxy(originalApis, {
      get: (target, key: keyof NativeDBApis) => {
        const v = target[key];
        if (typeof v !== 'function') {
          return v;
        }

        return async (...args: any[]) => {
          return v.call(
            originalApis,
            id,
            // @ts-expect-error I don't know why it complains ts(2556)
            ...args
          );
        };
      },
    }) as unknown as NativeDBApis;
  }

  override async doConnect() {
    await this.apis.connect();
  }

  override async doDisconnect() {
    await this.apis.close();
  }

  private listenToConnectionEvents() {
    events?.nbstore.onConnectionStatusChanged(
      ({ peer, spaceType, spaceId, status, error }) => {
        if (
          peer === this.peer &&
          spaceType === this.type &&
          spaceId === this.id
        ) {
          this.setStatus(status as ConnectionStatus, error);
        }
      }
    );
  }
}
