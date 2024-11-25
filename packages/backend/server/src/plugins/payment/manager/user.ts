import { Injectable } from '@nestjs/common';
import { PrismaClient, UserStripeCustomer } from '@prisma/client';
import { omit, pick } from 'lodash-es';
import Stripe from 'stripe';

import {
  EarlyAccessType,
  FeatureManagementService,
} from '../../../core/features';
import {
  Config,
  EventEmitter,
  InternalServerError,
} from '../../../fundamentals';
import {
  CouponType,
  KnownStripeInvoice,
  KnownStripePrice,
  KnownStripeSubscription,
  retriveLookupKeyFromStripeSubscription,
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionStatus,
  SubscriptionVariant,
} from '../types';
import { Subscription, SubscriptionManager } from './common';

interface PriceStrategyStatus {
  proEarlyAccess: boolean;
  aiEarlyAccess: boolean;
  proSubscribed: boolean;
  aiSubscribed: boolean;
  onetime: boolean;
}

@Injectable()
export class UserSubscriptionManager extends SubscriptionManager {
  constructor(
    stripe: Stripe,
    private readonly db: PrismaClient,
    private readonly config: Config,
    private readonly feature: FeatureManagementService,
    private readonly event: EventEmitter
  ) {
    super(stripe);
  }

  async filterPrices(
    prices: KnownStripePrice[],
    customer?: UserStripeCustomer
  ) {
    const strategyStatus = customer
      ? await this.strategyStatus(customer)
      : {
          proEarlyAccess: false,
          aiEarlyAccess: false,
          proSubscribed: false,
          aiSubscribed: false,
          onetime: false,
        };

    const availablePrices: KnownStripePrice[] = [];

    for (const price of prices) {
      if (await this.isPriceAvailable(price, strategyStatus)) {
        availablePrices.push(price);
      }
    }

    return availablePrices;
  }

  async getSubscription(userId: string, plan: SubscriptionPlan) {
    return this.db.userSubscription.findFirst({
      where: {
        userId,
        plan,
        status: {
          in: [SubscriptionStatus.Active, SubscriptionStatus.Trialing],
        },
      },
    });
  }

  async saveSubscription(subscription: KnownStripeSubscription) {
    const { userId, lookupKey, stripeSubscription } = subscription;
    // update features first, features modify are idempotent
    // so there is no need to skip if a subscription already exists.
    // TODO(@forehalo):
    //   we should move the subscription feature updating logic back to payment module,
    //   because quota or feature module themself should not be aware of what payment or subscription is.
    this.event.emit('user.subscription.activated', {
      userId,
      plan: lookupKey.plan,
      recurring: lookupKey.recurring,
    });

    const subscriptionData = this.transformSubscription(subscription);

    return await this.db.userSubscription.upsert({
      where: {
        stripeSubscriptionId: stripeSubscription.id,
      },
      update: pick(subscriptionData, [
        'status',
        'stripeScheduleId',
        'nextBillAt',
        'canceledAt',
      ]),
      create: {
        userId,
        ...subscriptionData,
      },
    });
  }

  async cancelSubscription(subscription: Subscription) {
    return this.db.userSubscription.update({
      where: {
        // @ts-expect-error checked outside
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
      data: {
        canceledAt: new Date(),
        nextBillAt: null,
      },
    });
  }

  async resumeSubscription(subscription: Subscription) {
    return this.db.userSubscription.update({
      where: {
        // @ts-expect-error checked outside
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
      data: {
        canceledAt: null,
        nextBillAt: subscription.end,
      },
    });
  }

  async updateSubscriptionRecurring(
    subscription: Subscription,
    recurring: SubscriptionRecurring
  ) {
    return this.db.userSubscription.update({
      where: {
        // @ts-expect-error checked outside
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
      data: { recurring },
    });
  }

  async deleteSubscription({
    userId,
    lookupKey,
    stripeSubscription,
  }: KnownStripeSubscription) {
    const deleted = await this.db.userSubscription.deleteMany({
      where: {
        stripeSubscriptionId: stripeSubscription.id,
      },
    });

    if (deleted.count > 0) {
      this.event.emit('user.subscription.canceled', {
        userId,
        plan: lookupKey.plan,
        recurring: lookupKey.recurring,
      });
    }
  }

  async finalizeCheckoutParams(
    customer: UserStripeCustomer,
    _userId: string,
    price: KnownStripePrice
  ) {
    const strategyStatus = await this.strategyStatus(customer);

    // onetime price is allowed for checkout
    strategyStatus.onetime = true;

    if (!(await this.isPriceAvailable(price, strategyStatus))) {
      return null;
    }

    let coupon: CouponType | undefined;

    if (price.lookupKey.variant === SubscriptionVariant.EA) {
      if (price.lookupKey.plan === SubscriptionPlan.Pro) {
        coupon = CouponType.ProEarlyAccessOneYearFree;
      } else if (price.lookupKey.plan === SubscriptionPlan.AI) {
        coupon = CouponType.AIEarlyAccessOneYearFree;
      }
    } else if (price.lookupKey.plan === SubscriptionPlan.AI) {
      const { proEarlyAccess, aiSubscribed } = strategyStatus;
      if (proEarlyAccess && !aiSubscribed) {
        coupon = CouponType.ProEarlyAccessAIOneYearFree;
      }
    }

    return {
      price: price.price.id,
      quantity: 1,
      coupon,
    };
  }

  async saveInvoice(knownInvoice: KnownStripeInvoice) {
    const { userId, lookupKey, stripeInvoice } = knownInvoice;

    const invoiceData = await this.transformInvoice(knownInvoice);

    const invoice = this.db.userInvoice.upsert({
      where: {
        stripeInvoiceId: stripeInvoice.id,
      },
      update: omit(invoiceData, 'stripeInvoiceId'),
      create: {
        userId,
        ...invoiceData,
      },
    });

    // onetime and lifetime subscription is a special "subscription" that doesn't get involved with stripe subscription system
    // we track the deals by invoice only.
    if (stripeInvoice.status === 'paid') {
      if (lookupKey.recurring === SubscriptionRecurring.Lifetime) {
        await this.saveLifetimeSubscription(knownInvoice);
      } else if (lookupKey.variant === SubscriptionVariant.Onetime) {
        await this.saveOnetimePaymentSubscription(knownInvoice);
      }
    }

    return invoice;
  }

  async saveLifetimeSubscription(
    knownInvoice: KnownStripeInvoice
  ): Promise<Subscription> {
    // cancel previous non-lifetime subscription
    const prevSubscription = await this.db.userSubscription.findUnique({
      where: {
        userId_plan: {
          userId: knownInvoice.userId,
          plan: SubscriptionPlan.Pro,
        },
      },
    });

    let subscription: Subscription;
    if (prevSubscription && prevSubscription.stripeSubscriptionId) {
      subscription = await this.db.userSubscription.update({
        where: {
          id: prevSubscription.id,
        },
        data: {
          stripeScheduleId: null,
          stripeSubscriptionId: null,
          plan: knownInvoice.lookupKey.plan,
          recurring: SubscriptionRecurring.Lifetime,
          start: new Date(),
          end: null,
          status: SubscriptionStatus.Active,
          nextBillAt: null,
        },
      });

      await this.stripe.subscriptions.cancel(
        prevSubscription.stripeSubscriptionId,
        {
          prorate: true,
        }
      );
    } else {
      subscription = await this.db.userSubscription.create({
        data: {
          userId: knownInvoice.userId,
          stripeSubscriptionId: null,
          plan: knownInvoice.lookupKey.plan,
          recurring: SubscriptionRecurring.Lifetime,
          start: new Date(),
          end: null,
          status: SubscriptionStatus.Active,
          nextBillAt: null,
        },
      });
    }

    this.event.emit('user.subscription.activated', {
      userId: knownInvoice.userId,
      plan: knownInvoice.lookupKey.plan,
      recurring: SubscriptionRecurring.Lifetime,
    });

    return subscription;
  }

  async saveOnetimePaymentSubscription(
    knownInvoice: KnownStripeInvoice
  ): Promise<Subscription> {
    const { userId, lookupKey } = knownInvoice;
    const existingSubscription = await this.db.userSubscription.findUnique({
      where: {
        userId_plan: {
          userId,
          plan: lookupKey.plan,
        },
      },
    });

    // TODO(@forehalo): time helper
    const subscriptionTime =
      (lookupKey.recurring === SubscriptionRecurring.Monthly ? 30 : 365) *
      24 *
      60 *
      60 *
      1000;

    let subscription: Subscription;

    // extends the subscription time if exists
    if (existingSubscription) {
      if (!existingSubscription.end) {
        throw new InternalServerError(
          'Unexpected onetime subscription with no end date'
        );
      }

      const period =
        // expired, reset the period
        existingSubscription.end <= new Date()
          ? {
              start: new Date(),
              end: new Date(Date.now() + subscriptionTime),
            }
          : {
              end: new Date(
                existingSubscription.end.getTime() + subscriptionTime
              ),
            };

      subscription = await this.db.userSubscription.update({
        where: {
          id: existingSubscription.id,
        },
        data: period,
      });
    } else {
      subscription = await this.db.userSubscription.create({
        data: {
          userId,
          stripeSubscriptionId: null,
          ...lookupKey,
          start: new Date(),
          end: new Date(Date.now() + subscriptionTime),
          status: SubscriptionStatus.Active,
          nextBillAt: null,
        },
      });
    }

    this.event.emit('user.subscription.activated', {
      userId,
      plan: lookupKey.plan,
      recurring: lookupKey.recurring,
    });

    return subscription;
  }

  private async isPriceAvailable(
    price: KnownStripePrice,
    strategy: PriceStrategyStatus
  ) {
    if (price.lookupKey.plan === SubscriptionPlan.Pro) {
      return this.isProPriceAvailable(price, strategy);
    }

    if (price.lookupKey.plan === SubscriptionPlan.AI) {
      return this.isAIPriceAvailable(price, strategy);
    }

    return false;
  }

  private async isProPriceAvailable(
    { lookupKey }: KnownStripePrice,
    { proEarlyAccess, proSubscribed, onetime }: PriceStrategyStatus
  ) {
    if (lookupKey.recurring === SubscriptionRecurring.Lifetime) {
      return this.config.runtime.fetch('plugins.payment/showLifetimePrice');
    }

    if (lookupKey.variant === SubscriptionVariant.Onetime) {
      return onetime;
    }

    // no special price for monthly plan
    if (lookupKey.recurring === SubscriptionRecurring.Monthly) {
      return true;
    }

    // show EA price instead of normal price if early access is available
    return proEarlyAccess && !proSubscribed
      ? lookupKey.variant === SubscriptionVariant.EA
      : lookupKey.variant !== SubscriptionVariant.EA;
  }

  private async isAIPriceAvailable(
    { lookupKey }: KnownStripePrice,
    { aiEarlyAccess, aiSubscribed, onetime }: PriceStrategyStatus
  ) {
    // no lifetime price for AI
    if (lookupKey.recurring === SubscriptionRecurring.Lifetime) {
      return false;
    }

    // never show onetime prices
    if (lookupKey.variant === SubscriptionVariant.Onetime) {
      return onetime;
    }

    // show EA price instead of normal price if early access is available
    return aiEarlyAccess && !aiSubscribed
      ? lookupKey.variant === SubscriptionVariant.EA
      : lookupKey.variant !== SubscriptionVariant.EA;
  }

  private async strategyStatus(
    customer: UserStripeCustomer
  ): Promise<PriceStrategyStatus> {
    const proEarlyAccess = await this.feature.isEarlyAccessUser(
      customer.userId,
      EarlyAccessType.App
    );

    const aiEarlyAccess = await this.feature.isEarlyAccessUser(
      customer.userId,
      EarlyAccessType.AI
    );

    // fast pass if the user is not early access for any plan
    if (!proEarlyAccess && !aiEarlyAccess) {
      return {
        proEarlyAccess,
        aiEarlyAccess,
        proSubscribed: false,
        aiSubscribed: false,
        onetime: false,
      };
    }

    let proSubscribed = false;
    let aiSubscribed = false;

    const subscriptions = await this.stripe.subscriptions.list({
      customer: customer.stripeCustomerId,
      status: 'all',
    });

    // if the early access user had early access subscription in the past, but it got canceled or past due,
    // the user will lose the early access privilege
    for (const sub of subscriptions.data) {
      const lookupKey = retriveLookupKeyFromStripeSubscription(sub);
      if (!lookupKey) {
        continue;
      }

      if (sub.status === 'past_due' || sub.status === 'canceled') {
        if (lookupKey.plan === SubscriptionPlan.Pro) {
          proSubscribed = true;
        }

        if (lookupKey.plan === SubscriptionPlan.AI) {
          aiSubscribed = true;
        }
      }
    }

    return {
      proEarlyAccess,
      aiEarlyAccess,
      proSubscribed,
      aiSubscribed,
      onetime: false,
    };
  }
}
