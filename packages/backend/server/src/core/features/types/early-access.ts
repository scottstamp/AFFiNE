import { z } from 'zod';

import { FeatureType, UserFeatureCommonParams } from './common';

export const featureEarlyAccess = z.object({
  feature: z.literal(FeatureType.EarlyAccess),
  configs: z.object({
    // field polyfill, make it optional in the future
    whitelist: z.string().array(),
  }),
});

export const featureAIEarlyAccess = z.object({
  feature: z.literal(FeatureType.AIEarlyAccess),
  configs: z.object({}),
});

declare module '../../../fundamentals/policy/config' {
  export interface PolicyConfig {
    [FeatureType.EarlyAccess]: UserFeatureCommonParams;
    [FeatureType.AIEarlyAccess]: UserFeatureCommonParams;
  }
}
