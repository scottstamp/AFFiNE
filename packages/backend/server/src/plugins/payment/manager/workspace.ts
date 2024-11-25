import { Injectable } from '@nestjs/common';
import { PrismaClient, UserStripeCustomer } from '@prisma/client';
import { omit, pick } from 'lodash-es';
import Stripe from 'stripe';

import { EventEmitter } from '../../../fundamentals';
import {
  KnownStripeInvoice,
  KnownStripePrice,
  KnownStripeSubscription,
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionStatus,
} from '../types';
import { Invoice, Subscription, SubscriptionManager } from './common';

@Injectable()
export class WorkspaceSubscriptionManager extends SubscriptionManager {
  constructor(
    stripe: Stripe,
    private readonly db: PrismaClient,
    private readonly event: EventEmitter
  ) {
    super(stripe);
  }

  filterPrices(
    prices: KnownStripePrice[],
    _customer?: UserStripeCustomer
  ): KnownStripePrice[] {
    return prices.filter(
      price => price.lookupKey.plan === SubscriptionPlan.Team
    );
  }

  async finalizeCheckoutParams(
    _customer: UserStripeCustomer,
    workspaceId: string,
    price: KnownStripePrice
  ) {
    const count = await this.db.workspaceUserPermission.count({
      where: {
        workspaceId,
        // @TODO(darksky): replace with [status: WorkspaceUserPermissionStatus.Accepted]
        accepted: true,
      },
    });

    return {
      price: price.price.id,
      quantity: count,
    };
  }

  async saveSubscription(subscription: KnownStripeSubscription) {
    const { lookupKey, workspaceId, quantity, stripeSubscription } =
      subscription;

    if (!workspaceId) {
      throw new Error(
        'Workspace ID is required in workspace subscription metadata'
      );
    }

    this.event.emit('workspace.subscription.activated', {
      workspaceId,
      plan: lookupKey.plan,
      recurring: lookupKey.recurring,
      quantity,
    });

    const subscriptionData = this.transformSubscription(subscription);

    return this.db.workspaceSubscription.upsert({
      where: {
        stripeSubscriptionId: stripeSubscription.id,
      },
      update: {
        quantity,
        ...pick(subscriptionData, [
          'status',
          'stripeScheduleId',
          'nextBillAt',
          'canceledAt',
        ]),
      },
      create: {
        workspaceId,
        quantity,
        ...subscriptionData,
      },
    });
  }

  async deleteSubscription({
    lookupKey,
    workspaceId,
    stripeSubscription,
  }: KnownStripeSubscription) {
    if (!workspaceId) {
      throw new Error(
        'Workspace ID is required in workspace subscription metadata'
      );
    }

    const deleted = await this.db.workspaceSubscription.deleteMany({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });

    if (deleted.count > 0) {
      this.event.emit('workspace.subscription.canceled', {
        workspaceId,
        plan: lookupKey.plan,
        recurring: lookupKey.recurring,
      });
    }
  }

  getSubscription(workspaceId: string) {
    return this.db.workspaceSubscription.findFirst({
      where: {
        workspaceId,
        status: {
          in: [SubscriptionStatus.Active, SubscriptionStatus.Trialing],
        },
      },
    });
  }

  async cancelSubscription(subscription: Subscription) {
    return await this.db.workspaceSubscription.update({
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

  resumeSubscription(subscription: Subscription): Promise<Subscription> {
    return this.db.workspaceSubscription.update({
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

  updateSubscriptionRecurring(
    subscription: Subscription,
    recurring: SubscriptionRecurring
  ): Promise<Subscription> {
    return this.db.workspaceSubscription.update({
      where: {
        // @ts-expect-error checked outside
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
      data: { recurring },
    });
  }

  async saveInvoice(knownInvoice: KnownStripeInvoice): Promise<Invoice> {
    const { workspaceId, stripeInvoice } = knownInvoice;

    if (!workspaceId) {
      throw new Error('Workspace ID is required in workspace invoice metadata');
    }

    const invoiceData = await this.transformInvoice(knownInvoice);

    return this.db.workspaceInvoice.upsert({
      where: {
        stripeInvoiceId: stripeInvoice.id,
      },
      update: omit(invoiceData, 'stripeInvoiceId'),
      create: {
        workspaceId,
        ...invoiceData,
      },
    });
  }
}
