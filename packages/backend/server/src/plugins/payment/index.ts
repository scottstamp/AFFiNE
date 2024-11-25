import './config';

import { ServerFeature } from '../../core/config';
import { FeatureModule } from '../../core/features';
import { UserModule } from '../../core/user';
import { Plugin } from '../registry';
import { StripeWebhookController } from './controller';
import { SubscriptionCronJobs } from './cron';
import {
  UserSubscriptionManager,
  WorkspaceSubscriptionManager,
} from './manager';
import {
  SubscriptionResolver,
  UserSubscriptionResolver,
  WorkspaceSubscriptionResolver,
} from './resolver';
import { SubscriptionService } from './service';
import { StripeProvider } from './stripe';
import { StripeWebhook } from './webhook';

@Plugin({
  name: 'payment',
  imports: [FeatureModule, UserModule],
  providers: [
    StripeProvider,
    SubscriptionService,
    SubscriptionResolver,
    UserSubscriptionResolver,
    StripeWebhook,
    UserSubscriptionManager,
    WorkspaceSubscriptionManager,
    SubscriptionCronJobs,
    WorkspaceSubscriptionResolver,
  ],
  controllers: [StripeWebhookController],
  requires: [
    'plugins.payment.stripe.keys.APIKey',
    'plugins.payment.stripe.keys.webhookKey',
  ],
  contributesTo: ServerFeature.Payment,
  if: config => config.flavor.graphql,
})
export class PaymentModule {}
