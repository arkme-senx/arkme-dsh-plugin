# Arko 消息生命周期

Intelligent 的 session owner 统一裁决消息删除、恢复、权限、生成资格和 30 天期限。Record、安排和文件资产保留各自生命周期。桌面通过既有消息多选入口删除；数据管理中的 Arko 最近删除与 Record 最近删除各走自己的 owner。手机消费同一生命周期事实，不新增删除入口。

## SDK 与工具

公开 SDK 从 `@senguoyun/dsh-arkme/sdk` 导入，先探测 `arkoLifecycleV1`。消息引用来自 `arkoMessages` / `arkoSearch`，绑定当前账号、环境和期限。不要自行拼接 ID。

```ts
const state = await sdk.arkoLifecycle([message.messageRef], signal)
const result = await sdk.arkoChangeLifecycle({
  action: 'delete', // 恢复用 restore
  operationUid: crypto.randomUUID(),
  targets: [{ messageRef: message.messageRef, expectedVersion: state.items[0].version }],
}, signal)
const deletedPage = await sdk.arkoRecentlyDeleted(undefined, signal)
```

单批最多 100 条，最近删除每页 50 条。所有结果逐项处理，不能把部分成功视为全成功。`unknown` 是结果无法确认，必须调用 `arkoLifecycle` 读取当前事实；不得自动重新发送写请求。每次新的用户意图使用新的操作键；同一意图重复传输必须保留原操作键与原期望版本。恢复保留消息身份、原顺序、已执行结果，不调用模型或重跑工具。

正式工具 `arkme_arko_lifecycle` 提供状态查询/最近删除；`arkme_arko_change_lifecycle` 提供显式删除/恢复，走官方 DSH 人工确认与严格 Schema。工具输出限制正文预览长度；SDK/UI 按读取预算取得内容。Tools、SDK 和 UI 都调用同一 Host adapter。

## 界面与逻辑边界

桌面沿用既有消息多选、删除确认弹窗和数据管理列表。Arko 最近删除复用既有逐条「恢复 → 确认恢复 / 取消」交互；不新增独立回收站面板、复选框、批量恢复、翻页按钮、核对状态按钮、同步横幅或关联删除标记。删除只在取得服务端事实后从列表移除；忙碌与错误反馈使用原有组件插槽，不新增可见状态分支。

合并展示不合并业务身份：列表适配器以 `owner` 区分 Record 与 Arko，同值 ID 不会串用接口。每次只读取两类数据各一页，不为填满列表自动扫描全部历史；更多数据沿用现有范围提示，SDK/Tools 保留完整分页能力。一侧读取失败时保留另一侧已验证数据，使用现有未验证记录提示，不宣称整个列表为空。

操作身份、期望版本和未知结果核对由逻辑模块持有。同一确认的写入结果未知时，再次确认只读状态，不生成新的操作键、不提升期望版本、不自动重放写入。切换账号取消请求；跨端刷新撤下失效确认；到期仅使用一个可释放的截止计时器，不增加轮询。

## 一致性与资源

账号生命周期 revision 变化时，桌面已有前台刷新循环通知消息列表、搜索、日历与预览。消息事实按独立 version 合并，较旧分页和流不能推翻已知删除。恢复后有界重读已加载时间区间，避免遗漏初次加载时已被删除的消息；页面/账号退出取消请求。最近删除仅保留当前页；截止时间到达即撤下已展示内容。

导出生成前后以及受控下载时核对源 revision，删除期间生成或删除前生成的文件引用失效。已经自行下载的独立文件不在受控引用范围。

## 后端部署约束

先执行 Intelligent migration 26，再启动理解该表的全部 Intelligent 实例以及 Chat 原文分享过滤，再发布插件和手机版本。无功能开关、灰度状态或历史数据回填。发生第一次删除之后，旧 reader 会重新暴露内容，因此只能回退到保留生命周期合同的版本或向前修复；禁止 drop 表、恢复删除前数据或回滚至旧 reader。

本目录的 `tests/e2e/arko-lifecycle.e2e.mjs` 使用不可变插件包、未修改官方 DSH、真实 Intelligent handler 与隔离 MySQL；身份及无关服务使用合成 fixture，不访问生产账号。运行配置为 `vitest.arko-lifecycle-e2e.config.mts`，所需路径见测试开头环境变量。
