import type { Connection } from '../connection';

export type SpaceType = 'workspace' | 'userspace';
export type StorageType = 'blob' | 'doc' | 'sync';

export interface StorageOptions {
  peer: string;
  type: SpaceType;
  id: string;
}

export function universalId({ peer, type, id }: StorageOptions) {
  return `@peer(${peer});@type(${type});@id(${id});`;
}

export function isValidUniversalId(opts: Record<string, string>): boolean {
  const requiredKeys: Array<keyof StorageOptions> = [
    'peer',
    'type',
    'id',
  ] as const;

  for (const key of requiredKeys) {
    if (!opts[key]) {
      return false;
    }
  }

  return opts.type === 'userspace' || opts.type === 'workspace';
}

export function parseUniversalId(id: string) {
  const result: Record<string, string> = {};
  let key = '';
  let value = '';
  let isInValue = false;

  let i = -1;

  while (++i < id.length) {
    const ch = id[i];
    const nextCh = id[i + 1];

    // when we are in value string, we only care about ch and next char to be [')', ';'] to end the id part
    if (isInValue) {
      if (ch === ')' && nextCh === ';') {
        result[key] = value;
        key = '';
        value = '';
        isInValue = false;
        i++;
        continue;
      }

      value += ch;
      continue;
    }

    if (ch === '@') {
      const keyEnd = id.indexOf('(', i);
      // we find '@' but no '(' in lookahead or '(' is immediately after '@', invalid id
      if (keyEnd === -1 || keyEnd === i + 1) {
        break;
      }

      key = id.slice(i + 1, keyEnd);
      i = keyEnd;
      isInValue = true;
    } else {
      break;
    }
  }

  if (!isValidUniversalId(result)) {
    throw new Error(
      `Invalid universal storage id: ${id}. It should be in format of @peer(\${peer});@type(\${type});@id(\${id});`
    );
  }

  return result as any;
}

export abstract class Storage<Opts extends StorageOptions = StorageOptions> {
  abstract readonly storageType: StorageType;
  abstract readonly connection: Connection;

  get peer() {
    return this.options.peer;
  }

  get spaceType() {
    return this.options.type;
  }

  get spaceId() {
    return this.options.id;
  }

  get universalId() {
    return universalId(this.options);
  }

  constructor(public readonly options: Opts) {}

  async connect() {
    await this.connection.connect();
  }

  async disconnect() {
    await this.connection.disconnect();
  }
}
