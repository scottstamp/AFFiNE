import path from 'node:path';

import { DocStorage as NativeDocStorage } from '@affine/native';
import { Connection, type SpaceType } from '@affine/nbstore';
import fs from 'fs-extra';

import { logger } from '../logger';
import { getAppDataPath } from '../workspace/meta';

export function escapeFilename(name: string) {
  return name.replaceAll(/[\\/!@#$%^&*()+~`"':;,?<>|]/g, '_');
}

export class NativeDBConnection extends Connection<NativeDocStorage> {
  constructor(
    private readonly peer: string,
    private readonly type: SpaceType,
    private readonly id: string
  ) {
    super();
  }

  override get shareId(): string {
    return `sqlite:${this.peer}:${this.type}:${this.id}`;
  }

  override async doConnect() {
    const basePath = await getAppDataPath();
    const dbPath = path.join(
      basePath,
      this.type,
      // do not introduce too many nested directories
      escapeFilename(this.id + '__' + this.peer),
      'storage.db'
    );
    await fs.ensureDir(path.dirname(dbPath));
    const conn = new NativeDocStorage(dbPath);
    await conn.init();
    logger.info('[nbstore] connection established', this.shareId);
    return conn;
  }

  override async doDisconnect(conn: NativeDocStorage) {
    await conn.close();
    logger.info('[nbstore] connection closed', this.shareId);
  }
}
