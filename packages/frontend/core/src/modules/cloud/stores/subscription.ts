import type {
  CreateCheckoutSessionInput,
  SubscriptionRecurring,
} from '@affine/graphql';
import {
  cancelSubscriptionMutation,
  createCheckoutSessionMutation,
  pricesQuery,
  resumeSubscriptionMutation,
  SubscriptionPlan,
  subscriptionQuery,
  updateSubscriptionMutation,
} from '@affine/graphql';
import type { GlobalCache } from '@toeverything/infra';
import { Store } from '@toeverything/infra';

import type { UrlService } from '../../url';
import type { SubscriptionType } from '../entities/subscription';
import type { GraphQLService } from '../services/graphql';
import type { ServerService } from '../services/server';

const SUBSCRIPTION_CACHE_KEY = 'subscription:';

const getDefaultSubscriptionSuccessCallbackLink = (
  baseUrl: string,
  plan?: SubscriptionPlan | null,
  scheme?: string
) => {
  const path =
    plan === SubscriptionPlan.AI ? '/ai-upgrade-success' : '/upgrade-success';
  const urlString = baseUrl + path;
  const url = new URL(urlString);
  if (scheme) {
    url.searchParams.set('scheme', scheme);
  }
  return url.toString();
};

export class SubscriptionStore extends Store {
  constructor(
    private readonly gqlService: GraphQLService,
    private readonly globalCache: GlobalCache,
    private readonly urlService: UrlService,
    private readonly serverService: ServerService
  ) {
    super();
  }

  async fetchSubscriptions(abortSignal?: AbortSignal) {
    const data = await this.gqlService.gql({
      query: subscriptionQuery,
      context: {
        signal: abortSignal,
      },
    });

    if (!data.currentUser) {
      throw new Error('No logged in');
    }

    return {
      userId: data.currentUser?.id,
      subscriptions: data.currentUser?.subscriptions,
    };
  }

  async mutateResumeSubscription(
    idempotencyKey: string,
    plan?: SubscriptionPlan,
    abortSignal?: AbortSignal
  ) {
    const data = await this.gqlService.gql({
      query: resumeSubscriptionMutation,
      variables: {
        plan,
      },
      context: {
        signal: abortSignal,
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    });
    return data.resumeSubscription;
  }

  async mutateCancelSubscription(
    idempotencyKey: string,
    plan?: SubscriptionPlan,
    abortSignal?: AbortSignal
  ) {
    const data = await this.gqlService.gql({
      query: cancelSubscriptionMutation,
      variables: {
        plan,
      },
      context: {
        signal: abortSignal,
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    });
    return data.cancelSubscription;
  }

  getCachedSubscriptions(userId: string) {
    return this.globalCache.get<SubscriptionType[]>(
      SUBSCRIPTION_CACHE_KEY + userId
    );
  }

  setCachedSubscriptions(userId: string, subscriptions: SubscriptionType[]) {
    return this.globalCache.set(SUBSCRIPTION_CACHE_KEY + userId, subscriptions);
  }

  setSubscriptionRecurring(
    idempotencyKey: string,
    recurring: SubscriptionRecurring,
    plan?: SubscriptionPlan
  ) {
    return this.gqlService.gql({
      query: updateSubscriptionMutation,
      variables: {
        plan,
        recurring,
      },
      context: {
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      },
    });
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput) {
    const data = await this.gqlService.gql({
      query: createCheckoutSessionMutation,
      variables: {
        input: {
          ...input,
          successCallbackLink:
            input.successCallbackLink ||
            getDefaultSubscriptionSuccessCallbackLink(
              this.serverService.server.baseUrl,
              input.plan,
              this.urlService.getClientScheme()
            ),
        },
      },
    });
    return data.createCheckoutSession;
  }

  async fetchSubscriptionPrices(abortSignal?: AbortSignal) {
    const data = await this.gqlService.gql({
      query: pricesQuery,
      context: {
        signal: abortSignal,
      },
    });

    return data.prices;
  }
}
