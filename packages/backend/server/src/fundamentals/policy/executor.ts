import { PolicyExecutor, PolicyType } from './config';

type PoliciesMap = Record<PolicyType, PolicyExecutor[]>;

const PoliciesMap: PoliciesMap = {} as PoliciesMap;

export function registerExecutor(executor: PolicyExecutor) {
  const policies = executor.policies;
  for (const p of policies) {
    const policies = (PoliciesMap[p] = PoliciesMap[p] || []);
    if (!policies.includes(executor)) {
      policies.push(executor);
      // sort by priority from height to low
      policies.sort((a, b) => b.getPriority() - a.getPriority());
    }
  }
}

export function getExecutors(policy: PolicyType): readonly PolicyExecutor[] {
  return Object.freeze([...PoliciesMap[policy]]);
}
