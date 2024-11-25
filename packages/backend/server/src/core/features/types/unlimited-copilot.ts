import { z } from 'zod';

import { FeatureType, WorkspaceFeatureCommonParams } from './common';

export const featureUnlimitedCopilot = z.object({
  feature: z.literal(FeatureType.UnlimitedCopilot),
  configs: z.object({}),
});

declare module '../../../fundamentals/policy/config' {
  export interface PolicyConfig {
    [FeatureType.UnlimitedCopilot]: WorkspaceFeatureCommonParams;
  }
}
