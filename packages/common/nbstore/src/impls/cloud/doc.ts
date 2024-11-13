import { noop } from 'lodash-es';
import type { SocketOptions } from 'socket.io-client';

import { share } from '../../connection';
import {
  type DocClocks,
  DocStorage,
  type DocStorageOptions,
  type DocUpdate,
} from '../../storage';
import {
  base64ToUint8Array,
  type ServerEventsMap,
  SocketConnection,
  uint8ArrayToBase64,
} from './socket';

interface CloudDocStorageOptions extends DocStorageOptions {
  socketOptions: SocketOptions;
}

export class CloudDocStorage extends DocStorage<CloudDocStorageOptions> {
  connection = share(
    new SocketConnection(this.peer, this.options.socketOptions)
  );

  private get socket() {
    return this.connection.inner;
  }

  override async connect(): Promise<void> {
    await super.connect();
    this.connection.onStatusChanged(status => {
      if (status === 'connected') {
        this.join().catch(noop);
        this.socket.on('space:broadcast-doc-update', this.onServerUpdate);
      }
    });
  }

  override async disconnect(): Promise<void> {
    this.socket.emit('space:leave', {
      spaceType: this.spaceType,
      spaceId: this.spaceId,
    });
    this.socket.off('space:broadcast-doc-update', this.onServerUpdate);
    await super.connect();
  }

  async join() {
    try {
      const res = await this.socket.emitWithAck('space:join', {
        spaceType: this.spaceType,
        spaceId: this.spaceId,
        clientVersion: BUILD_CONFIG.appVersion,
      });

      if ('error' in res) {
        this.connection.setStatus('closed', new Error(res.error.message));
      }
    } catch (e) {
      this.connection.setStatus('error', e as Error);
    }
  }

  onServerUpdate: ServerEventsMap['space:broadcast-doc-update'] = message => {
    if (
      this.spaceType === message.spaceType &&
      this.spaceId === message.spaceId
    ) {
      this.emit('update', {
        docId: message.docId,
        bin: base64ToUint8Array(message.update),
        timestamp: new Date(message.timestamp),
        editor: message.editor,
      });
    }
  };

  override async getDocSnapshot(docId: string) {
    const response = await this.socket.emitWithAck('space:load-doc', {
      spaceType: this.spaceType,
      spaceId: this.spaceId,
      docId,
    });

    if ('error' in response) {
      // TODO: use [UserFriendlyError]
      throw new Error(response.error.message);
    }

    return {
      docId,
      bin: base64ToUint8Array(response.data.missing),
      timestamp: new Date(response.data.timestamp),
    };
  }

  override async getDocDiff(docId: string, state?: Uint8Array) {
    const response = await this.socket.emitWithAck('space:load-doc', {
      spaceType: this.spaceType,
      spaceId: this.spaceId,
      docId,
      stateVector: state ? await uint8ArrayToBase64(state) : void 0,
    });

    if ('error' in response) {
      // TODO: use [UserFriendlyError]
      throw new Error(response.error.message);
    }

    return {
      docId,
      missing: base64ToUint8Array(response.data.missing),
      state: base64ToUint8Array(response.data.state),
      timestamp: new Date(response.data.timestamp),
    };
  }

  override async pushDocUpdate(update: DocUpdate) {
    const response = await this.socket.emitWithAck('space:push-doc-update', {
      spaceType: this.spaceType,
      spaceId: this.spaceId,
      docId: update.docId,
      updates: await uint8ArrayToBase64(update.bin),
    });

    if ('error' in response) {
      // TODO(@forehalo): use [UserFriendlyError]
      throw new Error(response.error.message);
    }

    return {
      docId: update.docId,
      timestamp: new Date(response.data.timestamp),
    };
  }

  override async getDocTimestamps(after?: Date) {
    const response = await this.socket.emitWithAck(
      'space:load-doc-timestamps',
      {
        spaceType: this.spaceType,
        spaceId: this.spaceId,
        timestamp: after ? after.getTime() : undefined,
      }
    );

    if ('error' in response) {
      // TODO(@forehalo): use [UserFriendlyError]
      throw new Error(response.error.message);
    }

    return Object.entries(response.data).reduce((ret, [docId, timestamp]) => {
      ret[docId] = new Date(timestamp);
      return ret;
    }, {} as DocClocks);
  }

  override async deleteDoc(docId: string) {
    this.socket.emit('space:delete-doc', {
      spaceType: this.spaceType,
      spaceId: this.spaceId,
      docId,
    });
  }

  protected async setDocSnapshot() {
    return false;
  }
  protected async getDocUpdates() {
    return [];
  }
  protected async markUpdatesMerged() {
    return 0;
  }
}
