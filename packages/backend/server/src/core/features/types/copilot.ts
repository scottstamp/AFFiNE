import { z } from 'zod';

import { FeatureType, UserFeatureCommonParams } from './common';

export const featureCopilot = z.object({
  feature: z.literal(FeatureType.Copilot),
  configs: z.object({}),
});

declare module '../../../fundamentals/policy/config' {
  export interface PolicyConfig {
    [FeatureType.Copilot]: UserFeatureCommonParams;
  }
}
