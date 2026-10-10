import { useEffect, useRef, useSyncExternalStore } from 'react';
import { migrationDownloadProgress } from '../app-migration-shared.js';
import { appMigrationStore } from './app-migration-store.js';
import jiwoAppIconBase64 from '../../assets/branding/jiwo-app-icon.png';
export function AppMigrationDialog() {
    const view = useSyncExternalStore(appMigrationStore.subscribe, appMigrationStore.getSnapshot, appMigrationStore.getSnapshot);
    const container = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!view.visible)
            return;
        const previous = document.activeElement as HTMLElement | null;
        container.current?.focus();
        return () => previous?.focus();
    }, [view.visible]);
    if (!view.visible)
        return null;
    const s = view.status, phase = s?.phase, target = s?.target;
    const downloading = phase === 'downloading', done = phase === 'completed', failed = phase === 'failed' || view.error !== '';
    const text = failed ? (view.error || s?.error || '下载失败，请重试') : done ? <>安装包 <span style={{ color: '#2563eb' }}>{s?.fileName}</span> 已保存到下载文件夹，点击“开始安装”继续。</> : downloading ? '正在下载安装包' : '下载完成后，请手动运行安装包完成升级。';
    const dismiss = () => { void appMigrationStore.dismiss(); };
    return <div className="jiwo-migration-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(16,20,28,.42)' }}>
  <style>{`
    .jiwo-migration-overlay .jiwo-migration-button {
      appearance: none; min-height: 40px; padding: 0 18px; border: 1px solid transparent;
      border-radius: 10px; font: inherit; font-size: 14px; font-weight: 500;
      cursor: pointer; transition: background-color .15s, opacity .15s;
    }
    .jiwo-migration-overlay .jiwo-migration-close {
      position: absolute; top: 18px; right: 18px; width: 32px; min-height: 32px;
      padding: 0; display: grid; place-items: center; background: transparent; color: #606670;
    }
    .jiwo-migration-overlay .jiwo-migration-close:hover:not(:disabled) { background: #f0f1f3; }
    .jiwo-migration-overlay .jiwo-migration-secondary { background: #f0f1f3; color: #30343b; }
    .jiwo-migration-overlay .jiwo-migration-secondary:hover:not(:disabled) { background: #e3e5e9; }
    .jiwo-migration-overlay .jiwo-migration-primary { background: #17191c; color: #fff; }
    .jiwo-migration-overlay .jiwo-migration-primary:hover:not(:disabled) { background: #34383f; }
    .jiwo-migration-overlay .jiwo-migration-outline { background: transparent; color: #606670; border-color: #c9cdd3; }
    .jiwo-migration-overlay .jiwo-migration-outline:hover:not(:disabled) { background: #f0f1f3; }
    .jiwo-migration-overlay .jiwo-migration-button:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
    .jiwo-migration-overlay .jiwo-migration-button:disabled { opacity: .45; cursor: default; }
  `}</style>
  <div ref={container} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="jiwo-migration-title" onKeyDown={event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                dismiss();
            }
            if (event.key === 'Tab') {
                const items = container.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
                if (!items?.length)
                    return;
                const first = items[0]!, last = items[items.length - 1]!;
                if (event.shiftKey && (document.activeElement === first || document.activeElement === container.current)) {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }} style={{ position: 'relative', width: 'min(440px,100%)', boxSizing: 'border-box', padding: 28, borderRadius: 20, background: 'var(--dsw-alias-bg-base,#fff)', color: 'var(--dsw-alias-label-primary,#17191c)', boxShadow: '0 24px 72px #0003' }}>
   {(done || failed) && <button type="button" className="jiwo-migration-button jiwo-migration-close" aria-label="关闭" onClick={dismiss} disabled={view.busy}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
   </button>}
   <h2 id="jiwo-migration-title" style={{ fontSize: 20, margin: '0 0 16px', paddingRight: done || failed ? 30 : 0 }}>{done ? '安装包已就绪，待安装' : failed ? '升级下载失败' : `即我 ${target?.version?.replace(/\.0$/, '') ?? '3.0'} 已发布`}</h2>
   <p style={{ overflowWrap: 'anywhere', lineHeight: 1.6 }} role={failed ? 'alert' : undefined} aria-live="polite">{text}</p>
   {downloading && <div><progress aria-label="安装包下载进度" value={s?.totalBytes ? s.downloadedBytes : undefined} max={s?.totalBytes ?? 1} style={{ width: '100%' }}/><p>{migrationDownloadProgress(s)}</p></div>}
   {done && <>
    <div style={{ padding: 14, marginTop: 20, borderRadius: 12, background: '#FFF1F0' }}>
     <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: '#d32f2f' }}>
     <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M10.3 3.4a2 2 0 0 1 3.4 0l8.1 14a2 2 0 0 1-1.7 3H3.9a2 2 0 0 1-1.7-3z" fill="currentColor" />
      <path d="M12 8v5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.1" fill="#fff" />
     </svg>
     <p style={{ margin: 0, lineHeight: 1.6 }}>本次更新安装完成后，Arkme 快捷方式将移除，后续请使用「即我」快捷方式启动应用。</p>
    </div>
    <figure style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, margin: '20px 0 4px' }}>
     <img src={`data:image/png;base64,${jiwoAppIconBase64}`} alt="即我应用图标" width={80} height={80} style={{ display: 'block', objectFit: 'contain' }} />
     <figcaption style={{ fontSize: 14 }}>即我</figcaption>
    </figure>
    </div>
   </>}
   <div style={{ display: 'flex', justifyContent: done ? 'center' : 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
    {!done && !failed && <button type="button" className="jiwo-migration-button jiwo-migration-secondary" onClick={dismiss} disabled={view.busy}>{downloading ? '后台下载' : '稍后提醒'}</button>}
    {done && <button type="button" className="jiwo-migration-button jiwo-migration-secondary" disabled={view.busy} onClick={() => { void appMigrationStore.action('reveal'); }}>打开安装包所在目录</button>}
    {<button type="button" className={`jiwo-migration-button ${downloading ? 'jiwo-migration-outline' : 'jiwo-migration-primary'}`} disabled={view.busy} onClick={() => { if (failed && !target)
        void appMigrationStore.refresh(true, true);
    else
        void appMigrationStore.action(done ? 'install' : downloading ? 'cancel' : 'download'); }}>{done ? '开始安装' : downloading ? '取消下载' : failed ? '重试' : '下载安装包'}</button>}
   </div>
  </div>
 </div>;
}
