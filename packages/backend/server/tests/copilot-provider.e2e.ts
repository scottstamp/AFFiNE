/// <reference types="../src/global.d.ts" />

import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import type { ExecutionContext, TestFn } from 'ava';
import ava from 'ava';

import { automaticSignIn, createWorkspace } from './utils';
import {
  chatWithImages,
  chatWithText,
  createCopilotMessage,
  createCopilotSession,
  ProviderActionTestCase,
  sse2array,
} from './utils/copilot';

type Tester = {
  app: INestApplication<any>;
  userToken: string;
  workspaceId: string;
};
const test = ava as TestFn<Tester>;

const e2eConfig = {
  endpoint: process.env.COPILOT_E2E_ENDPOINT || 'http://localhost:3010',
  user: process.env.COPILOT_E2E_USER || 'dev@affine.pro',
  password: process.env.COPILOT_E2E_PASSWORD || 'dev',
  secret: process.env.COPILOT_E2E_SECRET || 'affine',
};

test.before(async t => {
  const { endpoint, user, password, secret } = e2eConfig;
  const app = { getHttpServer: () => endpoint } as INestApplication<any>;
  const token = await automaticSignIn(app, user, password, secret);
  const { id } = await createWorkspace(app, token);

  t.context.app = app;
  t.context.userToken = token;
  t.context.workspaceId = id;
});

const retry = async (
  action: string,
  t: ExecutionContext<Tester>,
  callback: (t: ExecutionContext<Tester>) => void
) => {
  let i = 3;
  while (i--) {
    const ret = await t.try(callback);
    if (ret.passed) {
      return ret.commit();
    } else {
      ret.discard();
      t.log(ret.errors.map(e => e.message).join('\n'));
      t.log(`retrying ${action} ${3 - i}/3 ...`);
    }
  }
  t.fail(`failed to run ${action}`);
};

// ==================== action ====================

for (const { promptName, messages, verifier, type } of ProviderActionTestCase) {
  const prompts = Array.isArray(promptName) ? promptName : [promptName];
  for (const promptName of prompts) {
    test(`should be able to run action: ${promptName}`, async t => {
      await retry(`action: ${promptName}`, t, async t => {
        // @ts-expect-error
        const { content, attachments, params } = messages[0];
        const { app, userToken, workspaceId } = t.context;
        const sessionId = await createCopilotSession(
          app,
          userToken,
          workspaceId,
          randomUUID(),
          promptName
        );
        const messageId = await createCopilotMessage(
          app,
          userToken,
          sessionId,
          content,
          attachments,
          undefined,
          params
        );

        if (type === 'text') {
          const result = await chatWithText(
            app,
            userToken,
            sessionId,
            messageId
          );
          t.truthy(result, 'should return result');
          verifier?.(t, result);
        } else if (type === 'image') {
          const result = sse2array(
            await chatWithImages(app, userToken, sessionId, messageId)
          )
            .filter(e => e.event !== 'event')
            .map(e => e.data)
            .filter(Boolean);
          t.truthy(result.length, 'should return result');
          for (const r of result) {
            verifier?.(t, r);
          }
        } else {
          t.fail('unsupported provider type');
        }
      });
    });
  }
}
