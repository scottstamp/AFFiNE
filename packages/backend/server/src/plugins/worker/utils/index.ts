export * from './headers';
export * from './proxy';
export * from './url';

export function parseJson<T>(data: string): T | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
