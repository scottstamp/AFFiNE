import { Global, Module } from '@nestjs/common';

import { Policy } from './policy';

@Global()
@Module({
  providers: [Policy],
  exports: [Policy],
})
export class PolicyModule {}

export { Policy };
export { type PolicyData, PolicyExecutor, type PolicyType } from './config';
