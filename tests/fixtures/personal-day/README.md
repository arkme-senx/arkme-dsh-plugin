# 个人活动日历离线验收入口

使用真实 `ArkmePersonalDayCalendar` 及正式主题样式。只用于离线浏览器验收，测试账号范围 `offline-fixture:123` 不是业务账号。

- 使用 Vite build 构建此配置，不启动另一个预览端口。
- 浏览器测试必须拦截所有网络请求，模拟 `calendar.buckets`、`calendar.records`、`recordings.calendar`、`recordings.day` 的现有返回结构，以及插件本地的 `calendar.record-location` 只读结果；其他业务操作应拒绝。
- 只访问本地构建产物，不迁移真实登录，不读取钥匙串，不发送消息或产生已读回执。
- `?theme=dark` 为暗色，否则亮色。检查 1440、800、420 像素宽度下的月历、时间轴、活动详情和横向溢出。
- 离线验收不能替代固定 3098 已登录环境的真实业务联调。
