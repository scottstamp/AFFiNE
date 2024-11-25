import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import {
  PolicyData,
  PolicyExecutor,
  PolicyType,
  registerExecutor,
} from '../../fundamentals';
import { Feature, FeatureKind, FeatureSchema, FeatureType } from './types';

@Injectable()
export class FeatureExecutor extends PolicyExecutor implements OnModuleInit {
  private readonly logger = new Logger(FeatureExecutor.name);
  private readonly features: Map<PolicyType, Feature> = new Map();
  private readonly featureMap: Map<number, Feature> = new Map();

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async onModuleInit() {
    await this.loadFeatures();
    registerExecutor(this);
  }

  private loadFeature(feature: any, featureId: number) {
    const config = FeatureSchema.safeParse(feature);

    if (config.success) {
      this.featureMap.set(featureId, config.data);
      const exists = this.features.get(config.data.feature);
      if (exists && exists.version >= config.data.version) return;
      this.features.set(config.data.feature, config.data);
    } else {
      throw new Error(`Invalid feature config: ${config.error.message}`);
    }
  }

  private async loadFeatures() {
    const features = await this.prisma.feature.findMany({
      where: { type: FeatureKind.Feature },
    });
    for (const feature of features) {
      try {
        this.loadFeature(feature, feature.id);
      } catch (e: any) {
        this.logger.error(
          `Failed to load feature ${feature.id}: ${e.message || e}`
        );
      }
    }
  }

  getFeature(featureId: number): Readonly<{ name: FeatureType }> | undefined {
    const feature = this.featureMap.get(featureId);
    if (feature) {
      return Object.freeze({ name: feature.feature });
    }
    return undefined;
  }

  get policies(): PolicyType[] {
    return Array.from(this.features.keys());
  }

  async evaluate<P extends PolicyType>(policy: P, data: PolicyData<P>) {
    const feature = this.features.get(policy);
    if (!feature) return true;

    const condition = {
      activated: true,
      feature: { feature: feature.feature, type: FeatureKind.Feature },
    };
    if ('userId' in data) {
      const features = await this.prisma.userFeature.count({
        where: {
          userId: data.userId,
          OR: [{ expiredAt: null }, { expiredAt: { gt: new Date() } }],
          ...condition,
        },
      });
      return features > 0;
    } else {
      const features = await this.prisma.workspaceFeature.count({
        where: {
          workspaceId: data.workspaceId,
          ...condition,
        },
      });
      return features > 0;
    }
  }
}
