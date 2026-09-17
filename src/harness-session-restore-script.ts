/**
 * The outer runtime and native iframe share an origin, but own different stores.
 * An outer pending-list projection can overwrite the native boot key with {}.
 * Route only this iframe's official selection read to the parent preload cache;
 * do not change other keys, sessionStorage, writes, or the upstream runtime.
 * This must precede every boot script, including asynchronously loaded modules.
 */
export const HARNESS_SESSION_RESTORE_SCRIPT = `(() => {
  const bridge = window.parent?.arkmeDesktop?.sessionSelection;
  if (typeof bridge?.restore !== 'function') return;
  const storage = window.localStorage;
  const getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = function(key) {
    if (this === storage && key === 'dsh.sessions.current') return bridge.restore();
    return getItem.call(this, key);
  };
})();`
