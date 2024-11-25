import { Injectable } from '@nestjs/common';

import type { PolicyData, PolicyExecutor, PolicyType } from './config';
import { getExecutors, registerExecutor } from './executor';

@Injectable()
export class Policy {
  register(executor: PolicyExecutor) {
    registerExecutor(executor);
  }

  /**
   *
   * @param policy policy enum
   * @param data the data to evaluate
   * @returns return directly if success, throw new Error if failed
   */
  evaluate<P extends PolicyType>(policy: P, data: PolicyData<P>) {
    const policies = getExecutors(policy);
    if (policies.length > 0) {
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
