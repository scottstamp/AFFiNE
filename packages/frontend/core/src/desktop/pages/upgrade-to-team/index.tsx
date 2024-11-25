import {
  Button,
  Divider,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  useConfirmModal,
} from '@affine/component';
import { AuthPageContainer } from '@affine/component/auth-components';
import { useWorkspaceInfo } from '@affine/core/components/hooks/use-workspace-info';
import { PureWorkspaceCard } from '@affine/core/components/workspace-selector/workspace-card';
import { UNTITLED_WORKSPACE_NAME } from '@affine/env/constant';
import { WorkspaceFlavour } from '@affine/env/workspace';
import { type I18nString, Trans, useI18n } from '@affine/i18n';
import { DoneIcon, NewPageIcon } from '@blocksuite/icons/rc';
import {
  useLiveData,
  useService,
  type WorkspaceMetadata,
  WorkspacesService,
} from '@toeverything/infra';
import { useCallback, useMemo, useState } from 'react';

import * as styles from './styles.css';

const benefitList: I18nString[] = [
  'com.affine.upgrade-to-team-page.benefit.g1',
  'com.affine.upgrade-to-team-page.benefit.g2',
  'com.affine.upgrade-to-team-page.benefit.g3',
  'com.affine.upgrade-to-team-page.benefit.g4',
];

export const Component = () => {
  const t = useI18n();
  const { openConfirmModal } = useConfirmModal();
  const workspacesList = useService(WorkspacesService).list;
  const workspaces = useLiveData(workspacesList.workspaces$);
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<WorkspaceMetadata | null>(null);

  const information = useWorkspaceInfo(selectedWorkspace || undefined);

  const name = information?.name ?? UNTITLED_WORKSPACE_NAME;

  const menuTriggerText = useMemo(() => {
    if (selectedWorkspace) {
      return name;
    }
    return t[
      'com.affine.upgrade-to-team-page.workspace-selector.placeholder'
    ]();
  }, [name, selectedWorkspace, t]);

  const onUpgradeButtonClick = useCallback(() => {
    openConfirmModal({
      title: t['com.affine.upgrade-to-team-page.upgrade-confirm.title'](),
      description: (
        <Trans
          i18nKey="com.affine.upgrade-to-team-page.upgrade-confirm.description"
          components={{
            1: <span style={{ fontWeight: 600 }} />,
          }}
          values={{
            workspaceName: name,
          }}
        />
      ),
      confirmText: t['com.affine.payment.upgrade'](),
      confirmButtonOptions: {
        variant: 'primary',
      },
      onConfirm: () => {
        //TODO(@JimmFly): upgrade workspace function
      },
    });
  }, [name, openConfirmModal, t]);

  return (
    <AuthPageContainer title={t['com.affine.upgrade-to-team-page.title']()}>
      <div className={styles.root}>
        <Menu
          items={
            <WorkspaceSelector
              metas={workspaces}
              onSelect={setSelectedWorkspace}
            />
          }
          contentOptions={{
            style: {
              width: '410px',
            },
          }}
        >
          <MenuTrigger className={styles.menuTrigger} tooltip={menuTriggerText}>
            {menuTriggerText}
          </MenuTrigger>
        </Menu>
        <div className={styles.upgradeButton}>
          <Button
            variant="primary"
            size="extraLarge"
            onClick={onUpgradeButtonClick}
            disabled={!selectedWorkspace}
          >
            {t['com.affine.upgrade-to-team-page.upgrade-button']()}
          </Button>
        </div>
        <div className={styles.contentContainer}>
          <div>{t['com.affine.upgrade-to-team-page.benefit.title']()}</div>
          <ul>
            {benefitList.map((benefit, index) => (
              <li key={`${benefit}:${index}`} className={styles.liStyle}>
                <DoneIcon className={styles.doneIcon} />
                {t.t(benefit)}
              </li>
            ))}
          </ul>
          <div>
            {t['com.affine.upgrade-to-team-page.benefit.description']()}
          </div>
        </div>
      </div>
    </AuthPageContainer>
  );
};

const WorkspaceSelector = ({
  metas,
  onSelect,
}: {
  metas: WorkspaceMetadata[];
  onSelect: (meta: WorkspaceMetadata) => void;
}) => {
  const t = useI18n();

  // TODO(@JimmFly): filter out team workspaces and not owned by the user
  const cloudWorkspaces = useMemo(
    () =>
      metas.filter(
        ({ flavour }) => flavour === WorkspaceFlavour.AFFINE_CLOUD
      ) as WorkspaceMetadata[],
    [metas]
  );

  const handleSelect = useCallback(
    (workspace: WorkspaceMetadata) => {
      onSelect(workspace);
    },
    [onSelect]
  );
  const { openConfirmModal } = useConfirmModal();
  const onClickCreateWorkspace = useCallback(() => {
    openConfirmModal({
      title:
        t['com.affine.upgrade-to-team-page.create-and-upgrade-confirm.title'](),
      description: <CreateWorkspaceModalContent />,
      confirmText:
        t[
          'com.affine.upgrade-to-team-page.create-and-upgrade-confirm.confirm'
        ](),
      onConfirm: () => {
        //TODO(@JimmFly): create and upgrade workspace function
      },
      confirmButtonOptions: {
        variant: 'primary',
      },
    });
  }, [openConfirmModal, t]);

  return (
    <div>
      {cloudWorkspaces.length > 0 &&
        cloudWorkspaces.map(workspace => (
          <MenuItem
            className={styles.plainMenuItem}
            key={workspace.id}
            onClick={() => handleSelect(workspace)}
          >
            <PureWorkspaceCard
              className={styles.workspaceItem}
              workspaceMetadata={workspace}
              avatarSize={28}
            />
          </MenuItem>
        ))}
      {cloudWorkspaces.length > 0 && <Divider size="thinner" />}
      <MenuItem
        className={styles.createWorkspaceItem}
        prefix={<NewPageIcon className={styles.itemIcon} fontSize={28} />}
        onClick={onClickCreateWorkspace}
      >
        <div className={styles.itemContent}>
          {t[
            'com.affine.upgrade-to-team-page.workspace-selector.create-workspace'
          ]()}
        </div>
      </MenuItem>
    </div>
  );
};

const CreateWorkspaceModalContent = () => {
  const t = useI18n();
  return (
    <div className={styles.createConfirmContent}>
      <div>
        {t[
          'com.affine.upgrade-to-team-page.create-and-upgrade-confirm.description'
        ]()}
      </div>
      <Input
        placeholder={t[
          'com.affine.upgrade-to-team-page.create-and-upgrade-confirm.placeholder'
        ]()}
      />
    </div>
  );
};
