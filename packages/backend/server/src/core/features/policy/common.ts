import { registerEnumType } from '@nestjs/graphql';
import z, { type ZodType } from 'zod';

export enum FeatureType {
  // user feature
  Admin = 'administrator',
  EarlyAccess = 'early_access',
  AIEarlyAccess = 'ai_early_access',
  UnlimitedCopilot = 'unlimited_copilot',
  // workspace feature
  Copilot = 'copilot',
  UnlimitedWorkspace = 'unlimited_workspace',
}

registerEnumType(FeatureType, {
  name: 'FeatureType',
  description: 'The type of workspace feature',
});

export type PolicyConfigInfer<T extends ZodType<any, any, any>> =
  z.infer<T>['configs'];
