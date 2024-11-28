import { Injectable } from '@nestjs/common';

import type { QuotaBusinessType } from './types';

export abstract class QuotaOverride {
  abstract get name(): string;
  abstract overrideQuota(
    ownerId: string,
    workspaceId: string,
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
    quota: QuotaBusinessType
  ): QuotaBusinessType {
    return this.overrides.reduce(
      (acc, override) => override.overrideQuota(ownerId, workspaceId, acc),
      quota
    );
  }
}
