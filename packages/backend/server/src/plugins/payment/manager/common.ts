import { UserStripeCustomer } from '@prisma/client';
import Stripe from 'stripe';

import {
  KnownStripeInvoice,
  KnownStripePrice,
  KnownStripeSubscription,
  SubscriptionPlan,
  SubscriptionRecurring,
} from '../types';

export interface Subscription {
  stripeSubscriptionId: string | null;
  stripeScheduleId: string | null;
  status: string;
  plan: string;
  recurring: string;
  variant: string | null;
  start: Date;
  end: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  nextBillAt: Date | null;
  canceledAt: Date | null;
}

export interface Invoice {
  stripeInvoiceId: string;
  currency: string;
  amount: number;
  status: string;
  reason: string | null;
  lastPaymentError: string | null;
  link: string | null;
}

export abstract class SubscriptionManager {
  constructor(protected readonly stripe: Stripe) {}

  abstract filterPrices(
    prices: KnownStripePrice[],
    customer?: UserStripeCustomer
  ): KnownStripePrice[] | Promise<KnownStripePrice[]>;

  abstract finalizeCheckoutParams(
    customer: UserStripeCustomer,
    targetId: string,
    price: KnownStripePrice
  ): Promise<{
    price: string;
    quantity: number;
    coupon?: string;
  } | null>;

  abstract saveSubscription(
    subscription: KnownStripeSubscription
  ): Promise<Subscription>;
  abstract deleteSubscription(
    subscription: KnownStripeSubscription
  ): Promise<void>;

  abstract getSubscription(
    targetId: string,
    plan: SubscriptionPlan
  ): Promise<Subscription | null>;

  abstract cancelSubscription(
    subscription: Subscription
  ): Promise<Subscription>;

  abstract resumeSubscription(
    subscription: Subscription
  ): Promise<Subscription>;

  abstract updateSubscriptionRecurring(
    subscription: Subscription,
    recurring: SubscriptionRecurring
  ): Promise<Subscription>;

  abstract saveInvoice(knownInvoice: KnownStripeInvoice): Promise<Invoice>;

  transformSubscription({
    lookupKey,
    stripeSubscription: subscription,
  }: KnownStripeSubscription): Subscription {
    return {
      ...lookupKey,
      stripeScheduleId: subscription.schedule as string | null,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      start: new Date(subscription.current_period_start * 1000),
      end: new Date(subscription.current_period_end * 1000),
      trialStart: subscription.trial_start
        ? new Date(subscription.trial_start * 1000)
        : null,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      nextBillAt: !subscription.canceled_at
        ? new Date(subscription.current_period_end * 1000)
        : null,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000)
        : null,
    };
  }

  async transformInvoice({
    stripeInvoice,
  }: KnownStripeInvoice): Promise<Invoice> {
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

    return {
      stripeInvoiceId: stripeInvoice.id,
      status,
      link: stripeInvoice.hosted_invoice_url || null,
      reason: stripeInvoice.billing_reason,
      amount: stripeInvoice.total,
      currency: stripeInvoice.currency,
      lastPaymentError: error,
    };
  }
}
