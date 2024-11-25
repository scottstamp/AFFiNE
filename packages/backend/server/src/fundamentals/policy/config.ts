export interface PolicyConfig {}

export type PolicyType = keyof PolicyConfig;

export type PolicyData<P extends PolicyType> = PolicyConfig[P];

export abstract class PolicyExecutor {
  getPriority = () => 0;
  abstract get policies(): PolicyType[]; // get policies that this service can evaluate
  abstract evaluate<P extends PolicyType>(
    policy: P,
    data: PolicyData<P>
  ): Promise<boolean>; // evaluate the policy
}
