import { UserStripeCustomer } from '@prisma/client';

import {
  KnownStripePrice,
  KnownStripeSubscription,
  SubscriptionPlan,
  SubscriptionRecurring,
} from '../types';

export interface Subscription {
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
  currency: string;
  amount: number;
  status: string;
  createdAt: Date;
  lastPaymentError: string | null;
  link: string | null;
}

export interface SubscriptionManager {
  filterPrices(
    prices: KnownStripePrice[],
    customer?: UserStripeCustomer
  ): Promise<KnownStripePrice[]>;

  saveSubscription(
    subscription: KnownStripeSubscription
  ): Promise<Subscription>;
  deleteSubscription(subscription: KnownStripeSubscription): Promise<void>;

  getSubscription(
    id: string,
    plan: SubscriptionPlan
  ): Promise<Subscription | null>;

  cancelSubscription(subscription: Subscription): Promise<Subscription>;

  resumeSubscription(subscription: Subscription): Promise<Subscription>;

  updateSubscriptionRecurring(
    subscription: Subscription,
    recurring: SubscriptionRecurring
  ): Promise<Subscription>;
}
