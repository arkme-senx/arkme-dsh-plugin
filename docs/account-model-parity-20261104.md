# 账号自提供模型与使用记录

设置 → 模型统一提供官方、自提供、使用偏好、使用记录。自提供绑定可选择云端 API 或保留 Key 的本机连接器；全局和场景偏好共用账号配置。Key 只在用户填写后绑定，不能从原生配置 iframe 导出。自提供模型失败时停止，不自动转成积分调用。

后端共享契约：jotmo-meta/contracts/http/user-models/api-v1.yaml。实现与发布报告：jotmo-meta/docs/dev-execution/account-model-parity-20261104.md。云端协议使用公开 PiAiAdapter，保留工具和原生 replay state；DSH 每个 turn 固定模型版本，每次物理调用单独记录。账号切换恢复原生默认选择，后端请求前后校验账号和会话。

本会话 Web 固定为 http://127.0.0.1:3177，使用安装客户端当前登录的隔离 profile。test-session.json 保存启动方式和登录来源；私有文件、连接票据和真实账单不提交。验收数据明确命名为隔离验收，不代表真实供应商消费。原生 App 与实际供应商测试不包含在本地 Web 验收中。

验证覆盖模型设置/偏好冲突、账号隔离、秘密投影、原生配置保留、原积分弹窗，另有真实 PI codec 的本地 SSE 通路和连接器调用顺序/失败测试。构建、类型生成、安装包和实际点击证据保存在 .codex-artifacts/ai-points-3177。代码不自动开生产配置，不自动发布或合并。
