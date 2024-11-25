import '../../src/plugins/payment';

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ava, { TestFn } from 'ava';
import Sinon from 'sinon';
import Stripe from 'stripe';

import { AppModule } from '../../src/app.module';
import { CurrentUser } from '../../src/core/auth';
import { AuthService } from '../../src/core/auth/service';
import {
  EarlyAccessType,
  FeatureManagementService,
} from '../../src/core/features';
import { EventEmitter } from '../../src/fundamentals';
import { Config, ConfigModule } from '../../src/fundamentals/config';
import { SubscriptionService } from '../../src/plugins/payment/service';
import {
  CouponType,
  encodeLookupKey,
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionStatus,
  SubscriptionVariant,
} from '../../src/plugins/payment/types';
import { createTestingApp, initTestingDB } from '../utils';

const PRO_MONTHLY = `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Monthly}`;
const PRO_YEARLY = `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Yearly}`;
const PRO_LIFETIME = `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Lifetime}`;
const PRO_EA_YEARLY = `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.EA}`;
const AI_YEARLY = `${SubscriptionPlan.AI}_${SubscriptionRecurring.Yearly}`;
const AI_YEARLY_EA = `${SubscriptionPlan.AI}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.EA}`;
// prices for code redeeming
const PRO_MONTHLY_CODE = `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Monthly}_${SubscriptionVariant.Onetime}`;
const PRO_YEARLY_CODE = `${SubscriptionPlan.Pro}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.Onetime}`;
const AI_YEARLY_CODE = `${SubscriptionPlan.AI}_${SubscriptionRecurring.Yearly}_${SubscriptionVariant.Onetime}`;

const PRICES = {
  [PRO_MONTHLY]: {
    recurring: {
      interval: 'month',
    },
    unit_amount: 799,
    currency: 'usd',
    id: PRO_MONTHLY,
    lookup_key: PRO_MONTHLY,
  },
  [PRO_YEARLY]: {
    recurring: {
      interval: 'year',
    },
    unit_amount: 8100,
    currency: 'usd',
    id: PRO_YEARLY,
    lookup_key: PRO_YEARLY,
  },
  [PRO_LIFETIME]: {
    unit_amount: 49900,
    currency: 'usd',
    id: PRO_LIFETIME,
    lookup_key: PRO_LIFETIME,
  },
  [PRO_EA_YEARLY]: {
    recurring: {
      interval: 'year',
    },
    unit_amount: 5000,
    currency: 'usd',
    id: PRO_EA_YEARLY,
    lookup_key: PRO_EA_YEARLY,
  },
  [AI_YEARLY]: {
    recurring: {
      interval: 'year',
    },
    unit_amount: 10680,
    currency: 'usd',
    id: AI_YEARLY,
    lookup_key: AI_YEARLY,
  },
  [AI_YEARLY_EA]: {
    recurring: {
      interval: 'year',
    },
    unit_amount: 9999,
    currency: 'usd',
    id: AI_YEARLY_EA,
    lookup_key: AI_YEARLY_EA,
  },
  [PRO_MONTHLY_CODE]: {
    unit_amount: 799,
    currency: 'usd',
    id: PRO_MONTHLY_CODE,
    lookup_key: PRO_MONTHLY_CODE,
  },
  [PRO_YEARLY_CODE]: {
    unit_amount: 8100,
    currency: 'usd',
    id: PRO_YEARLY_CODE,
    lookup_key: PRO_YEARLY_CODE,
  },
  [AI_YEARLY_CODE]: {
    unit_amount: 10680,
    currency: 'usd',
    id: AI_YEARLY_CODE,
    lookup_key: AI_YEARLY_CODE,
  },
} as any as Record<string, Stripe.Price>;

const sub: Stripe.Subscription = {
  id: 'sub_1',
  object: 'subscription',
  cancel_at_period_end: false,
  canceled_at: null,
  current_period_end: 1745654236,
  current_period_start: 1714118236,
  // @ts-expect-error stub
  customer: {
    id: 'cus_1',
    email: 'u1@affine.pro',
  },
  items: {
    object: 'list',
    data: [
      {
        id: 'si_1',
        // @ts-expect-error stub
        price: {
          id: 'price_1',
          lookup_key: 'pro_monthly',
        },
        subscription: 'sub_1',
      },
    ],
  },
  status: 'active',
  trial_end: null,
  trial_start: null,
  schedule: null,
};

const test = ava as TestFn<{
  u1: CurrentUser;
  db: PrismaClient;
  app: INestApplication;
  service: SubscriptionService;
  event: Sinon.SinonStubbedInstance<EventEmitter>;
  feature: Sinon.SinonStubbedInstance<FeatureManagementService>;
  stripe: {
    customers: Sinon.SinonStubbedInstance<Stripe.CustomersResource>;
    prices: Sinon.SinonStubbedInstance<Stripe.PricesResource>;
    subscriptions: Sinon.SinonStubbedInstance<Stripe.SubscriptionsResource>;
    subscriptionSchedules: Sinon.SinonStubbedInstance<Stripe.SubscriptionSchedulesResource>;
    checkout: {
      sessions: Sinon.SinonStubbedInstance<Stripe.Checkout.SessionsResource>;
    };
  };
}>;

function getLastCheckoutPrice(checkoutStub: Sinon.SinonStub) {
  const call = checkoutStub.getCall(checkoutStub.callCount - 1);
  const arg = call.args[0] as Stripe.Checkout.SessionCreateParams;
  return {
    price: arg.line_items?.[0]?.price,
    coupon: arg.discounts?.[0]?.coupon,
  };
}

test.before(async t => {
  const { app } = await createTestingApp({
    imports: [
      ConfigModule.forRoot({
        plugins: {
          payment: {
            stripe: {
              keys: {
                APIKey: '1',
                webhookKey: '1',
              },
            },
          },
        },
      }),
      AppModule,
    ],
    tapModule: m => {
      m.overrideProvider(FeatureManagementService).useValue(
        Sinon.createStubInstance(FeatureManagementService)
      );
      m.overrideProvider(EventEmitter).useValue(
        Sinon.createStubInstance(EventEmitter)
      );
    },
  });

  t.context.event = app.get(EventEmitter);
  t.context.service = app.get(SubscriptionService);
  t.context.feature = app.get(FeatureManagementService);
  t.context.db = app.get(PrismaClient);
  t.context.app = app;

  const stripe = app.get(Stripe);
  const stripeStubs = {
    customers: Sinon.stub(stripe.customers),
    prices: Sinon.stub(stripe.prices),
    subscriptions: Sinon.stub(stripe.subscriptions),
    subscriptionSchedules: Sinon.stub(stripe.subscriptionSchedules),
    checkout: {
      sessions: Sinon.stub(stripe.checkout.sessions),
    },
  };

  t.context.stripe = stripeStubs;
});

test.beforeEach(async t => {
  const { db, app, stripe } = t.context;
  Sinon.reset();
  await initTestingDB(db);
  // TODO(@forehalo): workaround for runtime module, need to init all runtime configs in [initTestingDB]
  await app.get(Config).runtime.onModuleInit();
  t.context.u1 = await app.get(AuthService).signUp('u1@affine.pro', '1');

  await db.userStripeCustomer.create({
    data: {
      userId: t.context.u1.id,
      stripeCustomerId: 'cus_1',
    },
  });

  // default stubs
  // @ts-expect-error stub
  stripe.prices.list.callsFake((params: Stripe.PriceListParams) => {
    if (params.lookup_keys) {
      return Promise.resolve({
        data: params.lookup_keys.map(lk => PRICES[lk]),
      });
    }

    return Promise.resolve({ data: Object.values(PRICES) });
  });

  // @ts-expect-error stub
  stripe.subscriptions.list.resolves({ data: [] });
});

test.after.always(async t => {
  await t.context.app.close();
});

// ============== prices ==============
test('should list normal price for unauthenticated user', async t => {
  const { service } = t.context;

  const prices = await service.listPrices();

  t.snapshot(prices.map(p => encodeLookupKey(p.lookupKey)));
});

test('should list normal prices for authenticated user', async t => {
  const { feature, service, u1 } = t.context;

  feature.isEarlyAccessUser.withArgs(u1.id).resolves(false);
  feature.isEarlyAccessUser.withArgs(u1.id, EarlyAccessType.AI).resolves(false);

  const prices = await service.listPrices(u1);

  t.snapshot(prices.map(p => encodeLookupKey(p.lookupKey)));
});

test('should list early access prices for pro ea user', async t => {
  const { feature, service, u1 } = t.context;

  feature.isEarlyAccessUser.withArgs(u1.id).resolves(true);
  feature.isEarlyAccessUser.withArgs(u1.id, EarlyAccessType.AI).resolves(false);

  const prices = await service.listPrices(u1);

  t.snapshot(prices.map(p => encodeLookupKey(p.lookupKey)));
});

test('should list normal prices for pro ea user with old subscriptions', async t => {
  const { feature, service, u1, stripe } = t.context;

  feature.isEarlyAccessUser.withArgs(u1.id).resolves(true);
  feature.isEarlyAccessUser.withArgs(u1.id, EarlyAccessType.AI).resolves(false);

  stripe.subscriptions.list.resolves({
    data: [
      {
        id: 'sub_1',
        status: 'canceled',
        items: {
          data: [
            {
              // @ts-expect-error stub
              price: {
                lookup_key: PRO_YEARLY,
              },
            },
          ],
        },
      },
    ],
  });

  const prices = await service.listPrices(u1);

  t.snapshot(prices.map(p => encodeLookupKey(p.lookupKey)));
});

test('should list early access prices for ai ea user', async t => {
  const { feature, service, u1 } = t.context;

  feature.isEarlyAccessUser.withArgs(u1.id).resolves(false);
  feature.isEarlyAccessUser.withArgs(u1.id, EarlyAccessType.AI).resolves(true);

  const prices = await service.listPrices(u1);

  t.snapshot(prices.map(p => encodeLookupKey(p.lookupKey)));
});

test('should list early access prices for pro and ai ea user', async t => {
  const { feature, service, u1 } = t.context;

  feature.isEarlyAccessUser.withArgs(u1.id).resolves(true);

  const prices = await service.listPrices(u1);

  t.snapshot(prices.map(p => encodeLookupKey(p.lookupKey)));
});

test('should list normal prices for ai ea user with old subscriptions', async t => {
  const { feature, service, u1, stripe } = t.context;

  feature.isEarlyAccessUser.withArgs(u1.id).resolves(false);
  feature.isEarlyAccessUser.withArgs(u1.id, EarlyAccessType.AI).resolves(true);

  stripe.subscriptions.list.resolves({
    data: [
      {
        id: 'sub_1',
        status: 'canceled',
        items: {
          data: [
            {
              // @ts-expect-error stub
              price: {
                lookup_key: AI_YEARLY,
              },
            },
          ],
        },
      },
    ],
  });

  const prices = await service.listPrices(u1);

  t.snapshot(prices.map(p => encodeLookupKey(p.lookupKey)));
});

// ============= end prices ================

// ============= checkout ==================
test('should throw if user has subscription already', async t => {
  const { service, u1, db } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(),
    },
  });

  await t.throwsAsync(
    () =>
      service.checkout({
        user: u1,
        lookupKey: {
          plan: SubscriptionPlan.Pro,
          recurring: SubscriptionRecurring.Monthly,
        },
        redirectUrl: '',
        idempotencyKey: '',
      }),
    { message: 'You have already subscribed to the pro plan.' }
  );
});

test('should get correct pro plan price for checking out', async t => {
  const { app, service, u1, stripe, feature } = t.context;
  // non-ea user
  {
    feature.isEarlyAccessUser.resolves(false);

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.Pro,
        recurring: SubscriptionRecurring.Monthly,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: PRO_MONTHLY,
      coupon: undefined,
    });
  }

  // ea user, but monthly
  {
    feature.isEarlyAccessUser.resolves(true);
    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.Pro,
        recurring: SubscriptionRecurring.Monthly,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: PRO_MONTHLY,
      coupon: undefined,
    });
  }

  // ea user, yearly
  {
    feature.isEarlyAccessUser.resolves(true);
    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.Pro,
        recurring: SubscriptionRecurring.Yearly,
        variant: SubscriptionVariant.EA,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: PRO_EA_YEARLY,
      coupon: CouponType.ProEarlyAccessOneYearFree,
    });
  }

  // ea user, yearly recurring, but has old subscription
  {
    feature.isEarlyAccessUser.resolves(true);
    stripe.subscriptions.list.resolves({
      data: [
        {
          id: 'sub_1',
          status: 'canceled',
          items: {
            data: [
              {
                // @ts-expect-error stub
                price: {
                  lookup_key: PRO_YEARLY,
                },
              },
            ],
          },
        },
      ],
    });

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.Pro,
        recurring: SubscriptionRecurring.Yearly,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: PRO_YEARLY,
      coupon: undefined,
    });

    await t.throwsAsync(
      () =>
        service.checkout({
          user: u1,
          lookupKey: {
            plan: SubscriptionPlan.Pro,
            recurring: SubscriptionRecurring.Yearly,
            variant: SubscriptionVariant.EA,
          },
          redirectUrl: '',
          idempotencyKey: '',
        }),
      {
        message: 'You are trying to access a unknown subscription plan.',
      }
    );
  }

  // any user, lifetime recurring
  {
    feature.isEarlyAccessUser.resolves(false);
    const config = app.get(Config);
    await config.runtime.set('plugins.payment/showLifetimePrice', true);

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.Pro,
        recurring: SubscriptionRecurring.Lifetime,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: PRO_LIFETIME,
      coupon: undefined,
    });
  }
});

test('should get correct ai plan price for checking out', async t => {
  const { service, u1, stripe, feature } = t.context;

  // non-ea user
  {
    feature.isEarlyAccessUser.resolves(false);

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.AI,
        recurring: SubscriptionRecurring.Yearly,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: AI_YEARLY,
      coupon: undefined,
    });
  }

  // ea user
  {
    feature.isEarlyAccessUser.resolves(true);

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.AI,
        recurring: SubscriptionRecurring.Yearly,
        variant: SubscriptionVariant.EA,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: AI_YEARLY_EA,
      coupon: CouponType.AIEarlyAccessOneYearFree,
    });
  }

  // ea user, but has old subscription
  {
    feature.isEarlyAccessUser.withArgs(u1.id).resolves(false);
    feature.isEarlyAccessUser
      .withArgs(u1.id, EarlyAccessType.AI)
      .resolves(true);
    stripe.subscriptions.list.resolves({
      data: [
        {
          id: 'sub_1',
          status: 'canceled',
          items: {
            data: [
              {
                // @ts-expect-error stub
                price: {
                  lookup_key: AI_YEARLY,
                },
              },
            ],
          },
        },
      ],
    });

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.AI,
        recurring: SubscriptionRecurring.Yearly,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: AI_YEARLY,
      coupon: undefined,
    });

    await t.throwsAsync(
      () =>
        service.checkout({
          user: u1,
          lookupKey: {
            plan: SubscriptionPlan.AI,
            recurring: SubscriptionRecurring.Yearly,
            variant: SubscriptionVariant.EA,
          },
          redirectUrl: '',
          idempotencyKey: '',
        }),
      {
        message: 'You are trying to access a unknown subscription plan.',
      }
    );
  }

  // pro ea user
  {
    feature.isEarlyAccessUser.withArgs(u1.id).resolves(true);
    feature.isEarlyAccessUser
      .withArgs(u1.id, EarlyAccessType.AI)
      .resolves(false);
    // @ts-expect-error stub
    stripe.subscriptions.list.resolves({ data: [] });

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.AI,
        recurring: SubscriptionRecurring.Yearly,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: AI_YEARLY,
      coupon: CouponType.ProEarlyAccessAIOneYearFree,
    });
  }

  // pro ea user, but has old subscription
  {
    feature.isEarlyAccessUser.withArgs(u1.id).resolves(true);
    feature.isEarlyAccessUser
      .withArgs(u1.id, EarlyAccessType.AI)
      .resolves(false);
    stripe.subscriptions.list.resolves({
      data: [
        {
          id: 'sub_1',
          status: 'canceled',
          items: {
            data: [
              {
                // @ts-expect-error stub
                price: {
                  lookup_key: AI_YEARLY,
                },
              },
            ],
          },
        },
      ],
    });

    await service.checkout({
      user: u1,
      lookupKey: {
        plan: SubscriptionPlan.AI,
        recurring: SubscriptionRecurring.Yearly,
      },
      redirectUrl: '',
      idempotencyKey: '',
    });

    t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
      price: AI_YEARLY,
      coupon: undefined,
    });
  }
});

test('should apply user coupon for checking out', async t => {
  const { service, u1, stripe } = t.context;

  // @ts-expect-error private member
  Sinon.stub(service, 'getCouponFromPromotionCode').resolves('coupon_1');

  await service.checkout({
    user: u1,
    lookupKey: {
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
    },
    redirectUrl: '',
    idempotencyKey: '',
    promotionCode: 'test',
  });

  t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
    price: PRO_MONTHLY,
    coupon: 'coupon_1',
  });
});

// =============== subscriptions ===============
test('should be able to create subscription', async t => {
  const { event, service, db, u1 } = t.context;

  await service.saveStripeSubscription(sub);

  const subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  t.true(
    event.emit.calledOnceWith('user.subscription.activated', {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
    })
  );
  t.is(subInDB?.stripeSubscriptionId, sub.id);
});

test('should be able to update subscription', async t => {
  const { event, service, db, u1 } = t.context;
  await service.saveStripeSubscription(sub);

  await service.saveStripeSubscription({
    ...sub,
    cancel_at_period_end: true,
    canceled_at: 1714118236,
  });

  t.true(
    event.emit.calledWith('user.subscription.activated', {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
    })
  );

  const subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  t.is(subInDB?.status, SubscriptionStatus.Active);
  t.is(subInDB?.canceledAt?.getTime(), 1714118236000);
});

test('should be able to delete subscription', async t => {
  const { event, service, db, u1 } = t.context;
  await service.saveStripeSubscription(sub);

  await service.saveStripeSubscription({
    ...sub,
    status: 'canceled',
  });

  t.true(
    event.emit.calledWith('user.subscription.canceled', {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
    })
  );

  const subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  t.is(subInDB, null);
});

test('should be able to cancel subscription', async t => {
  const { service, db, u1, stripe } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Yearly,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(),
    },
  });

  stripe.subscriptions.update.resolves({
    ...sub,
    cancel_at_period_end: true,
    canceled_at: 1714118236,
  } as any);

  const subInDB = await service.cancelSubscription(u1.id, SubscriptionPlan.Pro);

  t.true(
    stripe.subscriptions.update.calledOnceWith('sub_1', {
      cancel_at_period_end: true,
    })
  );
  t.is(subInDB.status, SubscriptionStatus.Active);
  t.truthy(subInDB.canceledAt);
});

test('should be able to resume subscription', async t => {
  const { service, db, u1, stripe } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Yearly,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(Date.now() + 100000),
      canceledAt: new Date(),
    },
  });

  stripe.subscriptions.update.resolves(sub as any);

  const subInDB = await service.resumeSubscription(u1.id, SubscriptionPlan.Pro);

  t.true(
    stripe.subscriptions.update.calledOnceWith('sub_1', {
      cancel_at_period_end: false,
    })
  );
  t.is(subInDB.status, SubscriptionStatus.Active);
  t.falsy(subInDB.canceledAt);
});

const subscriptionSchedule: Stripe.SubscriptionSchedule = {
  id: 'sub_sched_1',
  customer: 'cus_1',
  subscription: 'sub_1',
  status: 'active',
  phases: [
    {
      items: [
        // @ts-expect-error mock
        {
          price: PRO_MONTHLY,
        },
      ],
      start_date: 1714118236,
      end_date: 1745654236,
    },
  ],
};

test('should be able to update recurring', async t => {
  const { service, db, u1, stripe } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(Date.now() + 100000),
    },
  });

  // 1. turn a subscription into a subscription schedule
  // 2. update the schedule
  //   2.1 update the current phase with an end date
  //   2.2 add a new phase with a start date

  stripe.subscriptions.retrieve.resolves(sub as any);
  stripe.subscriptionSchedules.create.resolves(subscriptionSchedule as any);
  stripe.subscriptionSchedules.update.resolves(subscriptionSchedule as any);

  await service.updateSubscriptionRecurring(
    u1.id,
    SubscriptionPlan.Pro,
    SubscriptionRecurring.Yearly
  );

  t.true(stripe.subscriptionSchedules.update.calledOnce);
  const arg = stripe.subscriptionSchedules.update.firstCall.args;
  t.is(arg[0], subscriptionSchedule.id);
  t.deepEqual(arg[1], {
    phases: [
      {
        items: [
          {
            price: PRO_MONTHLY,
          },
        ],
        start_date: 1714118236,
        end_date: 1745654236,
      },
      {
        items: [
          {
            price: PRO_YEARLY,
          },
        ],
      },
    ],
  });
});

test('should release the schedule if the new recurring is the same as the current phase', async t => {
  const { service, db, u1, stripe } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      stripeScheduleId: 'sub_sched_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Yearly,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(Date.now() + 100000),
    },
  });

  stripe.subscriptions.retrieve.resolves({
    ...sub,
    schedule: subscriptionSchedule.id,
  } as any);
  stripe.subscriptionSchedules.retrieve.resolves(subscriptionSchedule as any);

  await service.updateSubscriptionRecurring(
    u1.id,
    SubscriptionPlan.Pro,
    SubscriptionRecurring.Monthly
  );

  t.true(
    stripe.subscriptionSchedules.release.calledOnceWith(subscriptionSchedule.id)
  );
});

// ============== Lifetime Subscription ===============
const lifetimeInvoice: Stripe.Invoice = {
  id: 'in_1',
  object: 'invoice',
  amount_paid: 49900,
  total: 49900,
  customer: 'cus_1',
  customer_email: 'u1@affine.pro',
  currency: 'usd',
  status: 'paid',
  lines: {
    data: [
      // @ts-expect-error stub
      {
        price: PRICES[PRO_LIFETIME],
      },
    ],
  },
};

const onetimeMonthlyInvoice: Stripe.Invoice = {
  id: 'in_2',
  object: 'invoice',
  amount_paid: 799,
  total: 799,
  customer: 'cus_1',
  customer_email: 'u1@affine.pro',
  currency: 'usd',
  status: 'paid',
  lines: {
    data: [
      // @ts-expect-error stub
      {
        price: PRICES[PRO_MONTHLY_CODE],
      },
    ],
  },
};

const onetimeYearlyInvoice: Stripe.Invoice = {
  id: 'in_3',
  object: 'invoice',
  amount_paid: 8100,
  total: 8100,
  customer: 'cus_1',
  customer_email: 'u1@affine.pro',
  currency: 'usd',
  status: 'paid',
  lines: {
    data: [
      // @ts-expect-error stub
      {
        price: PRICES[PRO_YEARLY_CODE],
      },
    ],
  },
};

test('should not be able to checkout for lifetime recurring if not enabled', async t => {
  const { service, u1, app } = t.context;
  await app.get(Config).runtime.set('plugins.payment/showLifetimePrice', false);

  await t.throwsAsync(
    () =>
      service.checkout({
        user: u1,
        lookupKey: {
          plan: SubscriptionPlan.Pro,
          recurring: SubscriptionRecurring.Lifetime,
        },
        redirectUrl: '',
        idempotencyKey: '',
      }),
    { message: 'You are trying to access a unknown subscription plan.' }
  );
});

test('should be able to checkout for lifetime recurring', async t => {
  const { service, u1, app, stripe } = t.context;
  const config = app.get(Config);
  await config.runtime.set('plugins.payment/showLifetimePrice', true);

  await service.checkout({
    user: u1,
    lookupKey: {
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Lifetime,
    },
    redirectUrl: '',
    idempotencyKey: '',
  });

  t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
    price: PRO_LIFETIME,
    coupon: undefined,
  });
});

test('should not be able to checkout for lifetime recurring if already subscribed', async t => {
  const { service, u1, db } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: null,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Lifetime,
      status: SubscriptionStatus.Active,
      start: new Date(),
    },
  });

  await t.throwsAsync(
    () =>
      service.checkout({
        user: u1,
        lookupKey: {
          plan: SubscriptionPlan.Pro,
          recurring: SubscriptionRecurring.Lifetime,
        },
        redirectUrl: '',
        idempotencyKey: '',
      }),
    { message: 'You have already subscribed to the pro plan.' }
  );

  await db.userSubscription.updateMany({
    where: { userId: u1.id },
    data: {
      stripeSubscriptionId: null,
      recurring: SubscriptionRecurring.Monthly,
      variant: SubscriptionVariant.Onetime,
      end: new Date(Date.now() + 100000),
    },
  });

  await t.throwsAsync(
    () =>
      service.checkout({
        user: u1,
        lookupKey: {
          plan: SubscriptionPlan.Pro,
          recurring: SubscriptionRecurring.Lifetime,
        },
        redirectUrl: '',
        idempotencyKey: '',
      }),
    { message: 'You have already subscribed to the pro plan.' }
  );
});

test('should be able to subscribe to lifetime recurring', async t => {
  // lifetime payment isn't a subscription, so we need to trigger the creation by invoice payment event
  const { service, db, u1, event } = t.context;

  await service.saveStripeInvoice(lifetimeInvoice);

  const subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  t.true(
    event.emit.calledOnceWith('user.subscription.activated', {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Lifetime,
    })
  );
  t.is(subInDB?.plan, SubscriptionPlan.Pro);
  t.is(subInDB?.recurring, SubscriptionRecurring.Lifetime);
  t.is(subInDB?.status, SubscriptionStatus.Active);
  t.is(subInDB?.stripeSubscriptionId, null);
});

test('should be able to subscribe to lifetime recurring with old subscription', async t => {
  const { service, stripe, db, u1, event } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(),
    },
  });

  stripe.subscriptions.cancel.resolves(sub as any);
  await service.saveStripeInvoice(lifetimeInvoice);

  const subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  t.true(
    event.emit.calledOnceWith('user.subscription.activated', {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Lifetime,
    })
  );
  t.is(subInDB?.plan, SubscriptionPlan.Pro);
  t.is(subInDB?.recurring, SubscriptionRecurring.Lifetime);
  t.is(subInDB?.status, SubscriptionStatus.Active);
  t.is(subInDB?.stripeSubscriptionId, null);
});

test('should not be able to cancel lifetime subscription', async t => {
  const { service, db, u1 } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Lifetime,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(),
    },
  });

  await t.throwsAsync(
    () => service.cancelSubscription(u1.id, SubscriptionPlan.Pro),
    { message: 'Onetime payment subscription cannot be canceled.' }
  );
});

test('should not be able to update lifetime recurring', async t => {
  const { service, db, u1 } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Lifetime,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(),
    },
  });

  await t.throwsAsync(
    () =>
      service.updateSubscriptionRecurring(
        u1.id,
        SubscriptionPlan.Pro,
        SubscriptionRecurring.Monthly
      ),
    { message: 'You cannot update an onetime payment subscription.' }
  );
});

// ============== Onetime Subscription ===============
test('should be able to checkout for onetime payment', async t => {
  const { service, u1, stripe } = t.context;

  await service.checkout({
    user: u1,
    lookupKey: {
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
      variant: SubscriptionVariant.Onetime,
    },
    redirectUrl: '',
    idempotencyKey: '',
  });

  t.true(stripe.checkout.sessions.create.calledOnce);
  const arg = stripe.checkout.sessions.create.firstCall
    .args[0] as Stripe.Checkout.SessionCreateParams;
  t.is(arg.mode, 'payment');
  t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
    price: PRO_MONTHLY_CODE,
    coupon: undefined,
  });
});

test('should be able to checkout onetime payment if previous subscription is onetime', async t => {
  const { service, u1, stripe, db } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
      variant: SubscriptionVariant.Onetime,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(),
    },
  });

  await service.checkout({
    user: u1,
    lookupKey: {
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
      variant: SubscriptionVariant.Onetime,
    },
    redirectUrl: '',
    idempotencyKey: '',
  });

  t.true(stripe.checkout.sessions.create.calledOnce);
  const arg = stripe.checkout.sessions.create.firstCall
    .args[0] as Stripe.Checkout.SessionCreateParams;
  t.is(arg.mode, 'payment');
  t.deepEqual(getLastCheckoutPrice(stripe.checkout.sessions.create), {
    price: PRO_MONTHLY_CODE,
    coupon: undefined,
  });
});

test('should not be able to checkout out onetime payment if previous subscription is not onetime', async t => {
  const { service, u1, db } = t.context;

  await db.userSubscription.create({
    data: {
      userId: u1.id,
      stripeSubscriptionId: 'sub_1',
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
      status: SubscriptionStatus.Active,
      start: new Date(),
      end: new Date(),
    },
  });

  await t.throwsAsync(
    () =>
      service.checkout({
        user: u1,
        lookupKey: {
          plan: SubscriptionPlan.Pro,
          recurring: SubscriptionRecurring.Monthly,
          variant: SubscriptionVariant.Onetime,
        },
        redirectUrl: '',
        idempotencyKey: '',
      }),
    { message: 'You have already subscribed to the pro plan.' }
  );

  await db.userSubscription.updateMany({
    where: { userId: u1.id },
    data: {
      stripeSubscriptionId: null,
      recurring: SubscriptionRecurring.Lifetime,
    },
  });

  await t.throwsAsync(
    () =>
      service.checkout({
        user: u1,
        lookupKey: {
          plan: SubscriptionPlan.Pro,
          recurring: SubscriptionRecurring.Monthly,
          variant: SubscriptionVariant.Onetime,
        },
        redirectUrl: '',
        idempotencyKey: '',
      }),
    { message: 'You have already subscribed to the pro plan.' }
  );
});

test('should be able to subscribe onetime payment subscription', async t => {
  const { service, db, u1, event } = t.context;

  await service.saveStripeInvoice(onetimeMonthlyInvoice);

  const subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  t.true(
    event.emit.calledOnceWith('user.subscription.activated', {
      userId: u1.id,
      plan: SubscriptionPlan.Pro,
      recurring: SubscriptionRecurring.Monthly,
    })
  );
  t.is(subInDB?.plan, SubscriptionPlan.Pro);
  t.is(subInDB?.recurring, SubscriptionRecurring.Monthly);
  t.is(subInDB?.status, SubscriptionStatus.Active);
  t.is(subInDB?.stripeSubscriptionId, null);
  t.is(
    subInDB?.end?.toDateString(),
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toDateString()
  );
});

test('should be able to recalculate onetime payment subscription period', async t => {
  const { service, db, u1 } = t.context;

  await service.saveStripeInvoice(onetimeMonthlyInvoice);

  let subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  t.truthy(subInDB);

  let end = subInDB!.end!;
  await service.saveStripeInvoice(onetimeMonthlyInvoice);
  subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  // add 30 days
  t.is(subInDB!.end!.getTime(), end.getTime() + 30 * 24 * 60 * 60 * 1000);

  end = subInDB!.end!;
  await service.saveStripeInvoice(onetimeYearlyInvoice);
  subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  // add 365 days
  t.is(subInDB!.end!.getTime(), end.getTime() + 365 * 24 * 60 * 60 * 1000);

  // make subscription expired
  await db.userSubscription.update({
    where: { id: subInDB!.id },
    data: {
      end: new Date(Date.now() - 1000),
    },
  });
  await service.saveStripeInvoice(onetimeYearlyInvoice);
  subInDB = await db.userSubscription.findFirst({
    where: { userId: u1.id },
  });

  // add 365 days from now
  t.is(
    subInDB?.end?.toDateString(),
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toDateString()
  );
});
