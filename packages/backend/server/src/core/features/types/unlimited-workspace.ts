import { z } from 'zod';

import { FeatureType, PolicyConfigInfer } from './common';

export const featureUnlimitedWorkspace = z.object({
  feature: z.literal(FeatureType.UnlimitedWorkspace),
  configs: z.object({}),
});

declare module '../../../fundamentals/policy/config' {
  export interface PolicyConfig {
    [FeatureType.UnlimitedWorkspace]: PolicyConfigInfer<
      typeof featureUnlimitedWorkspace
    >;
  }
}
