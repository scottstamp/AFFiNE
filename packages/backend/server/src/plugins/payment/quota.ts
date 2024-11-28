import { Injectable } from '@nestjs/common';

import { FeatureType } from '../../core/features';
import {
  formatSize,
  OneGB,
  OneMB,
  QuotaBusinessType,
  QuotaOverride,
  QuotaOverrideService,
} from '../../core/quota';
import { SubscriptionService } from './service';

@Injectable()
export class TeamQuotaOverride implements QuotaOverride {
  constructor(
    private readonly subscription: SubscriptionService,
    quotaOverride: QuotaOverrideService
  ) {
    quotaOverride.registerOverride(this);
  }

  overrideQuota(
    ownerId: string,
    workspaceId: string,
    features: FeatureType[],
    orig: QuotaBusinessType
  ): QuotaBusinessType {
    if (features.includes(FeatureType.TeamWorkspace)) {
      // TODO: override quota based on team subscription
      const storageQuota = 100 * OneGB;
      const blobLimit = 500 * OneMB;
      // need update blob/member/storage limit with subscription
      return {
        ...orig,
        storageQuota,
        blobLimit,
        businessBlobLimit: blobLimit,
        memberLimit: orig.memberCount,
        humanReadable: {
          ...orig.humanReadable,
          name: 'Team',
          blobLimit: formatSize(blobLimit),
          storageQuota: formatSize(storageQuota),
        },
      };
    }
    return orig;
  }
}
