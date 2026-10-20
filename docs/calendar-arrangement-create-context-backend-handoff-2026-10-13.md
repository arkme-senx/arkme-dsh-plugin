# 日历与安排共用创建流程：默认日期上下文交接

## 已完成与待对接

插件的日历和安排入口现在复用同一个 `ArkmeArrangementCreate`，包括输入、多条内容、草稿、完成提交、请求身份、失败重试和异步识别状态。日历原来的独立日期/时间表单及直接创建分支已移除。两处的差异只有可选的默认日期上下文：日历传选中日期及 IANA 时区；安排入口不传，前端不补今天。

**本文接口是待后端确认和实现的建议合同，不代表远端已经开发或部署。** 本次只修改插件前端及 Host/Provider 适配，没有修改 `jotmo-intelligent`、部署后端或更改已安装的 Arkme 客户端。后端如有等价能力，可提供实际合同后调整适配。

旧后端会忽略未知 JSON 字段，因此不能直接把 `date_context` 加到请求里就宣称已支持。插件会先只读检查能力；不支持时不提交日历安排，保留草稿并提示。普通安排入口继续使用原异步创建接口。

## 已核实代码现状

检查基线：`jotmo-intelligent origin/master=6553d26ee5f57529fe55841355b70fbf17e4cdd9`，`origin/develop=7b66262239f85654fb4706e1832757eae9481bc5`。

- `gin/api/types.go` 的 `ArrangementFastCreateReq` 有 `scene_type / topic_uid / sent_messages`，没有默认日期。
- `gin/api/arrangement_fast_create_async.go` 的异步请求增加 UID，但调用识别服务时只传用户、UID、topic、texts。不能保存本次日历选择的日期。
- `docs/arrangement-fast-create-async.md` 已规定先保存原始内容、后台识别、UID 幂等和异步状态；应扩展这一套流程，不另建日历识别业务。
- `internal/arrangements/prompts.go`：完全无时间信息时保持空日期；只有时分时目前用 `current_local_time` 的日期，只有日期时已有 09:00 默认规则。前者与本次“安排入口未指定日期就保持无日期”的要求存在差距，需要后端一起调整，不能仅靠前端不传日期保证。

## 日期规则

1. 用户原文中的明确日期优先，包括可以解析的相对日期。相对日期继续以原始提交时间和账户时区为参考，不能把“明天”偷偷解释为所选日历日期的下一天。
2. 没有日期而有日历上下文时，采用 `default_date`；若写了时分，将其组合到该日。
3. 没有日期且没有上下文时，保持未定日期，不自动填今天。仅写“下午三点开会”也不能擅自确定为今天；可以保留原文中的时分，等待补充日期。
4. 有日期、没有时分的情况沿用后端明确约定的日期精度/默认时间策略。目前提示词使用 09:00，前端不再要求用户填写或自行拼接这个时间；如果继续使用，应在联调时确认，不能声称是用户输入的时刻。
5. 默认日期是识别上下文，不是新增消息、不是 source_items，也不是强制覆盖每个识别结果。原始输入逐条保留，多个事项可有各自日期。

例：日历选择 2026-10-20，提交“准备会议”默认归属 10 月 20 日；“10月21日开会”归属 10 月 21 日。安排入口提交“准备会议”保持未定日期。选择日期、提交时间、识别完成时间和实际安排日期必须区分。

## 建议合同

沿用 intelligent 服务既有鉴权、业务成功 envelope。以下示例展示 envelope 的 `data` 部分。

### 1. 只读能力检查

`POST /api/v1/arrangements/creation-options`，body `{}`。该调用不得创建安排、排队识别或写入业务数据。

```json
{
  "contract_version": 1,
  "date_context": true
}
```

只有入口 API、持久化及识别 worker 都支持下述合同才能返回 true。未部署路径、缺字段或 false 都不能视为支持。插件不缓存该结果；日历每次提交前检查。普通安排创建不依赖此检查。

### 2. 扩展现有异步创建

`POST /api/v1/arrangements/fast-create-async`：

```json
{
  "uid": "client-stable-request-id",
  "scene_type": "private",
  "topic_uid": "",
  "sent_messages": [
    {"type": "text", "text": "准备会议"},
    {"type": "text", "text": "10月21日再讨论预算"}
  ],
  "required_contract_version": 1,
  "date_context": {"default_date": "2026-10-20", "timezone": "Asia/Shanghai"}
}
```

普通安排入口不增加最后两个字段，保持既有请求形状。默认日期必须是有效 YYYY-MM-DD，时区必须有效；不要以服务器时区或固定 UTC 偏移替代 IANA 时区。

响应必须在原 `items` 外回显**已经持久化的**上下文：

```json
{
  "contract_version": 1,
  "date_context": {"default_date": "2026-10-20", "timezone": "Asia/Shanghai"},
  "items": [
    {"uid": "client-stable-request-id", "title": "准备会议", "status": 2, "recognition_state": "recognizing"}
  ]
}
```

`items` 仍用现有 Arrangement 结构；例子未展开其他字段。刚保存的识别中根项可以尚无 `due_at`；前端显示已保存、正在识别，并轮询原有识别结果，最终按各结果的实际日期归入日历。

服务端对不支持的 `required_contract_version` 或无效 context 必须在任何写入前明确拒绝。能力检查和创建可能命中不同版本实例，因此不能只增加一个永远返回 true 的能力接口。混合版本部署期间不得开放能力。

插件在收到缺少版本/context 回显或回显不一致的写入响应时显示“结果未确认”，保留原请求身份，不声称失败未写入、不自动走第二条创建路径。

## 保存、重试与识别要求

- 根项和识别任务持久化默认日期、IANA 时区、原始提交时间及原文；异步重试、跨天重启不可重新用当前日期推断。
- 幂等身份仍是当前所有者和 UID。幂等内容校验须包含日期上下文；同一 UID 相同原文但不同日期/时区应拒绝冲突，不覆盖既有安排。原文或上下文变化由前端使用新 UID。
- 重复请求返回原保存上下文和现有识别状态；根项删除后不能通过重试复活。继续遵循原异步创建约定。
- 分拆出多条安排时对每条分别识别日期：明确日期优先，无日期才继承默认值。不能把 fallback 作为原文插入或者覆盖明确日期。
- 保持现有提醒、去重、状态、所有者权限与来源分类。无需为本功能批量修改历史安排或重跑历史识别。
- 完成识别后，既有 `list`/识别读取要返回最终子项、`due_at`、状态；日期过滤仍表达安排实际发生日，而不是创建日。

## 插件实现位置

- `src/client/ArkmeArrangementCreate.tsx`：共用完整创建流程及识别状态；草稿按账户、入口日期和时区隔离，安排入口沿用原草稿键。日期上下文不改变原始文字。
- `src/client/ArkmePersonalDayCalendar.tsx`、`ArkmeArrangementSurface.tsx`：两个入口，只由日历传默认上下文。
- `src/types.ts`、`src/arrangement-creation.ts`、`src/host-api.ts`、`src/arkme-service.ts`：可选 context 类型及边界校验，不信任浏览器传来的 owner 等额外字段。
- `src/services/arrangement-service.ts`：能力检查、同一异步创建路径及保存回显校验。移除本地旧日历直接创建的特殊分支，拒绝旧 `dueAtMillis` 入参，避免旧页面静默退化为无日期。
- `tests/arrangement-create-context.test.tsx`、`tests/personal-day-calendar.test.tsx`、`tests/services/arrangement-create.test.ts`、`tests/arrangement-host-api.test.ts`：合成数据验证共享组件、上下文、草稿、异步结果、幂等身份及旧服务不写入。

## 联调验收

后端部署后请提供能力响应、识别中响应、已完成及失败响应样例，再用允许写入的测试账号验证：

1. 日历未来日无日期输入默认归属选中日；明确日期覆盖默认值；时分与默认日期正确组合。
2. 安排入口无日期及仅有时分都不自动指定今天；明确日期正常识别。
3. 多条内容混合日期、识别拆分、跨午夜处理、DST 时区和闰日均符合规则。
4. 原文不被日期提示污染，两个入口共用修改与错误处理，切换账号/日期不会展示另一份草稿或误接收迟到结果。
5. 未部署、错误能力、混合版本、无效输入都不发生未被识别的写入；保存响应丢失后相同 UID 重试不会重复创建，删除后不复活。
6. 日历识别中有可见等待状态，完成后进入实际日期的列表；与安排看板查看、提醒、完成及删除保持同一份数据。

当前前端测试和预览不代表生产日期识别已验收。浏览器验证只打开/关闭弹窗，未创建真实测试安排。

### 本地验证记录（2026-10-13）

- 9 个相关测试文件、139 项测试通过；TypeScript、插件 bundle、diff 格式检查通过。
- 独立 3101 Web 预览已更新，实际登录态下打开 2026-10-20 日历的添加安排，展示共享弹窗及默认日期提示，没有原独立时间表单。
- 切换安排模块后打开添加安排，使用同一输入和完成区域，不展示默认日期。没有输入、提交测试安排或改动已安装客户端内容。
- 默认日期对真实识别结果的影响仍待后端按本文合同对接后验收；本次不以 UI 展示或合成合同测试代替生产联调。
