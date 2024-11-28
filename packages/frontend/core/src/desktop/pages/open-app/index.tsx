import { GraphQLService } from '@affine/core/modules/cloud';
import { OpenInAppPage } from '@affine/core/modules/open-in-app/views/open-in-app-page';
import { appSchemaUrl, appSchemes, channelToScheme } from '@affine/core/utils';
import type { GetCurrentUserQuery } from '@affine/graphql';
import { getCurrentUserQuery } from '@affine/graphql';
import { useService } from '@toeverything/infra';
import { useEffect, useState } from 'react';
import {
  type LoaderFunction,
  redirect,
  useLoaderData,
  useParams,
} from 'react-router-dom';
import { z } from 'zod';

import { AppContainer } from '../../components/app-container';

const LoaderData = z.object({
  action: z.enum(['url', 'signin-redirect']),
  url: appSchemaUrl,
  params: z.record(z.string()),
});

type LoaderData = z.infer<typeof LoaderData>;

export const loader: LoaderFunction = async args => {
  const action = args.params.action || '';

  try {
    const { url, ...params } = Array.from(
      new URL(args.request.url).searchParams.entries()
    ).reduce(
      (acc, [k, v]) => ((acc[k] = v), acc),
      {} as Record<string, string>
    );

    return LoaderData.parse({ action, url, params });
  } catch (e) {
    console.error(e);
    return redirect('/404');
  }
};

const OpenUrl = () => {
  const { params, url } = useLoaderData() as LoaderData;

  if (!url) {
    return null;
  }

  const urlObj = new URL(url || '');

  Object.entries(params).forEach(([k, v]) => {
    urlObj.searchParams.set(k, v);
  });

  return <OpenInAppPage urlToOpen={urlObj.toString()} />;
};

/**
 * @deprecated
 */
const OpenOAuthJwt = () => {
  const [currentUser, setCurrentUser] = useState<
    GetCurrentUserQuery['currentUser'] | null
  >(null);
  const { params } = useLoaderData() as LoaderData;
  const graphqlService = useService(GraphQLService);

  const maybeScheme = appSchemes.safeParse(params['scheme']);
  const scheme = maybeScheme.success
    ? maybeScheme.data
    : channelToScheme[BUILD_CONFIG.appBuildType];

  useEffect(() => {
    graphqlService
      .gql({
        query: getCurrentUserQuery,
      })
      .then(res => {
        setCurrentUser(res?.currentUser || null);
      })
      .catch(console.error);
  }, [graphqlService]);

  if (!currentUser || !currentUser?.token?.sessionToken) {
    return <AppContainer fallback />;
  }

  const urlToOpen = `${scheme}://signin-redirect?token=${
    currentUser.token.sessionToken
  }&next=${params['next'] || ''}`;

  return <OpenInAppPage urlToOpen={urlToOpen} />;
};

export const Component = () => {
  const params = useParams<{ action: string }>();
  const action = params.action || '';

  if (action === 'url') {
    return <OpenUrl />;
  } else if (action === 'signin-redirect') {
    return <OpenOAuthJwt />;
  }
  return null;
};
