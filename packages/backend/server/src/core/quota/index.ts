import { Module } from '@nestjs/common';

import { FeatureModule } from '../features';
import { PermissionModule } from '../permission';
import { StorageModule } from '../storage';
import { QuotaOverrideService } from './override';
import { QuotaManagementResolver } from './resolver';
import { QuotaService } from './service';
import { QuotaManagementService } from './storage';

/**
 * Quota module provider pre-user quota management.
 * includes:
 * - quota query/update/permit
 * - quota statistics
 */
@Module({
  imports: [FeatureModule, StorageModule, PermissionModule],
  providers: [
    QuotaService,
    QuotaOverrideService,
    QuotaManagementResolver,
    QuotaManagementService,
  ],
  exports: [QuotaService, QuotaManagementService],
})
export class QuotaModule {}

export { QuotaManagementService, QuotaService };
export { QuotaOverride } from './override';
export { Quota_FreePlanV1_1, Quota_ProPlanV1 } from './schema';
export { type QuotaBusinessType, QuotaQueryType, QuotaType } from './types';
