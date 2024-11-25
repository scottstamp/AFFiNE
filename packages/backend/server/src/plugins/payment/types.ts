import type { User } from '@prisma/client';
import Stripe from 'stripe';

import type { Payload } from '../../fundamentals/event/def';

export enum SubscriptionRecurring {
  Monthly = 'monthly',
  Yearly = 'yearly',
  Lifetime = 'lifetime',
}

export enum SubscriptionPlan {
  Free = 'free',
  Pro = 'pro',
  AI = 'ai',
  Team = 'team',
  Enterprise = 'enterprise',
  SelfHosted = 'selfhosted',
}

export enum SubscriptionVariant {
  EA = 'earlyaccess',
  Onetime = 'onetime',
}

// see https://stripe.com/docs/api/subscriptions/object#subscription_object-status
export enum SubscriptionStatus {
  Active = 'active',
  PastDue = 'past_due',
  Unpaid = 'unpaid',
  Canceled = 'canceled',
  Incomplete = 'incomplete',
  Paused = 'paused',
  IncompleteExpired = 'incomplete_expired',
  Trialing = 'trialing',
}

export enum InvoiceStatus {
  Draft = 'draft',
  Open = 'open',
  Void = 'void',
  Paid = 'paid',
  Uncollectible = 'uncollectible',
}

export enum CouponType {
  ProEarlyAccessOneYearFree = 'pro_ea_one_year_free',
  AIEarlyAccessOneYearFree = 'ai_ea_one_year_free',
  ProEarlyAccessAIOneYearFree = 'ai_pro_ea_one_year_free',
}

declare module '../../fundamentals/event/def' {
  interface UserEvents {
    subscription: {
      activated: Payload<{
        userId: User['id'];
        plan: SubscriptionPlan;
        recurring: SubscriptionRecurring;
      }>;
      canceled: Payload<{
        userId: User['id'];
        plan: SubscriptionPlan;
        recurring: SubscriptionRecurring;
      }>;
    };
  }
}

export interface LookupKey {
  plan: SubscriptionPlan;
  recurring: SubscriptionRecurring;
  variant?: SubscriptionVariant;
}

export interface KnownStripeInvoice {
  /**
   * User in AFFiNE system.
   */
  userId: string;

  /**
   * The lookup key of the price that the invoice is for.
   */
  lookupKey: LookupKey;

  /**
   * The invoice object from Stripe.
   */
  stripeInvoice: Stripe.Invoice;
}

export interface KnownStripeSubscription {
  /**
   * User in AFFiNE system.
   */
  userId: string;

  /**
   * The lookup key of the price that the invoice is for.
   */
  lookupKey: LookupKey;

  /**
   * The subscription object from Stripe.
   */
  stripeSubscription: Stripe.Subscription;
}

export interface KnownStripePrice {
  /**
   * The lookup key of the price.
   */
  lookupKey: LookupKey;

  /**
   * The price object from Stripe.
   */
  price: Stripe.Price;
}

const VALID_LOOKUP_KEYS = new Set([
  // pro
  `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Monthly}`,
  `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Yearly}`,
  // only EA for yearly pro
  `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.EA}`,
  `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Lifetime}`,
  `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Monthly}_${SubscriptionVariant.Onetime}`,
  `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.Onetime}`,

  // ai
  `${SubscriptionPlan.AI}_${SubscriptionRecurring.Yearly}`,
  // only EA for yearly AI
  `${SubscriptionPlan.AI}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.EA}`,
  `${SubscriptionPlan.AI}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.Onetime}`,

  // team
  `${SubscriptionPlan.Team}_${SubscriptionRecurring.Monthly}`,
  `${SubscriptionPlan.Team}_${SubscriptionRecurring.Yearly}`,
]);

// [Plan x Recurring x Variant] make a stripe price lookup key
export function encodeLookupKey({
  plan,
  recurring,
  variant,
}: LookupKey): string {
  const key = `${plan}_${recurring}` + (variant ? `_${variant}` : '');

  if (!VALID_LOOKUP_KEYS.has(key)) {
    throw new Error(`Invalid price: ${key}`);
  }

  return key;
}

export function decodeLookupKey(key: string): LookupKey | null {
  // NOTE(@forehalo):
  //   we have some legacy prices in stripe still in used,
  //   so we give it `pro_monthly_xxx` variant to make it invisible but valid,
  //   and those variant won't be listed in [SubscriptionVariant]
  // if (!VALID_LOOKUP_KEYS.has(key)) {
  //   return null;
  // }
  const [plan, recurring, variant] = key.split('_');

  return {
    plan: plan as SubscriptionPlan,
    recurring: recurring as SubscriptionRecurring,
    variant: variant as SubscriptionVariant | undefined,
  };
}

export function retriveLookupKeyFromStripePrice(price: Stripe.Price) {
  return price.lookup_key ? decodeLookupKey(price.lookup_key) : null;
}

export function retriveLookupKeyFromStripeSubscription(
  subscription: Stripe.Subscription
) {
  const price = subscription.items.data[0]?.price;

  // there should be and only one item in the subscription
  if (!price) {
    return null;
  }

  return retriveLookupKeyFromStripePrice(price);
}
