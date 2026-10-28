# Team mention 兼容

本改动延续现有读取 / 编辑 API，不增加插件 UI、Tools、SDK 或 Host 的业务入口。用户新增交互由 Flutter 移动端实现。

| 能力面 | 本次处理 | 证据 |
| --- | --- | --- |
| UI | Team 内容 payload 裁剪内部 mention 身份，保留现有纯文本展示和编辑 | team-app-service.test.ts |
| Tools / SDK | 共用 TeamAppService 的同一结果裁剪和版本校验；没有新增能力注册或公开 Schema | 现有协议不变，Host 回归和 typecheck |
| Host | 精确版本重新读取原 mention；编辑中可证明未变的 span 保留身份，修改过的 token 移除身份，重新计算 checksum | metadata 隐私、Unicode 位移、过期版本测试 |
| Client / Harness | 不改原生桥、Profile、Bundle 或装配 | N/A：现有载体合同足够，无客户端改动 |

仅本地实现与构建；未发布插件制品、未替换用户常驻实例。先部署此裁剪兼容，再开启 Record 的团队侧 mention 输出，避免原始人员 ID 进入旧插件 Browser / Tool / SDK 结果。

## 2026-10-28 补齐外部通道人员提及

| 能力面 | 同一 owner 的入口与验收 |
| --- | --- |
| UI | 头像 @TA / @TA 的快记；当前团队侧稳定 personRef，富文本 token、UTF-16 范围、草稿/队列、编辑和分页。外部视角隐藏人员动作；自己隐藏 @ 自己。 |
| Tools | 扩展 arkme_team_messages 的 person_ref/person_mode；arkme_team_message_send 的 mentions_json。沿用真实 DSH tool registration、read grant 与 explicit-user-write 确认。 |
| SDK | readTeamMessages 的 typed personRef/personMode；TeamContent 的 typed mentions。teamPersonMentions 能力探测，旧 Provider 显式拒绝。 |
| Host | TeamAppService 统一解封账号/会话引用与编码/投影，数值 ID 不进入三个消费面；原发送队列和幂等身份不变。 |
| Client / Harness | N/A：无原生或装配合同变化；在隔离官方运行环境安装 tgz 验收。测试 Runtime 走既有 pre-release 发布管线。 |

性能工作负载：冷/暖单页 50 条、最多 100 条；普通正文与含人类提及正文对比；相同 TEST 隔离会话测真实读、写、编辑与并发读延迟。Host 人员筛选每次仅请求一页，不循环扫描历史；UI 人员页手动翻页，保留最近加载的 200 条，提供返回最新页，取消与账号作用域由原页面持有。Team 提及验证复用当前 access，只额外批量读取一次当前成员列表，无逐个目标 I/O。未完成测量前不宣称性能达标。


### 签名引用刷新与内容更新

人员列表按稳定 account / conversation / person 身份持有分页，下一次请求使用最新签名引用。仅引用轮换不重新读取或重置；父会话的消息 UID、版本、状态或会话 revision 变化时，由原 React key 生命周期重开列表，保留内容更新和失权语义。确定性回归覆盖同一身份引用轮换 10 次只读 1 次、后续翻页使用第 10 代引用。
