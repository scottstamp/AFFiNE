import { z } from 'zod';

import { FeatureType, PolicyConfigInfer } from './common';

export const featureAdministrator = z.object({
  feature: z.literal(FeatureType.Admin),
  configs: z.object({}),
});

declare module '../../../fundamentals/policy/config' {
  export interface PolicyConfig {
    [FeatureType.Admin]: PolicyConfigInfer<typeof featureAdministrator>;
  }
}
