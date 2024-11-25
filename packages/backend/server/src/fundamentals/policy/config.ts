export interface PolicyConfig {
  earlyAccess: 'earlyAccess';
  blobStorage: 'blobStorage';
  // ...
}

export type PolicyType = keyof PolicyConfig;

export type PolicyData = Record<string, any>;

export abstract class PolicyExecutor {
  getPriority = () => 0;
  abstract getPolicies(): PolicyType[]; // get policies that this service can evaluate
  abstract evaluate(policy: PolicyType, data: PolicyData): boolean; // evaluate the policy
}
