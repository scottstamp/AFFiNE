/// <reference types="../src/global.d.ts" />

import { TestingModule } from '@nestjs/testing';
import type { TestFn } from 'ava';
import ava from 'ava';

import { AuthService } from '../src/core/auth';
import {
  FeatureModule,
  FeatureService,
  FeatureType,
} from '../src/core/features';
import {
  QuotaBusinessType,
  QuotaManagementService,
  QuotaModule,
  QuotaOverride,
  QuotaOverrideService,
  QuotaService,
  QuotaType,
} from '../src/core/quota';
import { FreePlan, ProPlan } from '../src/core/quota/schema';
import { StorageModule } from '../src/core/storage';
import { WorkspaceResolver } from '../src/core/workspaces/resolvers';
import { createTestingModule } from './utils';
import { WorkspaceResolverMock } from './utils/feature';

const test = ava as TestFn<{
  auth: AuthService;
  feature: FeatureService;
  quota: QuotaService;
  quotaOverride: QuotaOverrideService;
  quotaManager: QuotaManagementService;
  workspace: WorkspaceResolver;
  module: TestingModule;
}>;

test.beforeEach(async t => {
  const module = await createTestingModule({
    imports: [StorageModule, FeatureModule, QuotaModule],
    providers: [WorkspaceResolver],
    tapModule: module => {
      module
        .overrideProvider(WorkspaceResolver)
        .useClass(WorkspaceResolverMock);
    },
  });

  const feature = module.get(FeatureService);
  const quota = module.get(QuotaService);
  const quotaOverride = module.get(QuotaOverrideService);
  const quotaManager = module.get(QuotaManagementService);
  const workspace = module.get(WorkspaceResolver);
  const auth = module.get(AuthService);

  t.context.module = module;
  t.context.feature = feature;
  t.context.quota = quota;
  t.context.quotaOverride = quotaOverride;
  t.context.quotaManager = quotaManager;
  t.context.workspace = workspace;
  t.context.auth = auth;
});

test.afterEach.always(async t => {
  await t.context.module.close();
});

test('should be able to set quota', async t => {
  const { auth, quota } = t.context;

  const u1 = await auth.signUp('test@affine.pro', '123456');

  const q1 = await quota.getUserQuota(u1.id);
  t.truthy(q1, 'should have quota');
  t.is(q1?.feature.name, QuotaType.FreePlanV1, 'should be free plan');
  t.is(q1?.feature.version, 4, 'should be version 4');

  await quota.switchUserQuota(u1.id, QuotaType.ProPlanV1);

  const q2 = await quota.getUserQuota(u1.id);
  t.is(q2?.feature.name, QuotaType.ProPlanV1, 'should be pro plan');

  const fail = quota.switchUserQuota(u1.id, 'not_exists_plan_v1' as QuotaType);
  await t.throwsAsync(fail, { instanceOf: Error }, 'should throw error');
});

test('should be able to check storage quota', async t => {
  const { auth, quota, quotaManager } = t.context;
  const u1 = await auth.signUp('test@affine.pro', '123456');
  const freePlan = FreePlan.configs;
  const proPlan = ProPlan.configs;

  const q1 = await quotaManager.getUserQuota(u1.id);
  t.is(q1?.blobLimit, freePlan.blobLimit, 'should be free plan');
  t.is(q1?.storageQuota, freePlan.storageQuota, 'should be free plan');

  await quota.switchUserQuota(u1.id, QuotaType.ProPlanV1);
  const q2 = await quotaManager.getUserQuota(u1.id);
  t.is(q2?.blobLimit, proPlan.blobLimit, 'should be pro plan');
  t.is(q2?.storageQuota, proPlan.storageQuota, 'should be pro plan');
});

test('should be able revert quota', async t => {
  const { auth, quota, quotaManager } = t.context;
  const u1 = await auth.signUp('test@affine.pro', '123456');
  const freePlan = FreePlan.configs;
  const proPlan = ProPlan.configs;

  const q1 = await quotaManager.getUserQuota(u1.id);

  t.is(q1?.blobLimit, freePlan.blobLimit, 'should be free plan');
  t.is(q1?.storageQuota, freePlan.storageQuota, 'should be free plan');

  await quota.switchUserQuota(u1.id, QuotaType.ProPlanV1);
  const q2 = await quotaManager.getUserQuota(u1.id);
  t.is(q2?.blobLimit, proPlan.blobLimit, 'should be pro plan');
  t.is(q2?.storageQuota, proPlan.storageQuota, 'should be pro plan');
  t.is(
    q2?.copilotActionLimit,
    proPlan.copilotActionLimit!,
    'should be pro plan'
  );

  await quota.switchUserQuota(u1.id, QuotaType.FreePlanV1);
  const q3 = await quotaManager.getUserQuota(u1.id);
  t.is(q3?.blobLimit, freePlan.blobLimit, 'should be free plan');

  const quotas = await quota.getUserQuotas(u1.id);
  t.is(quotas.length, 3, 'should have 3 quotas');
  t.is(quotas[0].feature.name, QuotaType.FreePlanV1, 'should be free plan');
  t.is(quotas[1].feature.name, QuotaType.ProPlanV1, 'should be pro plan');
  t.is(quotas[2].feature.name, QuotaType.FreePlanV1, 'should be free plan');
  t.is(quotas[0].activated, false, 'should be activated');
  t.is(quotas[1].activated, false, 'should be activated');
  t.is(quotas[2].activated, true, 'should be activated');
});

test('should be able to check quota', async t => {
  const { auth, quotaManager } = t.context;
  const u1 = await auth.signUp('test@affine.pro', '123456');
  const freePlan = FreePlan.configs;

  const q1 = await quotaManager.getUserQuota(u1.id);
  t.assert(q1, 'should have quota');
  t.is(q1.blobLimit, freePlan.blobLimit, 'should be free plan');
  t.is(q1.storageQuota, freePlan.storageQuota, 'should be free plan');
  t.is(q1.historyPeriod, freePlan.historyPeriod, 'should be free plan');
  t.is(q1.memberLimit, freePlan.memberLimit, 'should be free plan');
  t.is(
    q1.copilotActionLimit!,
    freePlan.copilotActionLimit!,
    'should be free plan'
  );
});

test('should be able to override quota', async t => {
  class TestQuotaOverride implements QuotaOverride {
    get name(): string {
      return TestQuotaOverride.name;
    }
    async overrideQuota(
      _: string,
      __: string,
      features: FeatureType[],
      quota: QuotaBusinessType
    ): Promise<QuotaBusinessType> {
      if (features.includes(FeatureType.TeamWorkspace)) {
        return {
          ...quota,
          blobLimit: 1024,
          businessBlobLimit: 1024,
          memberLimit: 1,
        };
      }
      return quota;
    }
  }
  const { auth, feature, quotaOverride, quotaManager, workspace } = t.context;
  quotaOverride.registerOverride(new TestQuotaOverride());

  const u1 = await auth.signUp('test@affine.pro', '123456');
  const w1 = await workspace.createWorkspace(u1, null);

  const wq1 = await quotaManager.getWorkspaceUsage(w1.id);
  t.is(wq1.blobLimit, 1024 * 1024 * 10, 'should be 10MB');
  t.is(wq1.businessBlobLimit, 1024 * 1024 * 100, 'should be 100MB');
  t.is(wq1.memberLimit, 3, 'should be 3');

  await feature.addWorkspaceFeature(w1.id, FeatureType.TeamWorkspace, 'test');
  const wq2 = await quotaManager.getWorkspaceUsage(w1.id);
  console.log(wq2);
  t.is(wq2.blobLimit, 1024, 'should be override to 1KB');
  t.is(wq2.businessBlobLimit, 1024, 'should be override to 1KB');
  t.is(wq2.memberLimit, 1, 'should be override to 1');
});
