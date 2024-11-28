import { z } from 'zod';

import { FeatureType } from './common';

export const featureTeamWorkspace = z.object({
  feature: z.literal(FeatureType.TeamWorkspace),
  configs: z.object({
    maxMembers: z.number().optional(),
    seatStorage: z.number(),
  }),
});
