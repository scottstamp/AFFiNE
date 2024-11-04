import './config';

import { Plugin } from '../registry';
import { WorkerController } from './controller';

@Plugin({
  name: 'worker',
  imports: [],
  providers: [],
  controllers: [WorkerController],
  if: config => config.isSelfhosted,
})
export class CopilotModule {}
