import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('./auth.js', import.meta.url), 'utf8');
const authenticate = runInNewContext(source + '\n authenticate;');

test('valid demo credentials succeed', () => {
  assert.equal(authenticate('demo@example.test', 'Demo123!'), true);
});
test('email is normalized', () => {
  assert.equal(authenticate(' DEMO@example.test ', 'Demo123!'), true);
});
test('wrong credentials are rejected', () => {
  assert.equal(authenticate('other@example.test', 'Demo123!'), false);
  assert.equal(authenticate('demo@example.test', 'wrong'), false);
});
test('password remains case-sensitive and is not trimmed', () => {
  for (const password of ['demo123!', 'DEMO123!', ' Demo123!', 'Demo123! ']) {
    assert.equal(authenticate('demo@example.test', password), false);
  }
});
