import { Injectable } from '@nestjs/common';
import {
  PrismaClient,
  UserStripeCustomer,
  UserSubscription,
} from '@prisma/client';
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
import { SubscriptionManager } from './common';

interface PriceStrategyStatus {
  proEarlyAccess: boolean;
  aiEarlyAccess: boolean;
  proSubscribed: boolean;
  aiSubscribed: boolean;
  onetime: boolean;
}

@Injectable()
export class UserSubscriptionManager implements SubscriptionManager {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: Config,
    private readonly stripe: Stripe,
    private readonly feature: FeatureManagementService,
    private readonly event: EventEmitter
  ) {}

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

  async saveSubscription({
    userId,
    lookupKey,
    stripeSubscription: subscription,
  }: KnownStripeSubscription) {
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

    const commonData = {
      status: subscription.status,
      stripeScheduleId: subscription.schedule as string | null,
      nextBillAt: !subscription.canceled_at
        ? new Date(subscription.current_period_end * 1000)
        : null,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000)
        : null,
    };

    return await this.db.userSubscription.upsert({
      where: {
        stripeSubscriptionId: subscription.id,
      },
      update: commonData,
      create: {
        userId,
        ...lookupKey,
        stripeSubscriptionId: subscription.id,
        start: new Date(subscription.current_period_start * 1000),
        end: new Date(subscription.current_period_end * 1000),
        trialStart: subscription.trial_start
          ? new Date(subscription.trial_start * 1000)
          : null,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        ...commonData,
      },
    });
  }

  async cancelSubscription(subscription: UserSubscription) {
    return this.db.userSubscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        canceledAt: new Date(),
        nextBillAt: null,
      },
    });
  }

  async resumeSubscription(subscription: UserSubscription) {
    return this.db.userSubscription.update({
      where: { id: subscription.id },
      data: {
        canceledAt: null,
        nextBillAt: subscription.end,
      },
    });
  }

  async updateSubscriptionRecurring(
    subscription: UserSubscription,
    recurring: SubscriptionRecurring
  ) {
    return this.db.userSubscription.update({
      where: { id: subscription.id },
      data: { recurring },
    });
  }

  async deleteSubscription({
    userId,
    lookupKey,
    stripeSubscription,
  }: KnownStripeSubscription) {
    await this.db.userSubscription.delete({
      where: {
        stripeSubscriptionId: stripeSubscription.id,
      },
    });

    this.event.emit('user.subscription.canceled', {
      userId,
      plan: lookupKey.plan,
      recurring: lookupKey.recurring,
    });
  }

  async validatePrice(price: KnownStripePrice, customer: UserStripeCustomer) {
    const strategyStatus = await this.strategyStatus(customer);

    // onetime price is allowed for checkout
    strategyStatus.onetime = true;

    if (!(await this.isPriceAvailable(price, strategyStatus))) {
      return null;
    }

    let coupon: CouponType | null = null;

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
      price,
      coupon,
    };
  }

  async saveInvoice(knownInvoice: KnownStripeInvoice) {
    const { userId, lookupKey, stripeInvoice } = knownInvoice;

    const status = stripeInvoice.status ?? 'void';
    let error: string | boolean | null = null;

    if (status !== 'paid') {
      if (stripeInvoice.last_finalization_error) {
        error = stripeInvoice.last_finalization_error.message ?? true;
      } else if (
        stripeInvoice.attempt_count > 1 &&
        stripeInvoice.payment_intent
      ) {
        const paymentIntent =
          typeof stripeInvoice.payment_intent === 'string'
            ? await this.stripe.paymentIntents.retrieve(
                stripeInvoice.payment_intent
              )
            : stripeInvoice.payment_intent;

        if (paymentIntent.last_payment_error) {
          error = paymentIntent.last_payment_error.message ?? true;
        }
      }
    }

    // fallback to generic error message
    if (error === true) {
      error = 'Payment Error. Please contact support.';
    }

    const invoice = this.db.userInvoice.upsert({
      where: {
        stripeInvoiceId: stripeInvoice.id,
      },
      update: {
        status,
        link: stripeInvoice.hosted_invoice_url,
        amount: stripeInvoice.total,
        currency: stripeInvoice.currency,
        lastPaymentError: error,
      },
      create: {
        userId,
        stripeInvoiceId: stripeInvoice.id,
        status,
        link: stripeInvoice.hosted_invoice_url,
        reason: stripeInvoice.billing_reason,
        amount: stripeInvoice.total,
        currency: stripeInvoice.currency,
        lastPaymentError: error,
      },
    });

    // onetime and lifetime subscription is a special "subscription" that doesn't get involved with stripe subscription system
    // we track the deals by invoice only.
    if (status === 'paid') {
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
  ): Promise<UserSubscription> {
    // cancel previous non-lifetime subscription
    const prevSubscription = await this.db.userSubscription.findUnique({
      where: {
        userId_plan: {
          userId: knownInvoice.userId,
          plan: SubscriptionPlan.Pro,
        },
      },
    });

    let subscription: UserSubscription;
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
  ): Promise<UserSubscription> {
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

    let subscription: UserSubscription;

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
