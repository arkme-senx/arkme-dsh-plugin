# 原消息汇总浏览器验收

用本仓 Vite 执行 `--config tests/fixtures/message-extension-summary/vite.config.ts`，打开终端输出的 loopback 地址（临时端口自动分配）。数据仅存在测试进程内，无账号、无生产调用。

只渲染原消息时应显示 125 条评论，第二个“可以”有引用下划线；点击角标应进入原打开回调。模拟删除后数量和下划线消失；失败显示重试；恢复后重新出现。UI 使用生产 Provider/正文/角标与正常 Host 传输，模拟的是 reader 的数据；不代表生产服务验收。
