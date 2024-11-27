import { SafeArea } from '@affine/component';
import {
  WorkbenchLink,
  WorkbenchService,
} from '@affine/core/modules/workbench';
import { AllDocsIcon, MobileHomeIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import React from 'react';
import type { Location } from 'react-router-dom';

import { VirtualKeyboardService } from '../../modules/virtual-keyboard/services/virtual-keyboard';
import { AppTabCreate } from './create';
import { AppTabJournal } from './journal';
import * as styles from './styles.css';

interface AppTabBaseProps {
  key: string;
}
interface AppTabLinkProps extends AppTabBaseProps {
  Icon: React.FC;
  to: string;
  LinkComponent?: React.FC;
  isActive?: (location: Location) => boolean;
}
interface AppTabCustomProps extends AppTabBaseProps {
  node: React.ReactNode;
}

type Route = AppTabLinkProps | AppTabCustomProps;

const routes: Route[] = [
  {
    key: 'home',
    to: '/home',
    Icon: MobileHomeIcon,
  },
  {
    key: 'all',
    to: '/all',
    Icon: AllDocsIcon,
    isActive: location =>
      location.pathname === '/all' ||
      location.pathname.startsWith('/collection') ||
      location.pathname.startsWith('/tag'),
  },
  {
    key: 'journal',
    node: <AppTabJournal />,
  },
  {
    key: 'new',
    node: <AppTabCreate />,
  },
];

export const AppTabs = ({ background }: { background?: string }) => {
  const virtualKeyboardService = useService(VirtualKeyboardService);
  const virtualKeyboardVisible = useLiveData(virtualKeyboardService.show$);

  return (
    <SafeArea
      bottom
      className={styles.appTabs}
      bottomOffset={2}
      style={{
        ...assignInlineVars({
          [styles.appTabsBackground]: background,
        }),
        visibility: virtualKeyboardVisible ? 'hidden' : 'visible',
      }}
    >
      <ul className={styles.appTabsInner} id="app-tabs" role="tablist">
        {routes.map(route => {
          if ('to' in route) {
            return <AppTabLink route={route} key={route.key} />;
          } else {
            return (
              <React.Fragment key={route.key}>{route.node}</React.Fragment>
            );
          }
        })}
      </ul>
    </SafeArea>
  );
};

const AppTabLink = ({ route }: { route: AppTabLinkProps }) => {
  const workbench = useService(WorkbenchService).workbench;
  const location = useLiveData(workbench.location$);
  const Link = route.LinkComponent || WorkbenchLink;

  const isActive = route.isActive
    ? route.isActive(location)
    : location.pathname === route.to;
  return (
    <Link
      data-active={isActive}
      to={route.to}
      key={route.to}
      className={styles.tabItem}
      role="tab"
      aria-label={route.to.slice(1)}
      replaceHistory
    >
      <li style={{ lineHeight: 0 }}>
        <route.Icon />
      </li>
    </Link>
  );
};
