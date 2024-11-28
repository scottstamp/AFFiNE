import { Injectable } from '@nestjs/common';

import {
  FeatureConfigType,
  FeatureService,
  FeatureType,
} from '../../core/features';
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
  private readonly teamFeature: Promise<
    FeatureConfigType<FeatureType.TeamWorkspace> | undefined
  >;

  constructor(
    private readonly subscription: SubscriptionService,
    feature: FeatureService,
    quotaOverride: QuotaOverrideService
  ) {
    quotaOverride.registerOverride(this);
    this.teamFeature = feature.getFeature(FeatureType.TeamWorkspace);
  }

  get name() {
    return TeamQuotaOverride.name;
  }

  async overrideQuota(
    _ownerId: string,
    _workspaceId: string,
    features: FeatureType[],
    orig: QuotaBusinessType
  ): Promise<QuotaBusinessType> {
    const feature = await this.teamFeature;
    if (features.includes(FeatureType.TeamWorkspace) && feature) {
      const seatStorage = feature.config.configs.seatStorage;
      const blobLimit = 500 * OneMB;
      // TODO: get member limit from subscription
      const memberLimit = orig.memberCount;
      const storageQuota = 100 * OneGB + seatStorage * memberLimit;
      return {
        ...orig,
        storageQuota,
        blobLimit,
        businessBlobLimit: blobLimit,
        memberLimit,
        humanReadable: {
          ...orig.humanReadable,
          name: 'Team',
          blobLimit: formatSize(blobLimit),
          storageQuota: formatSize(storageQuota),
          memberLimit: memberLimit.toString(),
        },
      };
    }
    return orig;
  }
}
