# 搜索中的原生 DSH 任务

原生 DSH 搜索结果在“主题”左栏展示，不再提供独立 DSH Tab。单击任务显示匹配摘要，双击或按 Enter 打开原对话；搜索跳转通过插件同源 iframe 桥调用可见 DSH 客户端的公开 `sessions.open()`，避免只改变外层页面的会话选择。打开失败或 iframe 未就绪时保留搜索弹层并显示错误。切换到 DSH 任务会取消旧 Arkme 主题详情请求，避免迟到结果覆盖当前选择。

## 当前消息定位能力

已核对官方 `dsh-v0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`），与检查时桌面 Harness 包版本一致。

- `packages/api/session-controller/src/client/contract/sessions.ts` 的 `ISessions.open(id)` 仅选择会话。
- `packages/api/session-controller/src/client/sessions/manager.ts` 的 `SessionSearchResultItem` 仅含 `sessionId`、`snippet`。
- `packages/api/session-controller/src/list.ts` 将 Host 搜索命中投影成这两个字段，未返回消息序号。
- `packages/api/session-controller/tests/session-search.host.spec.ts` 验证上述返回字段。
- `packages/client/ui-chat/src/client/chat/ChatView.tsx` 的轮次跳转由组件内部持有；公开搜索接口没有提供可直接使用的消息定位合同。

因此右栏原生摘要点击打开对应会话，并明确尚不支持精确消息定位。不依据摘要匹配 DOM，不读取私有会话文件，也不改 DSH 源码。后续最小上游能力是搜索返回稳定消息定位信息，并提供加载目标历史、滚动及高亮的公开导航接口。跨机同步消息兜底见下文。

## 能力与资源范围

| 能力面 | 本次范围 |
| --- | --- |
| UI | 三个结果分类、DSH 左栏选择/双击/Enter、错误保留与请求取消 |
| Tools | 既有 arkme_records_search 共用 SearchService，返回校验后的关联和跳转目标；真实会话调用已验收 |
| SDK | searchRemote 公开远端搜索及能力探测；合同测试通过，独立消费者运行已验收 |
| Host owner | 继续复用 Arkme SearchService 与 DSH sessions.search/open；新增的同源 iframe UI 导航桥无 Host 接口 |
| Client/Harness | 复用既有插件 Browser module 装配，不改 Electron bridge 或 Release Set |

搜索保持原有防抖、AbortSignal 与请求序号。DSH 结果仍由官方接口限定最多 20 个会话，每个会话一段最强匹配摘要；单击左栏不新增网络请求。iframe 导航桥随原 Cordis effect 注册和释放，不新增轮询、计时器或常驻队列。本地导航模块始终挂载；仅开启远端 DSH 功能时注入上报 API meta 并启动既有会话上报生命周期。没有性能提升测量结论。

## 2026-09-16 搜索故障与跨机兜底修复

- 插件 Bundle 使用官方 `session-query-sqlite` 配置 `openAt: first-search` 和 `path: ':memory:'`；索引按需加载，由官方服务持有，无私有 DSH 补丁。
- 新输入在原同步请求的 `extra.dsh_origin` 内携带会话 ID 与事件序号。Record owner 只保留校验后的两个字段；搜索仅在可读 DSH 输入上返回关联。插件用既有确定性 record UID 算法验证关联，拒绝不匹配元数据。
- 搜索将有来源关联的同步记录按 DSH 会话合并；历史无关联记录归入“DSH 历史同步消息”。当前页之外的匹配不会伪装成已完整加载。
- 打开同步结果前，通过可见 iframe 的公开 `remote.session.list({})` 的成功响应核实本机；必要时刷新 UI 会话列表。查询成功且不存在才转该快记所属的 DSH 主题，同时显示说明；加载失败保留搜索错误。本机存在则复用原生打开入口。
- 精确 DSH 消息定位仍无公开接口。原生摘要点击打开对话；同步输入可在本机不存在时走已有 Arkme 消息定位链。
- DSH 输入沿用普通 record/topic 结构，以 `TopicKindDSHAgentInputContainer = 3` 标记独立容器。搜索保留原 topic 目标，兜底复用主题分页及现有记录定位；不扩展个人首页读取规则，不设置特殊签名来源。后端仅修正搜索误用普通用户主题专属校验的问题，并保存/返回来源元数据。
- 历史同步数据缺少会话关联时，SearchService 通过公开 sessionQuery.listSessions/filterEvents 读取本地 user/message 事件，重算确定性 record UID 并严格比对后补齐本次查询结果。不会按文字匹配或重写历史数据。按时间倒序扫描本地会话，在串行扫描间检查 5 秒期限；官方 filterEvents 不支持取消单次读取；已全部关联立即停止。未匹配仍是关联未知，不代表本机不存在；查询失败或超时保留远端结果并标记未完整核验，不冒充无匹配。该行为由 UI、Tool、SDK 共用。
- 部署顺序：Record 后端先部署，再让插件完整消费；旧服务会忽略输入 extra 中的关联，无法提供完整跨机兜底。当前任务不包含生产部署。

能力面：Host 的既有 SearchService 统一解析查询结果和账号绑定跳转目标；`arkme_records_search` Tool 继承相同输出；SDK 增加 `searchRemote()`，通过 `remoteRecordSearch` 能力位探测，保留旧缓存 `search()` 语义。浏览器导航检查为 UI 能力，不向模型开放桌面操作。客户端源码未修改。

开发运行注意：当前客户端安装目录的旧 Bundle 配置会优先于开发 Profile 中的包被解析。此次独立客户端 Profile 显式覆盖同一 session-query-sqlite 配置，并通过官方 --dump-config 验证 first-search 生效；开发运行不等于生产 Release Set 已发布。

## 记录详情与会话入口

按用户最终选择，右栏同步记录点击与左栏双击/Enter 均优先打开本地对应 DSH 对话；本机不存在或历史关联未知时保留同步消息兜底。已移除底部静态提示，未使用私有 DOM/消息组件接口。

## 搜索展示

加载状态覆盖显示在结果区域水平、垂直正中央，不占布局空间，防抖等待期也显示加载，保留已有列表；首次加载不显示尚未确定的零计数。DSH 徽标位于标题后，长标题可截断，徽标不收缩。

## 合并前审查修复与验证

- 历史恢复：取消最近 20 会话的硬截断，按确定性 UID 匹配原始事件，不依赖已编辑的正文；局部索引失败保留服务端结果并标记未完整核验。
- 同步消息定位：仅聊天来源使用 owner ID 的 around 查询分支；个人来源等待首屏事实后继续历史分页。主题目录刷新复用现有来源投影更新方法，不触发重新选择主题或清除待定位目标；普通主题与 DSH 主题共用。
- 导航缺失：未安装会话打开能力时明确报错，不以可选空调用冒充成功。
- 后端修复：DSH origin 采用与 MongoDB 解码一致的嵌套 BSON 表示，重复创建保持幂等；关键词和场景搜索 HTTP DTO 均透传业务层已授权的 origin。
- 验证：插件全量 556 个文件 / 6650 项通过（7 文件、9 项原有跳过），类型检查、构建和 tgz 官方 Profile 安装通过。真实 MongoDB replica set + Redis + record HTTP 服务验证创建、重复同步、隐藏首页、通用主题分页/around 定位、跨账户隔离、全局/主题搜索 origin、编辑保留 origin、删除不复活；搜索引擎使用仓库 fakesearch，不代表真实 OpenSearch 集群验收。
- 可重跑联合检查：在隔离后端 E2E 栈运行时，设置 `ARKME_RECORD_E2E_URL=http://127.0.0.1:<record-port>`，执行 `vitest run tests/search-backend-integration.test.tsx`。测试使用独立 fixture 账号，经 UI/SDK → Host HTTP → 后端 HTTP 检索并读回同步消息；只允许 loopback，不使用真实账号。
- 打包产物的仓外 SDK Consumer 已完成公开导出的类型编译与真实 Host 调用；官方 DSH 0.1.5-rc.2 创建的会话通过正式 tools schema / execute 管线成功执行 `arkme_records_search`，返回正确 origin。读取型工具无写入 grant，未调用真实 LLM。
- 浏览器复验：同一打包产物运行在未修改的官方 DSH，原会话存在时点击详情后原生对话显示对应测试正文；原会话不存在时，所属 DSH 主题页面出现与搜索结果 UID 完全一致的消息。辅助账号资料/目录接口为隔离 fixture；搜索、消息读取、会话存在判断和会话打开均走真实 owner。
- 最新 `dev` 基线 `acf427f` 临时合并无冲突，158 项相关测试通过。后端审核修复 `e130672` 已合入测试分支 `c5e367a`，Jenkins Record 测试部署 #485 SUCCESS。正式生产发布未执行。

## 主题链路收敛

移除本分支曾引入的 `all:dsh-input`、`include_dsh_agent_input` 及个人首页越过来源显示规则的分支。搜索的目标仍由既有 source kind/UID 构造，Tools、SDK 和 UI 共用该结果。插件主题定位沿用首屏后历史分页（最多 80 页）；后端已有主题 around 接口已验证可读 DSH 容器，本次不新增插件 around 能力。当前后端 MR 的 home-feed 文件与 master 无差异。通用 sourceItem 补齐与目录相同的 topicHierarchyKey，目录刷新只更新投影，避免清除正在定位的目标。

本轮复验：真实后端 HTTP + MongoDB 验证主题分页/around、外账户拒绝、默认首页隐藏；UI/SDK/Host 联合测试验证目标与主题目录身份一致及读取 kind=3。普通 kind=1 与 DSH kind=3 的首屏外目标分页均通过。官方 DSH 制品的浏览器验证本机原对话打开、非本机回到 DSH 主题并渲染精确记录 UID；正式 Tool 返回主题目标。全量测试 6653 项通过、10 项跳过，唯一打包检查在并行构建中失败，停止并行构建后独立重跑 3 项通过；类型检查、构建与制品安装通过。
