import { Controller, Logger } from '@nestjs/common';

import { Config } from '../../fundamentals';

@Controller('/api/worker')
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  constructor(private readonly config: Config) {}
}
