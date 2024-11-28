import './config';

import { ServerFeature } from '../../core/config';
import { FeatureModule } from '../../core/features';
import { QuotaModule } from '../../core/quota';
import { Plugin } from '../registry';
import { TeamQuotaOverride } from './quota';
import { SubscriptionResolver, UserSubscriptionResolver } from './resolver';
import { ScheduleManager } from './schedule';
import { SubscriptionService } from './service';
import { StripeProvider } from './stripe';
import { StripeWebhook } from './webhook';

@Plugin({
  name: 'payment',
  imports: [FeatureModule, QuotaModule],
  providers: [
    ScheduleManager,
    StripeProvider,
    SubscriptionService,
    SubscriptionResolver,
    UserSubscriptionResolver,
    TeamQuotaOverride,
  ],
  controllers: [StripeWebhook],
  requires: [
    'plugins.payment.stripe.keys.APIKey',
    'plugins.payment.stripe.keys.webhookKey',
  ],
  contributesTo: ServerFeature.Payment,
  if: config => config.flavor.graphql,
})
export class PaymentModule {}
