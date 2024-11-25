import { Injectable } from '@nestjs/common';

import type { PolicyData, PolicyExecutor, PolicyType } from './config';

type PolicyMap = Record<PolicyType, PolicyExecutor[]>;

@Injectable()
export class Policy {
  private readonly policyMap: PolicyMap = {} as PolicyMap;

  constructor() {}

  registerExecutor(executor: PolicyExecutor) {
    const policies = executor.getPolicies();
    for (const p of policies) {
      this.policyMap[p] = this.policyMap[p] || [];
      this.policyMap[p].push(executor);
      // sort by priority from height to low
      this.policyMap[p].sort((a, b) => b.getPriority() - a.getPriority());
    }
  }

  /**
   *
   * @param policy policy enum
   * @param data the data to evaluate
   * @returns return directly if success, throw new Error if failed
   */
  evaluate(policy: PolicyType, data: PolicyData) {
    const policies = this.policyMap[policy];
    // skip if no policy
    if (Array.isArray(policies)) {
      for (const p of policies) {
        if (p.evaluate(policy, data)) {
          // return if pass one policy
          return;
        }
      }
      throw new Error('Policy not pass');
    }
  }
}
