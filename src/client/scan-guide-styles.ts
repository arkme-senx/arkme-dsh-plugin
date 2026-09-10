export const scanGuideStyles = `

.dsh-arkme-login-qr-panel:has(.arkme-scan-guide) { position:relative; width:100%; padding-bottom:8px; }
.arkme-scan-guide { order:3; width:184px; margin-top:14px; text-align:center; }
.arkme-scan-guide-trigger { display:inline-block; background:none; border:0; border-bottom:1px solid transparent; padding:4px 2px 5px; font:inherit; font-size:13px; line-height:18px; color:var(--arkme-login-secondary); cursor:pointer; }
.arkme-scan-guide-trigger:hover { border-bottom-color:currentColor; }
.arkme-scan-guide-trigger:focus-visible { outline:2px solid var(--arkme-login-accent); outline-offset:3px; border-radius:3px; }
.arkme-scan-guide-content { position:absolute; top:48px; left:218px; width:160px; pointer-events:none; }
.arkme-scan-guide .guide-animation-frame { width:160px; height:160px; margin:0 auto; }
.arkme-scan-guide .guide-animation-frame .clean-demo { transform:none; }
.arkme-scan-guide .guide-step { margin-top:5px; font-size:11px; line-height:22px; color:var(--arkme-login-secondary); }
.arkme-scan-guide .guide-note { margin-top:8px; font-size:10px; line-height:16px; color:var(--arkme-login-caption); }
.arkme-scan-guide .guide-accessible { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
@media(max-width:1100px) { .arkme-scan-guide-content { left:auto; right:0; } }
@media(max-width:390px) { .arkme-scan-guide-content { position:relative; top:auto; right:auto; margin-top:12px; } }
@media(prefers-reduced-motion:reduce) { .arkme-scan-guide * { animation:none!important; transition:none!important; } }
.arkme-scan-guide .clean-demo { width:160px;height:160px;position:relative;overflow:hidden;border:1px solid #e6e8ec;border-radius:8px;background:#fff;color:#222;font-family:"Microsoft YaHei",sans-serif;text-align:left }
.arkme-scan-guide .demo-home { position:absolute;inset:0;background:#fff;transition:transform .65s ease }
.arkme-scan-guide .demo-bar { height:29px;display:flex;align-items:center;justify-content:space-between;padding:0 7px;font-size:10px;font-weight:600;border-bottom:1px solid #f6f6f7 }
.arkme-scan-guide .demo-bar svg { width:12px;height:12px }
.arkme-scan-guide .home-title { display:flex;align-items:center;gap:4px }
.arkme-scan-guide .home-tools { display:flex;gap:9px }
.arkme-scan-guide .demo-bubbles { padding:6px 7px }
.arkme-scan-guide .demo-date { text-align:center;font-size:6px;color:#b7bbc1;margin:7px }
.arkme-scan-guide .bubble-row { display:flex;align-items:center;justify-content:flex-end;gap:5px;margin:11px 0 }
.arkme-scan-guide .bubble-row i { width:49px;height:16px;background:#f4f5f7;border-radius:5px }
.arkme-scan-guide .bubble-row:nth-child(3) i { width:68px }
.arkme-scan-guide .avatar { display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:#e8f3ed;color:#64a77d;flex-shrink:0 }
.arkme-scan-guide .avatar svg { width:10px;height:10px }
.arkme-scan-guide .demo-shade { position:absolute;inset:0;background:#0004;opacity:0;transition:opacity .65s }
.arkme-scan-guide .demo-list { position:absolute;inset:0 auto 0 0;width:140px;background:#fff;transform:translateX(-143px);transition:transform .65s ease;box-shadow:2px 0 4px #00000008 }

.arkme-scan-guide .demo-plus { width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:400;border-radius:4px }






.arkme-scan-guide .demo-menu { display:none;position:absolute;top:28px;right:20px;width:91px;padding:3px 4px;background:#fff;border:1px solid #edf0f3;border-radius:7px;box-shadow:0 3px 12px #0002;font-size:9px }
.arkme-scan-guide .demo-menu>div { height:27px;display:flex;align-items:center;gap:6px;padding:0 4px }
.arkme-scan-guide .demo-menu svg { width:12px;height:12px;flex-shrink:0 }
.arkme-scan-guide .scan-target { border-radius:4px;background:#edf4ff;color:#265db1;font-weight:600 }
.arkme-scan-guide .swipe-cue { position:absolute;left:23px;top:106px;width:105px;height:31px;z-index:4;color:#537ccc }
.arkme-scan-guide .swipe-track { position:absolute;left:0;top:14px;width:85px;height:2px;background:linear-gradient(90deg,#81a9ea22,#618fe0) }
.arkme-scan-guide .swipe-track:after { content:'';position:absolute;right:0;top:-3px;width:7px;height:7px;border-top:2px solid #618fe0;border-right:2px solid #618fe0;transform:rotate(45deg) }
.arkme-scan-guide .swipe-finger { position:absolute;left:0;top:3px;width:22px;height:22px;background:#6996e52b;border:2px solid #648fda;border-radius:50%;animation:arkme-guide-slide 1.6s 1 both }
.arkme-scan-guide .tap-ring { display:none;position:absolute;width:25px;height:25px;border:2px solid #658bd0;border-radius:50%;background:#7596d912;animation:arkme-guide-tap 1.1s infinite;pointer-events:none }
.arkme-scan-guide .clean-demo.reveal .demo-list { transform:translateX(0) }
.arkme-scan-guide .clean-demo.reveal .demo-home { transform:translateX(140px) }
.arkme-scan-guide .clean-demo.reveal .demo-shade { opacity:1 }
.arkme-scan-guide .clean-demo[data-phase="1"] .swipe-cue, .arkme-scan-guide .clean-demo[data-phase="2"] .swipe-cue { display:none }
.arkme-scan-guide .clean-demo[data-phase="1"] .demo-plus { background:#eaf1fe;color:#315fa8 }
.arkme-scan-guide .clean-demo[data-phase="1"] .tap-ring { display:block;left:110px;top:1px }
.arkme-scan-guide .clean-demo[data-phase="2"] .demo-menu { display:block }
.arkme-scan-guide .clean-demo[data-phase="2"] .tap-ring { display:block;left:104px;top:110px }
.arkme-scan-guide .clean-demo.resetting .demo-home, .arkme-scan-guide .clean-demo.resetting .demo-list, .arkme-scan-guide .clean-demo.resetting .demo-shade { transition:none }
.arkme-scan-guide .clean-demo.resetting .swipe-finger { animation:none }
.arkme-scan-guide .clean-demo.reveal .swipe-cue { display:none }
.arkme-scan-guide .demo-home, .arkme-scan-guide .demo-list { background:#fffcff }
.arkme-scan-guide .demo-bar { height:27px;padding:0 6px;font-size:10px;border-bottom:0 }
.arkme-scan-guide .demo-list .demo-bar { font-weight:600 }
.arkme-scan-guide .demo-list { width:140px }














.arkme-scan-guide .demo-menu { top:25px;right:18px;width:91px;border-color:#f3eff5;box-shadow:0 4px 12px #39294118;border-radius:8px;padding:2px 5px;color:#332d37 }
.arkme-scan-guide .demo-menu:before { content:'';position:absolute;right:6px;top:-5px;width:8px;height:8px;background:#fff;border-left:1px solid #f3eff5;border-top:1px solid #f3eff5;transform:rotate(45deg) }
.arkme-scan-guide .demo-menu>div { height:27px;font-size:9px;gap:6px;padding:0 3px;border-bottom:1px solid #f7f4f8 }
.arkme-scan-guide .demo-menu>div:last-child { border-bottom:0 }
.arkme-scan-guide .demo-menu svg { width:13px;height:13px;stroke-width:1.15 }
.arkme-scan-guide .scan-target { background:#edf3fe }
.arkme-scan-guide .clean-demo[data-phase="1"] .tap-ring { left:110px;top:0 }
.arkme-scan-guide .clean-demo[data-phase="2"] .tap-ring { left:108px;top:105px }
.arkme-scan-guide .simple-row { height:37px;margin:0 8px;display:flex;align-items:center;gap:7px }
.arkme-scan-guide .simple-avatar { width:18px;height:18px;background:#eef0f4;border-radius:50%;flex-shrink:0 }
.arkme-scan-guide .simple-row>div { font-size:9px;color:#606570 }
.arkme-scan-guide .simple-row i { display:block;width:56px;height:3px;border-radius:3px;background:#eff0f3;margin-top:5px }
.arkme-scan-guide .demo-list .demo-bar { height:33px;border-bottom:1px solid #f3f3f5 }
.arkme-scan-guide .demo-menu>div:not(.scan-target) { color:#a1a4aa }
.arkme-scan-guide .demo-menu .scan-target { font-size:10px }
.arkme-scan-guide .clean-demo[data-phase="1"] .tap-ring { top:3px }
.arkme-scan-guide .demo-menu { top:31px }
.arkme-scan-guide .clean-demo[data-phase="2"] .tap-ring { top:111px }
.arkme-scan-guide .simple-avatar { display:flex;align-items:center;justify-content:center;background:#f6f4f8;border:1px solid #edeaf0;width:21px;height:21px }
.arkme-scan-guide .simple-avatar svg { width:16px;height:16px }
.arkme-scan-guide .agent-icon svg { width:18px;height:18px }
.arkme-scan-guide .self-icon { background:none;border:0 }
.arkme-scan-guide .self-icon img { display:block;width:21px;height:21px }
.arkme-scan-guide .agent-icon img { display:block;width:17px;height:17px }
.arkme-scan-guide .demo-menu img { width:13px;height:13px;object-fit:contain;flex-shrink:0 }
.arkme-scan-guide .simple-row { height:28px;gap:6px;margin:0 8px;opacity:.62 }
.arkme-scan-guide .simple-row>div { font-size:7px;color:#858891 }
.arkme-scan-guide .simple-avatar { width:16px;height:16px }
.arkme-scan-guide .self-icon img { width:16px;height:16px }
.arkme-scan-guide .agent-icon img { width:13px;height:13px }
.arkme-scan-guide .simple-row i { width:44px;height:2px;margin-top:4px;background:#e8eaed }
.arkme-scan-guide .clean-demo { border:1px solid #e9ebef;border-radius:10px;background:#fff;color:#313740 }
.arkme-scan-guide .demo-home, .arkme-scan-guide .demo-list { background:#fff }
.arkme-scan-guide .demo-bar { height:32px;padding:0 9px;font-size:9px;color:#424852 }
.arkme-scan-guide .demo-list .demo-bar { height:32px;border-bottom:1px solid #f2f3f5 }
.arkme-scan-guide .demo-list { box-shadow:2px 0 8px #26344808 }
.arkme-scan-guide .demo-shade { background:#333c4b15 }
.arkme-scan-guide .simple-row { height:31px;gap:7px;margin:0 10px;opacity:1 }
.arkme-scan-guide .simple-row>div { font-size:8px;color:#858b94 }
.arkme-scan-guide .simple-row i { width:42px;background:#eff1f4 }
.arkme-scan-guide .simple-avatar { width:16px;height:16px }
.arkme-scan-guide .self-icon img { width:16px;height:16px }
.arkme-scan-guide .agent-icon img { width:13px;height:13px }
.arkme-scan-guide .demo-bubbles { opacity:.8 }
.arkme-scan-guide .tap-ring { pointer-events:none }
.arkme-scan-guide .demo-plus { width:21px;height:21px;font-size:18px;color:#525b68;transition:background .2s }
.arkme-scan-guide .clean-demo[data-phase="1"] .demo-plus { background:#edf3ff;box-shadow:0 0 0 1px #a9bfea;color:#3e6bac }
.arkme-scan-guide .demo-menu { top:32px;right:16px;width:98px;padding:4px;border-radius:8px;border:1px solid #e9edf3;box-shadow:0 4px 12px #27394e10;background:#fff }
.arkme-scan-guide .demo-menu>div { height:26px;padding:0 5px;gap:7px;font-size:9px;border-bottom:0 }
.arkme-scan-guide .demo-menu>div:not(.scan-target) { color:#7d8490 }
.arkme-scan-guide .demo-menu img, .arkme-scan-guide .demo-menu svg { width:12px;height:12px }
.arkme-scan-guide .demo-menu .scan-target { font-size:9px;background:#edf3ff;color:#3563a4;box-shadow:inset 0 0 0 1px #c2d2ec;border-radius:5px;font-weight:500 }
.arkme-scan-guide .demo-menu:before { right:8px }
.arkme-scan-guide .swipe-track { background:linear-gradient(90deg,#89a4ca11,#7c9bc7);height:1px }
.arkme-scan-guide .swipe-track:after { border-color:#7c9bc7;border-width:1px }
.arkme-scan-guide .swipe-finger { width:17px;height:17px;top:6px;border:1.5px solid #7395c8;background:#edf3ffb3 }
.arkme-scan-guide .clean-demo[data-phase="1"] .demo-plus { background:transparent;box-shadow:none;color:#525b68 }
.arkme-scan-guide .demo-menu .scan-target { background:transparent;box-shadow:none;color:#7d8490;font-weight:400 }
.arkme-scan-guide .demo-home .demo-bubbles { padding:2px 7px;opacity:1 }
.arkme-scan-guide .demo-home .demo-date { margin:3px 0;color:#aab0b8 }
.arkme-scan-guide .demo-home .bubble-row { margin:8px 0 }
.arkme-scan-guide .demo-home .avatar { background:#fff;border:1px solid #edf0f3;overflow:hidden }
.arkme-scan-guide .demo-home .avatar img { display:block;width:100%;height:100%;object-fit:contain }
.arkme-scan-guide .swipe-cue { left:29px;top:85px;width:100px }
.arkme-scan-guide .swipe-track { background:linear-gradient(90deg,#8da9d033,#7195ca);height:2px }
.arkme-scan-guide .swipe-track:after { border-width:2px;border-color:#7195ca }
.arkme-scan-guide .swipe-finger { border-color:#6488c3;background:#e8f0fdc9 }
.arkme-scan-guide .swipe-cue { left:37px }
.arkme-scan-guide .demo-home .demo-date { margin:3px 0 }
.arkme-scan-guide .demo-home .bubble-row { margin:6px 0 }
.arkme-scan-guide .demo-home .bubble-row i { height:14px }
.arkme-scan-guide .demo-home .avatar { width:15px;height:15px }
.arkme-scan-guide .swipe-cue { left:37px;top:111px;height:25px }
.arkme-scan-guide .swipe-track { top:12px }
.arkme-scan-guide .swipe-finger { top:4px }
.arkme-scan-guide .demo-menu { top:30px;right:19px;width:76px;padding:3px;border-radius:6px;box-shadow:0 3px 9px #27394e18;border:1px solid #eceef2 }
.arkme-scan-guide .demo-menu:before { width:6px;height:6px;top:-4px;right:7px }
.arkme-scan-guide .demo-menu>div, .arkme-scan-guide .demo-menu .scan-target { height:20px;font-size:7px;gap:4px;padding:0 3px;font-weight:400;white-space:nowrap }
.arkme-scan-guide .demo-menu img, .arkme-scan-guide .demo-menu svg { width:10px;height:10px;flex-shrink:0 }
.arkme-scan-guide .demo-menu>div:not(.scan-target) { color:#737a84 }
.arkme-scan-guide .demo-menu .scan-target { color:#48515e;background:none;box-shadow:none }
.arkme-scan-guide .tap-ring { width:21px;height:21px;border-width:1.5px;z-index:6 }
@keyframes arkme-guide-slide {0%,12%{transform:translateX(0);opacity:0}22%{opacity:1}62%,80%{transform:translateX(82px);opacity:1}100%{transform:translateX(82px);opacity:0}}
@keyframes arkme-guide-tap {50%{transform:scale(.82);opacity:.6}}
.arkme-scan-guide .simple-row { position:relative;gap:5px;margin:0 7px }
.arkme-scan-guide .simple-row>div { min-width:0;flex:1;text-align:left;line-height:12px }
.arkme-scan-guide .row-date { font-size:5px;color:#adb2bb;align-self:flex-start;margin-top:8px;flex-shrink:0;line-height:10px }
.arkme-scan-guide .simple-row i { width:35px }

`
