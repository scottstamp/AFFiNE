import { PrismaClient } from '@prisma/client';

import { FeatureType } from '../../core/features';
import { upsertLatestFeatureVersion } from './utils/user-features';

export class TeamWorkspaceFeature1732786991577 {
  // do the migration
  static async up(db: PrismaClient) {
    await upsertLatestFeatureVersion(db, FeatureType.TeamWorkspace);
  }

  // revert the migration
  static async down(_db: PrismaClient) {}
}
