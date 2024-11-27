import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, globalStyle } from '@vanilla-extract/css';

export const globalVars = {
  appTabHeight: createVar('appTabHeight'),
};

globalStyle(':root', {
  vars: {
    [globalVars.appTabHeight]: BUILD_CONFIG.isIOS ? '49px' : '62px',
  },
  userSelect: 'none',
});

globalStyle('body', {
  height: 'auto',
  minHeight: '100dvh',
  overflowY: 'unset',
});
globalStyle('body:has(#app-tabs)', {
  paddingBottom: `calc(${globalVars.appTabHeight} + env(safe-area-inset-bottom))`,
});
globalStyle('html', {
  height: '100dvh',
  overflowY: 'auto',
  background: cssVarV2('layer/background/secondary'),
});

globalStyle('a:focus', {
  outline: 'none',
});
globalStyle('button:focus', {
  outline: 'none',
});
