// Share one IM instance with the call engine. Never perform a second login.
export function createIMBridge(Chat, sdkAppId, userId, emit) {
  const chat = Chat.create({ SDKAppID: sdkAppId });
  let disposed = false;
  const listeners = [];
  const on = (event, callback) => { chat.on(event, callback); listeners.push([event, callback]); };
  on(Chat.EVENT.SDK_READY, () => {
    if (disposed || chat.getLoginUser() !== userId) return;
    emit('im_ready', { registrationId: userId });
  });
  on(Chat.EVENT.KICKED_OUT, () => { emit('im_kicked', { reason: 'kicked_out' }); });
  return {
    chat,
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const [event, callback] of listeners) chat.off(event, callback);
      await chat.destroy();
    },
  };
}

// The legacy call serializer intentionally drops unknown fields. Explicitly
// project IM payloads so credentials and arbitrary SDK objects never cross it.
export function imBridgePayload(type, extra) {
  if (type !== 'im_ready' || typeof extra.registrationId !== 'string') return {};
  return { registrationId: extra.registrationId };
}
