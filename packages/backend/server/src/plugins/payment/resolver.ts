import { Headers } from '@nestjs/common';
import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Parent,
  Query,
  registerEnumType,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import type { User, UserSubscription } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { groupBy } from 'lodash-es';

import { CurrentUser, Public } from '../../core/auth';
import { UserType } from '../../core/user';
import { AccessDenied, FailedToCheckout, URLHelper } from '../../fundamentals';
import { Invoice, Subscription } from './manager';
import { SubscriptionService } from './service';
import {
  InvoiceStatus,
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionStatus,
  SubscriptionVariant,
} from './types';

registerEnumType(SubscriptionStatus, { name: 'SubscriptionStatus' });
registerEnumType(SubscriptionRecurring, { name: 'SubscriptionRecurring' });
registerEnumType(SubscriptionVariant, { name: 'SubscriptionVariant' });
registerEnumType(SubscriptionPlan, { name: 'SubscriptionPlan' });
registerEnumType(InvoiceStatus, { name: 'InvoiceStatus' });

@ObjectType()
class SubscriptionPrice {
  @Field(() => String)
  type!: 'fixed';

  @Field(() => SubscriptionPlan)
  plan!: SubscriptionPlan;

  @Field()
  currency!: string;

  @Field(() => Int, { nullable: true })
  amount?: number | null;

  @Field(() => Int, { nullable: true })
  yearlyAmount?: number | null;

  @Field(() => Int, { nullable: true })
  lifetimeAmount?: number | null;
}

@ObjectType()
export class SubscriptionType implements Subscription {
  @Field(() => SubscriptionPlan, {
    description:
      "The 'Free' plan just exists to be a placeholder and for the type convenience of frontend.\nThere won't actually be a subscription with plan 'Free'",
  })
  plan!: SubscriptionPlan;

  @Field(() => SubscriptionRecurring)
  recurring!: SubscriptionRecurring;

  @Field(() => SubscriptionVariant, { nullable: true })
  variant!: SubscriptionVariant | null;

  @Field(() => SubscriptionStatus)
  status!: SubscriptionStatus;

  @Field(() => Date)
  start!: Date;

  @Field(() => Date, { nullable: true })
  end!: Date | null;

  @Field(() => Date, { nullable: true })
  trialStart!: Date | null;

  @Field(() => Date, { nullable: true })
  trialEnd!: Date | null;

  @Field(() => Date, { nullable: true })
  nextBillAt!: Date | null;

  @Field(() => Date, { nullable: true })
  canceledAt!: Date | null;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  // deprecated fields
  @Field(() => String, {
    name: 'id',
    nullable: true,
    deprecationReason: 'removed',
  })
  stripeSubscriptionId!: string;
}

@ObjectType()
export class InvoiceType implements Invoice {
  @Field()
  currency!: string;

  @Field()
  amount!: number;

  @Field(() => InvoiceStatus)
  status!: InvoiceStatus;

  @Field()
  reason!: string;

  @Field(() => String, { nullable: true })
  lastPaymentError!: string | null;

  @Field(() => String, { nullable: true })
  link!: string | null;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  // deprecated fields
  @Field(() => String, {
    name: 'id',
    nullable: true,
    deprecationReason: 'removed',
  })
  stripeInvoiceId!: string | null;

  @Field(() => SubscriptionPlan, {
    nullable: true,
    deprecationReason: 'removed',
  })
  plan!: SubscriptionPlan | null;

  @Field(() => SubscriptionRecurring, {
    nullable: true,
    deprecationReason: 'removed',
  })
  recurring!: SubscriptionRecurring | null;
}

@InputType()
class CreateCheckoutSessionInput {
  @Field(() => SubscriptionRecurring, {
    nullable: true,
    defaultValue: SubscriptionRecurring.Yearly,
  })
  recurring!: SubscriptionRecurring;

  @Field(() => SubscriptionPlan, {
    nullable: true,
    defaultValue: SubscriptionPlan.Pro,
  })
  plan!: SubscriptionPlan;

  @Field(() => SubscriptionVariant, {
    nullable: true,
  })
  variant?: SubscriptionVariant;

  @Field(() => String, { nullable: true })
  coupon!: string | null;

  @Field(() => String)
  successCallbackLink!: string;

  @Field(() => String, {
    nullable: true,
    deprecationReason: 'use header `Idempotency-Key`',
  })
  idempotencyKey?: string;
}

@Resolver(() => SubscriptionType)
export class SubscriptionResolver {
  constructor(
    private readonly service: SubscriptionService,
    private readonly url: URLHelper
  ) {}

  @Public()
  @Query(() => [SubscriptionPrice])
  async prices(
    @CurrentUser() user?: CurrentUser
  ): Promise<SubscriptionPrice[]> {
    const prices = await this.service.listPrices(user);

    const group = groupBy(prices, price => {
      return price.lookupKey.plan;
    });

    function findPrice(plan: SubscriptionPlan) {
      const prices = group[plan];

      if (!prices) {
        return null;
      }

      const monthlyPrice = prices.find(
        p => p.lookupKey.recurring === SubscriptionRecurring.Monthly
      );
      const yearlyPrice = prices.find(
        p => p.lookupKey.recurring === SubscriptionRecurring.Yearly
      );
      const lifetimePrice = prices.find(
        p => p.lookupKey.recurring === SubscriptionRecurring.Lifetime
      );

      const currency =
        monthlyPrice?.price.currency ?? yearlyPrice?.price.currency ?? 'usd';

      return {
        currency,
        amount: monthlyPrice?.price.unit_amount,
        yearlyAmount: yearlyPrice?.price.unit_amount,
        lifetimeAmount: lifetimePrice?.price.unit_amount,
      };
    }

    // extend it when new plans are added
    const fixedPlans = [SubscriptionPlan.Pro, SubscriptionPlan.AI];

    return fixedPlans.reduce((prices, plan) => {
      const price = findPrice(plan);

      if (price && (price.amount || price.yearlyAmount)) {
        prices.push({
          type: 'fixed',
          plan,
          ...price,
        });
      }

      return prices;
    }, [] as SubscriptionPrice[]);
  }

  @Mutation(() => String, {
    description: 'Create a subscription checkout link of stripe',
  })
  async createCheckoutSession(
    @CurrentUser() user: CurrentUser,
    @Args({ name: 'input', type: () => CreateCheckoutSessionInput })
    input: CreateCheckoutSessionInput,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    const session = await this.service.checkout({
      user,
      lookupKey: {
        plan: input.plan,
        recurring: input.recurring,
        variant: input.variant,
      },
      promotionCode: input.coupon,
      redirectUrl: this.url.link(input.successCallbackLink),
      idempotencyKey,
    });

    if (!session.url) {
      throw new FailedToCheckout();
    }

    return session.url;
  }

  @Mutation(() => String, {
    description: 'Create a stripe customer portal to manage payment methods',
  })
  async createCustomerPortal(@CurrentUser() user: CurrentUser) {
    return this.service.createCustomerPortal(user.id);
  }

  @Mutation(() => SubscriptionType)
  async cancelSubscription(
    @CurrentUser() user: CurrentUser,
    @Args({
      name: 'plan',
      type: () => SubscriptionPlan,
      nullable: true,
      defaultValue: SubscriptionPlan.Pro,
    })
    plan: SubscriptionPlan,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Args('idempotencyKey', {
      type: () => String,
      nullable: true,
      deprecationReason: 'use header `Idempotency-Key`',
    })
    _?: string
  ) {
    return this.service.cancelSubscription(user.id, plan, idempotencyKey);
  }

  @Mutation(() => SubscriptionType)
  async resumeSubscription(
    @CurrentUser() user: CurrentUser,
    @Args({
      name: 'plan',
      type: () => SubscriptionPlan,
      nullable: true,
      defaultValue: SubscriptionPlan.Pro,
    })
    plan: SubscriptionPlan,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Args('idempotencyKey', {
      type: () => String,
      nullable: true,
      deprecationReason: 'use header `Idempotency-Key`',
    })
    _?: string
  ) {
    return this.service.resumeSubscription(user.id, plan, idempotencyKey);
  }

  @Mutation(() => SubscriptionType)
  async updateSubscriptionRecurring(
    @CurrentUser() user: CurrentUser,
    @Args({ name: 'recurring', type: () => SubscriptionRecurring })
    recurring: SubscriptionRecurring,
    @Args({
      name: 'plan',
      type: () => SubscriptionPlan,
      nullable: true,
      defaultValue: SubscriptionPlan.Pro,
    })
    plan: SubscriptionPlan,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Args('idempotencyKey', {
      type: () => String,
      nullable: true,
      deprecationReason: 'use header `Idempotency-Key`',
    })
    _?: string
  ) {
    return this.service.updateSubscriptionRecurring(
      user.id,
      plan,
      recurring,
      idempotencyKey
    );
  }
}

@Resolver(() => UserType)
export class UserSubscriptionResolver {
  constructor(private readonly db: PrismaClient) {}

  @ResolveField(() => [SubscriptionType])
  async subscriptions(
    @CurrentUser() me: User,
    @Parent() user: User
  ): Promise<UserSubscription[]> {
    if (me.id !== user.id) {
      throw new AccessDenied();
    }

    const subscriptions = await this.db.userSubscription.findMany({
      where: {
        userId: user.id,
        status: SubscriptionStatus.Active,
      },
    });

    subscriptions.forEach(subscription => {
      if (
        subscription.variant &&
        ![SubscriptionVariant.EA, SubscriptionVariant.Onetime].includes(
          subscription.variant as SubscriptionVariant
        )
      ) {
        subscription.variant = null;
      }
    });

    return subscriptions;
  }

  @ResolveField(() => [InvoiceType])
  async invoices(
    @CurrentUser() me: User,
    @Parent() user: User,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 8 })
    take: number,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number
  ) {
    if (me.id !== user.id) {
      throw new AccessDenied();
    }

    return this.db.userInvoice.findMany({
      where: {
        userId: user.id,
      },
      take,
      skip,
      orderBy: {
        id: 'desc',
      },
    });
  }
}
