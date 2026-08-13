import test from 'node:test';
import assert from 'node:assert/strict';

import { assessProductionConfiguration } from '../services/operationalReadinessService.js';

test('production configuration blocks missing payment and origin settings', () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'a-secure-random-secret-for-tests-only-123456';
  const result = assessProductionConfiguration({ NODE_ENV: 'production', JWT_SECRET: process.env.JWT_SECRET });
  assert.equal(result.ready, false);
  assert.deepEqual(result.blocking, ['frontend_origin', 'xendit_secret', 'xendit_webhook']);
  if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
});

test('development configuration treats external integrations as non-blocking', () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'a-secure-random-secret-for-tests-only-123456';
  const result = assessProductionConfiguration({ NODE_ENV: 'development', JWT_SECRET: process.env.JWT_SECRET });
  assert.equal(result.ready, true);
  if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
});
