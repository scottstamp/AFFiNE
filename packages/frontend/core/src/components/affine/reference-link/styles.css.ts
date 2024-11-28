import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const pageReferenceIcon = style({
  verticalAlign: 'middle',
  fontSize: '1.1em',
  transform: 'translate(2px, -1px)',
  color: cssVarV2('icon/primary'),
});

export const pageReferenceLink = style({
  textDecoration: 'none',
  color: 'inherit',
  wordBreak: 'break-word',
  hyphens: 'auto',
});
