import { z } from 'zod';

import { FeatureType, WorkspaceFeatureCommonParams } from './common';

export const featureUnlimitedWorkspace = z.object({
  feature: z.literal(FeatureType.UnlimitedWorkspace),
  configs: z.object({}),
});

declare module '../../../fundamentals/policy/config' {
  export interface PolicyConfig {
    [FeatureType.UnlimitedWorkspace]: WorkspaceFeatureCommonParams;
  }
}
