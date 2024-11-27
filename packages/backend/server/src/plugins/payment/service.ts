import { Injectable, Logger } from '@nestjs/common';
import type { User, UserStripeCustomer } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

import { CurrentUser } from '../../core/auth';
import { FeatureManagementService } from '../../core/features';
import { UserService } from '../../core/user';
import {
  ActionForbidden,
  CantUpdateOnetimePaymentSubscription,
  Config,
  CustomerPortalCreateFailed,
  type EventPayload,
  InternalServerError,
  OnEvent,
  SameSubscriptionRecurring,
  SubscriptionAlreadyExists,
  SubscriptionExpired,
  SubscriptionHasBeenCanceled,
  SubscriptionHasNotBeenCanceled,
  SubscriptionNotExists,
  SubscriptionPlanNotFound,
  UserNotFound,
  WorkspaceIdRequiredForTeamSubscription,
} from '../../fundamentals';
import {
  Invoice,
  Subscription,
  SubscriptionManager,
  UserSubscriptionManager,
  WorkspaceSubscriptionManager,
} from './manager';
import { ScheduleManager } from './schedule';
import {
  encodeLookupKey,
  KnownStripeInvoice,
  KnownStripePrice,
  LookupKey,
  retriveLookupKeyFromStripePrice,
  retriveLookupKeyFromStripeSubscription,
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionStatus,
  SubscriptionVariant,
} from './types';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly scheduleManager = new ScheduleManager(this.stripe);

  constructor(
    private readonly config: Config,
    private readonly stripe: Stripe,
    private readonly db: PrismaClient,
    private readonly feature: FeatureManagementService,
    private readonly user: UserService,
    private readonly userManager: UserSubscriptionManager,
    private readonly workspaceManager: WorkspaceSubscriptionManager
  ) {}

  private select(plan: SubscriptionPlan): SubscriptionManager {
    return plan === SubscriptionPlan.Team
      ? this.workspaceManager
      : this.userManager;
  }

  async listPrices(
    user?: CurrentUser,
    workspaceId?: string
  ): Promise<KnownStripePrice[]> {
    const prices = await this.listStripePrices();

    const customer = user ? await this.getOrCreateCustomer(user) : undefined;

    if (workspaceId) {
      return this.workspaceManager.filterPrices(prices, customer);
    }

    return this.userManager.filterPrices(prices, customer);
  }

  async checkout({
    user,
    workspaceId,
    lookupKey,
    promotionCode,
    redirectUrl,
    idempotencyKey,
  }: {
    user: CurrentUser;
    lookupKey: LookupKey;
    redirectUrl: string;
    workspaceId?: string | null;
    promotionCode?: string | null;
    idempotencyKey?: string;
  }) {
    if (
      this.config.deploy &&
      this.config.affine.canary &&
      !this.feature.isStaff(user.email)
    ) {
      throw new ActionForbidden();
    }

    const manager = this.select(lookupKey.plan);
    const targetId =
      lookupKey.plan === SubscriptionPlan.Team ? workspaceId : user.id;

    if (!targetId) {
      throw new WorkspaceIdRequiredForTeamSubscription();
    }

    const currentSubscription = await manager.getSubscription(
      targetId,
      lookupKey.plan
    );

    if (
      currentSubscription &&
      // do not allow to re-subscribe unless
      !(
        /* current subscription is a onetime subscription and so as the one that's checking out */
        (
          (currentSubscription.variant === SubscriptionVariant.Onetime &&
            lookupKey.variant === SubscriptionVariant.Onetime) ||
          /* current subscription is normal subscription and is checking-out a lifetime subscription */
          (currentSubscription.recurring !== SubscriptionRecurring.Lifetime &&
            currentSubscription.variant !== SubscriptionVariant.Onetime &&
            lookupKey.recurring === SubscriptionRecurring.Lifetime)
        )
      )
    ) {
      throw new SubscriptionAlreadyExists({ plan: lookupKey.plan });
    }

    const price = await this.getPrice(lookupKey);
    const customer = await this.getOrCreateCustomer(user);

    const checkoutParams = price
      ? await manager.finalizeCheckoutParams(customer, targetId, price)
      : null;

    if (!checkoutParams) {
      throw new SubscriptionPlanNotFound({
        plan: lookupKey.plan,
        recurring: lookupKey.recurring,
      });
    }

    let discounts: Stripe.Checkout.SessionCreateParams['discounts'] = [];

    if (checkoutParams.coupon) {
      discounts = [{ coupon: checkoutParams.coupon }];
    } else if (promotionCode) {
      const coupon = await this.getCouponFromPromotionCode(
        promotionCode,
        customer
      );
      if (coupon) {
        discounts = [{ coupon }];
      }
    }

    return this.stripe.checkout.sessions.create(
      {
        line_items: [
          {
            price: checkoutParams.price,
            quantity: checkoutParams.quantity,
          },
        ],
        tax_id_collection: {
          enabled: true,
        },
        // discount
        ...(discounts.length ? { discounts } : { allow_promotion_codes: true }),
        // mode: 'subscription' or 'payment' for lifetime and onetime payment
        ...(lookupKey.recurring === SubscriptionRecurring.Lifetime ||
        lookupKey.variant === SubscriptionVariant.Onetime
          ? {
              mode: 'payment',
              invoice_creation: {
                enabled: true,
              },
            }
          : {
              mode: 'subscription',
            }),
        success_url: redirectUrl,
        customer: customer.stripeCustomerId,
        customer_update: {
          address: 'auto',
          name: 'auto',
        },
        subscription_data: {
          metadata:
            lookupKey.plan === SubscriptionPlan.Team
              ? { workspaceId: targetId }
              : { userId: targetId },
        },
      },
      { idempotencyKey }
    );
  }

  async cancelSubscription(
    targetId: string,
    plan: SubscriptionPlan,
    idempotencyKey?: string
  ): Promise<Subscription> {
    const manager = this.select(plan);
    const subscription = await manager.getSubscription(targetId, plan);

    if (!subscription) {
      throw new SubscriptionNotExists({ plan });
    }

    if (!subscription.stripeSubscriptionId) {
      throw new CantUpdateOnetimePaymentSubscription(
        'Onetime payment subscription cannot be canceled.'
      );
    }

    if (subscription.canceledAt) {
      throw new SubscriptionHasBeenCanceled();
    }

    // update the subscription in db optimistically
    const newSubscription = manager.cancelSubscription(subscription);

    // should release the schedule first
    if (subscription.stripeScheduleId) {
      const manager = await this.scheduleManager.fromSchedule(
        subscription.stripeScheduleId
      );
      await manager.cancel(idempotencyKey);
    } else {
      // let customer contact support if they want to cancel immediately
      // see https://stripe.com/docs/billing/subscriptions/cancel
      await this.stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey }
      );
    }

    return newSubscription;
  }

  async resumeSubscription(
    targetId: string,
    plan: SubscriptionPlan,
    idempotencyKey?: string
  ): Promise<Subscription> {
    const manager = this.select(plan);
    const subscription = await manager.getSubscription(targetId, plan);

    if (!subscription) {
      throw new SubscriptionNotExists({ plan });
    }

    if (!subscription.canceledAt) {
      throw new SubscriptionHasNotBeenCanceled();
    }

    if (!subscription.stripeSubscriptionId || !subscription.end) {
      throw new CantUpdateOnetimePaymentSubscription(
        'Onetime payment subscription cannot be resumed.'
      );
    }

    if (subscription.end < new Date()) {
      throw new SubscriptionExpired();
    }

    // update the subscription in db optimistically
    const newSubscription = await manager.resumeSubscription(subscription);

    if (subscription.stripeScheduleId) {
      const manager = await this.scheduleManager.fromSchedule(
        subscription.stripeScheduleId
      );
      await manager.resume(idempotencyKey);
    } else {
      await this.stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        { cancel_at_period_end: false },
        { idempotencyKey }
      );
    }

    return newSubscription;
  }

  async updateSubscriptionRecurring(
    targetId: string,
    plan: SubscriptionPlan,
    recurring: SubscriptionRecurring,
    idempotencyKey?: string
  ): Promise<Subscription> {
    const manager = this.select(plan);
    const subscription = await manager.getSubscription(targetId, plan);

    if (!subscription) {
      throw new SubscriptionNotExists({ plan });
    }

    if (!subscription.stripeSubscriptionId) {
      throw new CantUpdateOnetimePaymentSubscription();
    }

    if (subscription.canceledAt) {
      throw new SubscriptionHasBeenCanceled();
    }

    if (subscription.recurring === recurring) {
      throw new SameSubscriptionRecurring({ recurring });
    }

    const price = await this.getPrice({
      plan,
      recurring,
      variant: null,
    });

    if (!price) {
      throw new SubscriptionPlanNotFound({ plan, recurring });
    }

    // update the subscription in db optimistically
    const newSubscription = manager.updateSubscriptionRecurring(
      subscription,
      recurring
    );

    const scheduleManager = await this.scheduleManager.fromSubscription(
      subscription.stripeSubscriptionId
    );

    await scheduleManager.update(price.price.id, idempotencyKey);

    return newSubscription;
  }

  async createCustomerPortal(id: string) {
    const user = await this.db.userStripeCustomer.findUnique({
      where: {
        userId: id,
      },
    });

    if (!user) {
      throw new UserNotFound();
    }

    try {
      const portal = await this.stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
      });

      return portal.url;
    } catch (e) {
      this.logger.error('Failed to create customer portal.', e);
      throw new CustomerPortalCreateFailed();
    }
  }

  async saveStripeInvoice(stripeInvoice: Stripe.Invoice): Promise<Invoice> {
    const knownInvoice = await this.parseStripeInvoice(stripeInvoice);

    if (!knownInvoice) {
      throw new InternalServerError('Failed to parse stripe invoice.');
    }

    return this.select(knownInvoice.lookupKey.plan).saveInvoice(knownInvoice);
  }

  async saveStripeSubscription(subscription: Stripe.Subscription) {
    const knownSubscription = await this.parseStripeSubscription(subscription);

    if (!knownSubscription) {
      throw new InternalServerError('Failed to parse stripe subscription.');
    }

    const isPlanActive =
      subscription.status === SubscriptionStatus.Active ||
      subscription.status === SubscriptionStatus.Trialing;

    const manager = this.select(knownSubscription.lookupKey.plan);

    if (!isPlanActive) {
      await manager.deleteSubscription(knownSubscription);
    } else {
      await manager.saveSubscription(knownSubscription);
    }
  }

  async deleteStripeSubscription(subscription: Stripe.Subscription) {
    const knownSubscription = await this.parseStripeSubscription(subscription);

    if (!knownSubscription) {
      throw new InternalServerError('Failed to parse stripe subscription.');
    }

    const manager = this.select(knownSubscription.lookupKey.plan);
    await manager.deleteSubscription(knownSubscription);
  }

  async getOrCreateCustomer(user: CurrentUser): Promise<UserStripeCustomer> {
    let customer = await this.db.userStripeCustomer.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!customer) {
      const stripeCustomersList = await this.stripe.customers.list({
        email: user.email,
        limit: 1,
      });

      let stripeCustomer: Stripe.Customer | undefined;
      if (stripeCustomersList.data.length) {
        stripeCustomer = stripeCustomersList.data[0];
      } else {
        stripeCustomer = await this.stripe.customers.create({
          email: user.email,
        });
      }

      customer = await this.db.userStripeCustomer.create({
        data: {
          userId: user.id,
          stripeCustomerId: stripeCustomer.id,
        },
      });
    }

    return customer;
  }

  @OnEvent('user.updated')
  async onUserUpdated(user: User) {
    const customer = await this.db.userStripeCustomer.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (customer) {
      const stripeCustomer = await this.stripe.customers.retrieve(
        customer.stripeCustomerId
      );
      if (!stripeCustomer.deleted && stripeCustomer.email !== user.email) {
        await this.stripe.customers.update(customer.stripeCustomerId, {
          email: user.email,
        });
      }
    }
  }

  private async retrieveUserFromCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer
  ) {
    const userStripeCustomer = await this.db.userStripeCustomer.findUnique({
      where: {
        stripeCustomerId: typeof customer === 'string' ? customer : customer.id,
      },
    });

    if (userStripeCustomer) {
      return userStripeCustomer.userId;
    }

    if (typeof customer === 'string') {
      customer = await this.stripe.customers.retrieve(customer);
    }

    if (customer.deleted || !customer.email || !customer.id) {
      return null;
    }

    const user = await this.user.findUserByEmail(customer.email);

    if (!user) {
      return null;
    }

    await this.db.userStripeCustomer.create({
      data: {
        userId: user.id,
        stripeCustomerId: customer.id,
      },
    });

    return user.id;
  }

  private async listStripePrices(): Promise<KnownStripePrice[]> {
    const prices = await this.stripe.prices.list({
      active: true,
      limit: 100,
    });

    return prices.data
      .map(price => this.parseStripePrice(price))
      .filter(Boolean) as KnownStripePrice[];
  }

  private async getPrice(
    lookupKey: LookupKey
  ): Promise<KnownStripePrice | null> {
    const prices = await this.stripe.prices.list({
      lookup_keys: [encodeLookupKey(lookupKey)],
      limit: 1,
    });

    const price = prices.data[0];

    return price
      ? {
          lookupKey,
          price,
        }
      : null;
  }

  private async getCouponFromPromotionCode(
    userFacingPromotionCode: string,
    customer: UserStripeCustomer
  ) {
    const list = await this.stripe.promotionCodes.list({
      code: userFacingPromotionCode,
      active: true,
      limit: 1,
    });

    const code = list.data[0];
    if (!code) {
      return null;
    }

    // the coupons are always bound to products, we need to check it first
    // but the logic would be too complicated, and stripe will complain if the code is not applicable when checking out
    // It's safe to skip the check here
    // code.coupon.applies_to.products.forEach()

    // check if the code is bound to a specific customer
    return !code.customer ||
      (typeof code.customer === 'string'
        ? code.customer === customer.stripeCustomerId
        : code.customer.id === customer.stripeCustomerId)
      ? code.coupon.id
      : null;
  }

  private async parseStripeInvoice(
    invoice: Stripe.Invoice
  ): Promise<KnownStripeInvoice | null> {
    // we can't do anything if we can't recognize the customer
    if (!invoice.customer_email) {
      return null;
    }

    const price = invoice.lines.data[0]?.price;

    // there should be at least one line item in the invoice
    if (!price) {
      return null;
    }

    const lookupKey = retriveLookupKeyFromStripePrice(price);

    // The whole subscription system depends on the lookup_keys bound with prices.
    // if the price comes with no lookup_key, we should just ignore it.
    if (!lookupKey) {
      return null;
    }

    const user = await this.user.findUserByEmail(invoice.customer_email);

    // TODO(@forehalo): the email may actually not appear to be AFFiNE user
    // There is coming feature that allow anonymous user with only email provided to buy selfhost licenses
    if (!user) {
      return null;
    }

    return {
      userId: user.id,
      stripeInvoice: invoice,
      lookupKey,
      workspaceId: invoice.subscription_details?.metadata?.workspaceId,
    };
  }

  private async parseStripeSubscription(subscription: Stripe.Subscription) {
    const lookupKey = retriveLookupKeyFromStripeSubscription(subscription);

    if (!lookupKey) {
      return null;
    }

    const userId = await this.retrieveUserFromCustomer(subscription.customer);

    if (!userId) {
      return null;
    }

    const workspaceId = subscription.metadata.workspaceId;

    return {
      userId,
      lookupKey,
      stripeSubscription: subscription,
      quantity: subscription.items.data[0]?.quantity ?? 1,
      workspaceId,
    };
  }

  private parseStripePrice(price: Stripe.Price): KnownStripePrice | null {
    const lookupKey = retriveLookupKeyFromStripePrice(price);

    return lookupKey
      ? {
          lookupKey,
          price,
        }
      : null;
  }

  @OnEvent('workspace.members.updated')
  async onMembersUpdated({
    workspaceId,
    count,
  }: EventPayload<'workspace.members.updated'>) {
    const subscription =
      await this.workspaceManager.getSubscription(workspaceId);

    if (!subscription || !subscription.stripeSubscriptionId) {
      return;
    }
    const stripeSubscription = await this.stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    );

    const lookupKey =
      retriveLookupKeyFromStripeSubscription(stripeSubscription);

    await this.stripe.subscriptions.update(stripeSubscription.id, {
      items: [
        {
          id: stripeSubscription.items.data[0].id,
          quantity: count,
        },
      ],
      payment_behavior: 'pending_if_incomplete',
      proration_behavior:
        lookupKey?.recurring === SubscriptionRecurring.Yearly
          ? 'always_invoice'
          : 'none',
    });

    if (subscription.stripeScheduleId) {
      const schedule = await this.scheduleManager.fromSchedule(
        subscription.stripeScheduleId
      );
      await schedule.updateQuantity(count);
    }
  }
}
