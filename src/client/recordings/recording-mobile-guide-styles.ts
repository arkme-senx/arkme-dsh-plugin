import { arkmeTheme as theme } from '../arkme-theme.js'

export const recordingMobileGuideStyles = `
.arkme-recording-mobile-guide {
  position:fixed; inset:0; z-index:10300; display:grid; place-items:center; padding:16px;
  box-sizing:border-box; background:var(--dsw-alias-bg-mask-1, rgba(19,22,26,.34));
  backdrop-filter:var(--dsw-mask-blur, blur(2px));
  -webkit-backdrop-filter:var(--dsw-mask-blur, blur(2px));
  color:${theme.text}; font-family:inherit; font-size:14px; line-height:1.5;
}
.arkme-recording-mobile-guide *, .arkme-recording-mobile-guide *::before, .arkme-recording-mobile-guide *::after { box-sizing:border-box; }
.arkme-recording-mobile-guide .guide-dialog {
  width:min(480px, 100%); min-width:0; max-height:calc(100dvh - 32px); overflow-y:auto;
  overscroll-behavior:contain; padding:22px; background:${theme.base}; border:1px solid ${theme.border};
  border-radius:16px; box-shadow:${theme.shadow};
}
.arkme-recording-mobile-guide .guide-header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.arkme-recording-mobile-guide h2 { font-size:18px; line-height:26px; font-weight:650; margin:0; }
.arkme-recording-mobile-guide button { display:inline-flex; align-items:center; justify-content:center; gap:5px; font:inherit; cursor:pointer; }
.arkme-recording-mobile-guide button:focus-visible { outline:2px solid ${theme.accent}; outline-offset:3px; }
.arkme-recording-mobile-guide .guide-close { flex:none; width:30px; height:30px; padding:0; color:${theme.secondary}; background:transparent; border:0; border-radius:7px; }
.arkme-recording-mobile-guide .guide-close:hover, .arkme-recording-mobile-guide .guide-controls button:hover { background:${theme.hover}; }
.arkme-recording-mobile-guide .guide-description { margin:5px 0 0; color:${theme.secondary}; font-size:13px; }
.arkme-recording-mobile-guide .guide-stage { margin:22px 0 16px; display:flex; justify-content:center; }
.arkme-recording-mobile-guide .guide-demo {
  position:relative; flex:none; width:252px; height:314px; overflow:hidden;
  border:1px solid #e6e9ee; border-radius:12px; background:#fff; color:#424852;
  font-family:inherit; font-size:10px; text-align:left; isolation:isolate;
}
.arkme-recording-mobile-guide .guide-home, .arkme-recording-mobile-guide .guide-record-page { position:absolute; inset:0; background:#fff; }
.arkme-recording-mobile-guide .guide-phone-header { height:36px; padding:0 12px; display:flex; align-items:center; justify-content:space-between; font-size:11px; }
.arkme-recording-mobile-guide .guide-phone-header span { display:flex; align-items:center; gap:7px; font-weight:600; }
.arkme-recording-mobile-guide .guide-messages { padding:7px 13px; }
.arkme-recording-mobile-guide .guide-messages > small { display:block; text-align:center; color:#aab0b8; font-size:8px; }
.arkme-recording-mobile-guide .guide-message { display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-top:18px; }
.arkme-recording-mobile-guide .guide-message span { width:95px; height:24px; background:#f3f4f6; border-radius:6px; }
.arkme-recording-mobile-guide .guide-message:nth-child(3) span { width:125px; }
.arkme-recording-mobile-guide .guide-message i { width:20px; height:20px; border-radius:50%; background:#eef1f4; border:1px solid #e6e9ee; }
.arkme-recording-mobile-guide .guide-compose { position:absolute; left:0; right:0; bottom:0; }
.arkme-recording-mobile-guide .guide-tools-window { overflow:hidden; padding:8px 0; }
.arkme-recording-mobile-guide .guide-tools-track { display:flex; gap:6px; width:max-content; padding:0 10px; }
.arkme-recording-mobile-guide .guide-tools-track > span { position:relative; flex:none; width:59px; height:25px; display:flex; align-items:center; justify-content:center; gap:4px; border:1px solid #e9ebef; border-radius:6px; white-space:nowrap; font-size:9px; }
.arkme-recording-mobile-guide .guide-input { margin:0 9px; padding:0 10px; height:35px; display:flex; align-items:center; justify-content:space-between; background:#f5f6f7; border-radius:7px; font-size:9px; color:#777f88; }
.arkme-recording-mobile-guide .guide-phone-nav { height:35px; display:flex; align-items:center; justify-content:space-around; font-size:9px; color:#adb2bb; }
.arkme-recording-mobile-guide .guide-phone-nav strong { color:#424852; font-weight:500; }
.arkme-recording-mobile-guide .guide-record-tabs { height:30px; display:flex; justify-content:space-around; align-items:center; color:#a0a6ae; border-top:1px solid #f4f5f7; border-bottom:1px solid #f0f2f5; }
.arkme-recording-mobile-guide .guide-record-tabs span:first-child { color:#626a75; border-bottom:1px solid #969eaa; line-height:28px; }
.arkme-recording-mobile-guide .guide-record-empty { position:absolute; top:106px; left:0; right:0; display:flex; align-items:center; flex-direction:column; gap:7px; }
.arkme-recording-mobile-guide .guide-record-empty strong { font-size:10px; font-weight:500; color:#89919b; }
.arkme-recording-mobile-guide .guide-record-empty small { font-size:8px; color:#acb2ba; }
.arkme-recording-mobile-guide .guide-empty-lines { display:grid; gap:5px; width:34px; padding:9px 0; }
.arkme-recording-mobile-guide .guide-empty-lines i { height:3px; border-radius:3px; background:#edf0f3; }
.arkme-recording-mobile-guide .guide-empty-lines i:last-child { width:23px; }
.arkme-recording-mobile-guide .guide-recording-status { position:absolute; bottom:0; left:0; right:0; min-height:53px; display:flex; align-items:center; gap:7px; padding:9px; border-top:1px solid #f0f2f5; background:#fff; box-shadow:0 -5px 18px #253a5010; }
.arkme-recording-mobile-guide .guide-microphone { position:relative; flex:none; display:grid; place-items:center; width:31px; height:31px; border:1px solid #e9ebef; border-radius:50%; background:#f5f6f7; color:#747d87; }
.arkme-recording-mobile-guide .guide-status-copy { min-width:0; }
.arkme-recording-mobile-guide .guide-status-copy strong { display:flex; align-items:center; gap:4px; font-size:9px; font-weight:500; white-space:nowrap; }
.arkme-recording-mobile-guide .guide-status-copy strong i { width:4px; height:4px; border-radius:50%; background:#bec4ca; }
.arkme-recording-mobile-guide .guide-status-copy small { display:block; margin-top:3px; font-size:8px; color:#9da5af; font-variant-numeric:tabular-nums; }
.arkme-recording-mobile-guide .is-recording .guide-microphone { background:#ec4854; color:#fff; border-color:#ec4854; }
.arkme-recording-mobile-guide .is-recording .guide-status-copy strong i { background:#54c989; box-shadow:0 0 0 2px #54c9891a; }
.arkme-recording-mobile-guide .guide-wave { display:flex; align-items:center; gap:2px; height:18px; margin-left:auto; }
.arkme-recording-mobile-guide .guide-wave i { width:2px; height:15px; border-radius:2px; background:#64c994; }
.arkme-recording-mobile-guide .guide-tap { position:absolute; width:28px; height:28px; left:50%; top:50%; margin:-14px 0 0 -14px; z-index:4; border:1.5px solid #658bc7; border-radius:50%; background:#7398dc22; pointer-events:none; }
.arkme-recording-mobile-guide .guide-swipe { position:absolute; left:148px; bottom:74px; width:70px; height:25px; pointer-events:none; }
.arkme-recording-mobile-guide .guide-swipe i { position:absolute; right:0; top:4px; width:18px; height:18px; border-radius:50%; border:1.5px solid #658bc7; background:#e8f0fdc9; }
.arkme-recording-mobile-guide .guide-swipe span { position:absolute; top:12px; left:0; width:57px; height:1.5px; background:linear-gradient(90deg,#7195ca,#89a4ca11); }
.arkme-recording-mobile-guide .guide-swipe span::before { content:''; position:absolute; left:0; top:-3px; width:7px; height:7px; border-left:1.5px solid #7195ca; border-bottom:1.5px solid #7195ca; transform:rotate(45deg); }
.arkme-recording-mobile-guide .guide-home { animation:arkme-record-guide-home 10s both paused; }
.arkme-recording-mobile-guide .guide-record-page { animation:arkme-record-guide-page 10s both paused; }
.arkme-recording-mobile-guide .guide-tools-track { animation:arkme-record-guide-tools 10s both paused; }
.arkme-recording-mobile-guide .guide-swipe { animation:arkme-record-guide-swipe 10s both paused; }
.arkme-recording-mobile-guide .guide-entry-tap { animation:arkme-record-guide-entry 10s linear both paused; }
.arkme-recording-mobile-guide .guide-microphone-tap { animation:arkme-record-guide-mic 10s linear both paused; }
.arkme-recording-mobile-guide .guide-demo * { animation-delay:var(--guide-time); }
@keyframes arkme-record-guide-home { 0%,30% { transform:translateX(0); } 38%,100% { transform:translateX(-35%); } }
@keyframes arkme-record-guide-page { 0%,30% { transform:translateX(100%); } 38%,100% { transform:translateX(0); } }
@keyframes arkme-record-guide-tools { 0%,5% { transform:translateX(0); } 19%,100% { transform:translateX(-83px); } }
@keyframes arkme-record-guide-swipe { 0%,4% { opacity:0; transform:translateX(0); } 8% { opacity:1; } 17% { opacity:1; transform:translateX(-57px); } 20%,100% { opacity:0; transform:translateX(-57px); } }
@keyframes arkme-record-guide-entry { 0%,19%,31%,100% { opacity:0; transform:scale(1); } 21%,29% { opacity:1; transform:scale(1); } 25% { opacity:.65; transform:scale(.76); } }
@keyframes arkme-record-guide-mic { 0%,40%,60%,100% { opacity:0; transform:scale(1); } 43%,53% { opacity:1; transform:scale(1); } 48%,58% { opacity:.65; transform:scale(.76); } }
.arkme-recording-mobile-guide .guide-step { display:flex; align-items:center; justify-content:center; gap:7px; margin:0; font-size:13px; line-height:22px; }
.arkme-recording-mobile-guide .guide-step > span, .arkme-recording-mobile-guide .guide-static-steps p > span { display:inline-grid; flex:none; place-items:center; width:19px; height:19px; border-radius:50%; background:${theme.layer2}; color:${theme.secondary}; font-size:11px; }
.arkme-recording-mobile-guide .guide-progress { display:flex; justify-content:center; gap:6px; margin-top:12px; }
.arkme-recording-mobile-guide .guide-progress i { width:5px; height:5px; border-radius:5px; background:${theme.border}; }
.arkme-recording-mobile-guide .guide-progress .is-current { width:15px; background:${theme.text}; }
.arkme-recording-mobile-guide .guide-note { margin:18px 0 12px; font-size:12px; color:${theme.tertiary}; text-align:center; }
.arkme-recording-mobile-guide .guide-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; border-top:1px solid ${theme.borderSoft}; padding-top:14px; }
.arkme-recording-mobile-guide .guide-controls { display:flex; gap:2px; }
.arkme-recording-mobile-guide .guide-controls button { border:0; border-radius:7px; height:32px; padding:0 8px; font-size:12px; color:${theme.secondary}; background:transparent; }
.arkme-recording-mobile-guide .guide-done { height:34px; padding:0 14px; margin-left:auto; border:1px solid ${theme.border}; border-radius:8px; background:${theme.primaryAction}; color:${theme.onPrimaryAction}; font-size:13px; }
.arkme-recording-mobile-guide .guide-accessible { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip-path:inset(50%); }
.arkme-recording-mobile-guide .guide-static-steps { display:grid; gap:14px; margin:20px 0 0; padding:0; list-style:none; }
.arkme-recording-mobile-guide .guide-static-preview { position:relative; width:min(252px,100%); height:62px; margin:0 auto; overflow:hidden; border:1px solid #e6e9ee; border-radius:9px; background:#fff; color:#424852; }
.arkme-recording-mobile-guide .guide-static-preview .guide-tap { display:none; }
.arkme-recording-mobile-guide .guide-static-entry { display:flex; align-items:center; justify-content:center; gap:12px; height:100%; font-size:10px; }
.arkme-recording-mobile-guide .guide-static-entry > span, .arkme-recording-mobile-guide .guide-static-entry strong { display:flex; align-items:center; gap:4px; }
.arkme-recording-mobile-guide .guide-static-entry strong { padding:6px 9px; border:1px solid #a9bfea; border-radius:6px; font-weight:500; }
.arkme-recording-mobile-guide .guide-static-steps p { display:flex; justify-content:center; align-items:center; gap:7px; font-size:12px; margin:8px 0 0; }
@media (max-width:380px) {
  .arkme-recording-mobile-guide { padding:10px; }
  .arkme-recording-mobile-guide .guide-dialog { padding:16px; max-height:calc(100dvh - 20px); }
  .arkme-recording-mobile-guide h2 { font-size:16px; }
  .arkme-recording-mobile-guide .guide-stage { margin-top:16px; }
}
@media (prefers-reduced-motion:reduce) { .arkme-recording-mobile-guide * { animation:none!important; transition:none!important; } }
`
