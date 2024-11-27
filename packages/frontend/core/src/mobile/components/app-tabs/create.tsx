import { usePageHelper } from '@affine/core/components/blocksuite/block-suite-page-list/utils';
import { JournalService } from '@affine/core/modules/journal';
import { WorkbenchService } from '@affine/core/modules/workbench';
import track from '@affine/track';
import { EditIcon } from '@blocksuite/icons/rc';
import {
  DocsService,
  useLiveData,
  useServices,
  WorkspaceService,
} from '@toeverything/infra';
import { useCallback } from 'react';

import { tabItem } from './styles.css';

export const AppTabCreate = () => {
  const { docsService, workbenchService, workspaceService, journalService } =
    useServices({
      DocsService,
      WorkbenchService,
      WorkspaceService,
      JournalService,
    });
  const workbench = workbenchService.workbench;
  const currentWorkspace = workspaceService.workspace;
  const location = useLiveData(workbench.location$);
  const pageHelper = usePageHelper(currentWorkspace.docCollection);

  const maybeDocId = location.pathname.split('/')[1].split('?')[0];
  const doc = useLiveData(docsService.list.doc$(maybeDocId));
  const journalDate = useLiveData(journalService.journalDate$(maybeDocId));
  const isActive = !!doc && !journalDate;

  const createPage = useCallback(() => {
    if (isActive) return;
    pageHelper.createPage(undefined, true);
    track.$.navigationPanel.$.createDoc();
  }, [isActive, pageHelper]);

  return (
    <div
      className={tabItem}
      data-active={isActive}
      role="tab"
      aria-label="New Page"
      onClick={createPage}
    >
      <EditIcon />
    </div>
  );
};
