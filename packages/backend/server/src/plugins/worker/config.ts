import { defineStartupConfig, ModuleConfig } from '../../fundamentals/config';

export interface WorkerStartupConfigurations {}

declare module '../config' {
  interface PluginsConfig {
    worker: ModuleConfig<WorkerStartupConfigurations>;
  }
}

defineStartupConfig('plugins.worker', {});
