import type { GlobalState } from '@toeverything/infra';
import { Service } from '@toeverything/infra';
import { map, type Observable, switchMap } from 'rxjs';

import type { ServersService } from '../../cloud';
import { UserDBService } from '../../userspace';
import type { EditorSettingProvider } from '../provider/editor-setting-provider';

export class CurrentUserDBEditorSettingProvider
  extends Service
  implements EditorSettingProvider
{
  private readonly currentUserDB$;
  fallback = new GlobalStateEditorSettingProvider(this.globalState);

  constructor(
    public readonly serversService: ServersService,
    public readonly globalState: GlobalState
  ) {
    super();

    const affineCloudServer = this.serversService.server$('affine-cloud').value; // TODO: support multiple servers
    if (!affineCloudServer) {
      throw new Error('affine-cloud server not found');
    }
    const userDBService = affineCloudServer.scope.get(UserDBService);
    this.currentUserDB$ = userDBService.currentUserDB.db$;
  }

  set(key: string, value: string): void {
    if (this.currentUserDB$.value) {
      this.currentUserDB$.value?.editorSetting.create({
        key,
        value,
      });
    } else {
      this.fallback.set(key, value);
    }
  }

  get(key: string): string | undefined {
    if (this.currentUserDB$.value) {
      return this.currentUserDB$.value?.editorSetting.get(key)?.value;
    } else {
      return this.fallback.get(key);
    }
  }

  watchAll(): Observable<Record<string, string>> {
    return this.currentUserDB$.pipe(
      switchMap(db => {
        if (db) {
          return db.editorSetting.find$().pipe(
            map(settings => {
              return settings.reduce(
                (acc, setting) => {
                  acc[setting.key] = setting.value;
                  return acc;
                },
                {} as Record<string, string>
              );
            })
          );
        } else {
          return this.fallback.watchAll();
        }
      })
    );
  }
}

const storageKey = 'editor-setting';

class GlobalStateEditorSettingProvider implements EditorSettingProvider {
  constructor(public readonly globalState: GlobalState) {}
  set(key: string, value: string): void {
    const all = this.globalState.get<Record<string, string>>(storageKey) ?? {};
    const after = {
      ...all,
      [key]: value,
    };
    this.globalState.set(storageKey, after);
  }
  get(key: string): string | undefined {
    return this.globalState.get<Record<string, string>>(storageKey)?.[key];
  }
  watchAll(): Observable<Record<string, string>> {
    return this.globalState
      .watch<Record<string, string>>(storageKey)
      .pipe(map(all => all ?? {}));
  }
}
