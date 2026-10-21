# 消息文字标记 / 局部引用能力矩阵

最终基线：用户指定 dev，`624cce7705b361f9b590ccf067dcf14c364e90b4`。
本次保留既有 PC 选区工具栏、柔和背景、作者、取消、引用草稿及导航；移动端由 Flutter 仓承担。

| 能力面 | 入口与边界 | 实际验证 |
| --- | --- | --- |
| Host owner | 签名 source/action ref、当前账号、完整原文锚点、稳定接受回执；Record 为云标记 owner，Chat 为出现位置/成员权限 owner | 服务、锚点、权限失效、重试测试通过 |
| UI | 原选区和背景并集；共享/仅本机选择；标记提示只刷新可见标记，来源权限变化清空引用再读取 | 真实浏览器隔离示例验证浅/暗、重叠作者、取消自己保留他人、本机范围；最新相关回归通过 |
| SDK | `messageTextAnchorsV1`；签名引用形式的 capture/capabilities/read/change；quote 沿 `extendSourceMessage`；每调用 AbortSignal | 实际 tgz 安装到仓外 consumer，公开包导入编译/运行通过；无 private import |
| Tools | `arkme_message_marks_read`、`arkme_message_mark`、`arkme_message_quote_reply`，共用 Host，正式 Tools catalog/grants；actor 不由调用者指定 | 最新 catalog/registrar/SDK 测试通过；全新隔离官方 DSH agent session 能发现三个工具，匿名读写均拒绝 |
| 原业务隔离 | 标记不是表态、正文编辑、撤回或新消息；引用不是正文解析输入；本机 SQLite 不自动上传、不混 revision | 原本机库/会话、引用、发送及目录回归已运行；Chat/Record 真实 HTTP 验证未读保持不变 |

验证细节：原基线完整套件 1092 个文件已运行，首轮失败的 7 个文件修复/串行复验 699 项通过；合入新 dev 后受影响的 33 个文件 1087 项通过、另 1 个文件/用例跳过。构建、声明与打包入口检查通过；最终结果与限制统一记在 meta change 的 VALIDATION.md。

官方 DSH 验收使用已安装的官方 `0.1.1-rc.2` CLI，新临时 DSH_HOME/Profile 只锁定该运行时自身的匹配依赖版本；没有修改 DSH 源码、真实 Profile 或真实账号。该探针验证工具注册/鉴权边界，不能代替已登录多人实机。

旧本机数据仍在原私有数据库，不自动上传；Team 与 Arko 保持独立本机标记语义。尚未执行已登录 PC 与 Flutter 真机间的多人/多设备交互验收，浏览器示例仅内存数据。没有提交、发布或安装到用户正式客户端。
