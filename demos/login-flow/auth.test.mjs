import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('./auth.js', import.meta.url), 'utf8');
const authenticate = runInNewContext(source + '\n authenticate;');

test('valid demo credentials succeed', () => {
  assert.equal(authenticate('mouad@capitola.nl', 'Mouad123'), true);
});
test('email is normalized', () => {
  assert.equal(authenticate(' mouad@capitola.nl ', 'Mouad123'), true);
});
test('wrong credentials are rejected', () => {
  assert.equal(authenticate('other@example.test', 'Mouad123'), false);
  assert.equal(authenticate('mouad@capitola.nl', 'wrong'), false);
});
test('password remains case-sensitive and is not trimmed', () => {
  for (const password of ['mouad123', 'MOUAD123', ' Mouad123', 'Mouad123 ']) {
    assert.equal(authenticate('mouad@capitola.nl', password), false);
  }
});
