import { ConfirmModal } from '@affine/component/ui/modal';
import { openQuotaModalAtom } from '@affine/core/components/atoms';
import { UserQuotaService } from '@affine/core/modules/cloud';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { WorkspaceQuotaService } from '@affine/core/modules/quota';
import { type I18nString, useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import { useLiveData, useService, WorkspaceService } from '@toeverything/infra';
import bytes from 'bytes';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo } from 'react';

import * as styles from './cloud-quota-modal.css';

export const CloudQuotaModal = () => {
  const t = useI18n();
  const currentWorkspace = useService(WorkspaceService).workspace;
  const [open, setOpen] = useAtom(openQuotaModalAtom);
  const workspaceQuotaService = useService(WorkspaceQuotaService);
  useEffect(() => {
    workspaceQuotaService.quota.revalidate();
  }, [workspaceQuotaService]);
  const workspaceQuota = useLiveData(workspaceQuotaService.quota.quota$);
  const permissionService = useService(WorkspacePermissionService);
  const isOwner = useLiveData(permissionService.permission.isOwner$);
  useEffect(() => {
    // revalidate permission
    permissionService.permission.revalidate();
  }, [permissionService]);

  const quotaService = useService(UserQuotaService);
  const userQuota = useLiveData(
    quotaService.quota.quota$.map(q =>
      q
        ? {
            name: q.humanReadable.name,
            blobLimit: q.humanReadable.blobLimit,
          }
        : null
    )
  );

  const globalDialogService = useService(GlobalDialogService);
  const handleUpgradeConfirm = useCallback(() => {
    globalDialogService.open('setting', {
      activeTab: 'plans',
      scrollAnchor: 'cloudPricingPlan',
    });

    track.$.paywall.storage.viewPlans();
    setOpen(false);
  }, [globalDialogService, setOpen]);

  const description = useMemo(() => {
    if (userQuota && isOwner) {
      return <OwnerDescription quota={userQuota.blobLimit} />;
    }
    if (workspaceQuota) {
      return t['com.affine.payment.blob-limit.description.member']({
        quota: workspaceQuota.humanReadable.blobLimit,
      });
    } else {
      // loading
      return null;
    }
  }, [userQuota, isOwner, workspaceQuota, t]);

  useEffect(() => {
    if (!workspaceQuota) {
      return;
    }
    currentWorkspace.engine.blob.singleBlobSizeLimit = bytes.parse(
      workspaceQuota.blobLimit.toString()
    );

    const disposable = currentWorkspace.engine.blob.onAbortLargeBlob.on(() => {
      setOpen(true);
    });
    return () => {
      disposable?.dispose();
    };
  }, [currentWorkspace.engine.blob, setOpen, workspaceQuota]);

  return (
    <ConfirmModal
      open={open}
      title={t['com.affine.payment.blob-limit.title']()}
      onOpenChange={setOpen}
      description={description}
      onConfirm={handleUpgradeConfirm}
      confirmText={t['com.affine.payment.upgrade']()}
      confirmButtonOptions={{
        variant: 'primary',
      }}
    />
  );
};

const tips: I18nString[] = [
  'com.affine.payment.blob-limit.description.owner.tips-1',
  'com.affine.payment.blob-limit.description.owner.tips-2',
  'com.affine.payment.blob-limit.description.owner.tips-3',
];

const OwnerDescription = ({ quota }: { quota: string }) => {
  const t = useI18n();
  return (
    <div>
      {t['com.affine.payment.blob-limit.description.owner']({
        quota: quota,
      })}
      <ul className={styles.ulStyle}>
        {tips.map((tip, index) => (
          <li className={styles.liStyle} key={index}>
            <div className={styles.prefixDot} />
            {t.t(tip)}
          </li>
        ))}
      </ul>
    </div>
  );
};
