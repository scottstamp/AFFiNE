import { AffineContext } from '@affine/core/components/context';
import { AppFallback } from '@affine/core/mobile/components/app-fallback';
import { configureMobileModules } from '@affine/core/mobile/modules';
import { HapticProvider } from '@affine/core/mobile/modules/haptics';
import { NavigationGestureProvider } from '@affine/core/mobile/modules/navigation-gesture';
import { VirtualKeyboardProvider } from '@affine/core/mobile/modules/virtual-keyboard';
import { router } from '@affine/core/mobile/router';
import { configureCommonModules } from '@affine/core/modules';
import {
  AuthService,
  ValidatorProvider,
  WebSocketAuthProvider,
} from '@affine/core/modules/cloud';
import { I18nProvider } from '@affine/core/modules/i18n';
import { configureLocalStorageStateStorageImpls } from '@affine/core/modules/storage';
import { PopupWindowProvider } from '@affine/core/modules/url';
import { ClientSchemeProvider } from '@affine/core/modules/url/providers/client-schema';
import { configureIndexedDBUserspaceStorageProvider } from '@affine/core/modules/userspace';
import { configureBrowserWorkbenchModule } from '@affine/core/modules/workbench';
import {
  configureBrowserWorkspaceFlavours,
  configureIndexedDBWorkspaceEngineStorageProvider,
} from '@affine/core/modules/workspace-engine';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Haptics } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import {
  Framework,
  FrameworkRoot,
  getCurrentStore,
  LifecycleService,
} from '@toeverything/infra';
import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';

import { configureFetchProvider } from './fetch';
import { ModalConfigProvider } from './modal-config';
import { Cookie } from './plugins/cookie';
import { Hashcash } from './plugins/hashcash';
import { NavigationGesture } from './plugins/navigation-gesture';

const future = {
  v7_startTransition: true,
} as const;

const framework = new Framework();
configureCommonModules(framework);
configureBrowserWorkbenchModule(framework);
configureLocalStorageStateStorageImpls(framework);
configureBrowserWorkspaceFlavours(framework);
configureIndexedDBWorkspaceEngineStorageProvider(framework);
configureIndexedDBUserspaceStorageProvider(framework);
configureMobileModules(framework);
framework.impl(PopupWindowProvider, {
  open: (url: string) => {
    Browser.open({
      url,
      presentationStyle: 'popover',
    }).catch(console.error);
  },
});
framework.impl(ClientSchemeProvider, {
  getClientScheme() {
    return 'affine';
  },
});
configureFetchProvider(framework);
framework.impl(WebSocketAuthProvider, {
  getAuthToken: async url => {
    const cookies = await Cookie.getCookies({
      url,
    });
    return {
      userId: cookies['affine_user_id'],
      token: cookies['affine_session'],
    };
  },
});
framework.impl(ValidatorProvider, {
  async validate(_challenge, resource) {
    const res = await Hashcash.hash({ challenge: resource });
    return res.value;
  },
});
framework.impl(VirtualKeyboardProvider, {
  addEventListener: (event, callback) => {
    Keyboard.addListener(event as any, callback as any);
  },
  removeAllListeners: () => {
    Keyboard.removeAllListeners();
  },
});
framework.impl(NavigationGestureProvider, {
  isEnabled: () => NavigationGesture.isEnabled(),
  enable: () => NavigationGesture.enable(),
  disable: () => NavigationGesture.disable(),
});
framework.impl(HapticProvider, {
  impact: options => Haptics.impact(options as any),
  vibrate: options => Haptics.vibrate(options as any),
  notification: options => Haptics.notification(options as any),
  selectionStart: () => Haptics.selectionStart(),
  selectionChanged: () => Haptics.selectionChanged(),
  selectionEnd: () => Haptics.selectionEnd(),
});
const frameworkProvider = framework.provider();

// setup application lifecycle events, and emit application start event
window.addEventListener('focus', () => {
  frameworkProvider.get(LifecycleService).applicationFocus();
});
frameworkProvider.get(LifecycleService).applicationStart();

CapacitorApp.addListener('appUrlOpen', ({ url }) => {
  // try to close browser if it's open
  Browser.close().catch(e => console.error('Failed to close browser', e));

  const urlObj = new URL(url);

  if (urlObj.hostname === 'authentication') {
    const method = urlObj.searchParams.get('method');
    const payload = JSON.parse(urlObj.searchParams.get('payload') ?? 'false');

    if (
      !method ||
      (method !== 'magic-link' && method !== 'oauth') ||
      !payload
    ) {
      console.error('Invalid authentication url', url);
      return;
    }

    const authService = frameworkProvider.get(AuthService);
    if (method === 'oauth') {
      authService
        .signInOauth(payload.code, payload.state, payload.provider)
        .catch(console.error);
    } else if (method === 'magic-link') {
      authService
        .signInMagicLink(payload.email, payload.token)
        .catch(console.error);
    }
  }
});

export function App() {
  return (
    <Suspense>
      <FrameworkRoot framework={frameworkProvider}>
        <I18nProvider>
          <AffineContext store={getCurrentStore()}>
            <ModalConfigProvider>
              <RouterProvider
                fallbackElement={<AppFallback />}
                router={router}
                future={future}
              />
            </ModalConfigProvider>
          </AffineContext>
        </I18nProvider>
      </FrameworkRoot>
    </Suspense>
  );
}
