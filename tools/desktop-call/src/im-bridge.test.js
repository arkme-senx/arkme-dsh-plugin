import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createIMBridge, imBridgePayload } from './im-bridge.js';
test('shared IM observes identity readiness and kick only, and cleans up listeners', async () => {
  const handlers = new Map(), events = []; let loginUser = 'other', destroyed = false;
  const chat = { on: (key, fn) => handlers.set(key, fn), off: key => handlers.delete(key),
    getLoginUser: () => loginUser, destroy: async () => { destroyed = true; } };
  const Chat = { create: () => chat, EVENT: { SDK_READY: 'ready', KICKED_OUT: 'kicked', MESSAGE_RECEIVED: 'message' } };
  const bridge = createIMBridge(Chat, 123, 'alice__cz', (...args) => events.push(args));
  assert.equal(bridge.chat, chat); assert.equal(handlers.size, 2);
  assert.equal(handlers.has('message'), false); assert.equal('send' in bridge, false);
  handlers.get('ready')(); assert.equal(events.length, 0);
  loginUser = 'alice__cz'; handlers.get('ready')();
  assert.deepEqual(events[0], ['im_ready', { registrationId: 'alice__cz' }]);
  handlers.get('kicked')(); assert.equal(events.at(-1)[0], 'im_kicked');
  await bridge.dispose(); assert.equal(handlers.size, 0); assert.equal(destroyed, true);
});
test('registration bridge preserves only the login identity', () => {
  assert.deepEqual(imBridgePayload('im_ready', {registrationId:'alice__cz', userSig:'secret', data:'payload'}), {registrationId:'alice__cz'});
  assert.deepEqual(imBridgePayload('im_message', {sender:'peer', data:'payload'}), {});
});
