import { Injectable } from '@nestjs/common';

import { FeatureType } from '../features';
import type { QuotaBusinessType } from './types';

export abstract class QuotaOverride {
  abstract overrideQuota(
    ownerId: string,
    workspaceId: string,
    features: FeatureType[],
    quota: QuotaBusinessType
  ): QuotaBusinessType;
}

@Injectable()
export class QuotaOverrideService {
  private readonly overrides: QuotaOverride[] = [];

  registerOverride(override: QuotaOverride) {
    this.overrides.push(override);
  }

  overrideQuota(
    ownerId: string,
    workspaceId: string,
    features: FeatureType[],
    quota: QuotaBusinessType
  ): QuotaBusinessType {
    return this.overrides
      .filter(o => typeof o.overrideQuota === 'function')
      .reduce(
        (quota, override) =>
          override.overrideQuota(ownerId, workspaceId, features, quota),
        quota
      );
  }
}
