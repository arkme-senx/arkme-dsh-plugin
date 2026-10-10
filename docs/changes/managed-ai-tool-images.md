# Managed AI 工具返回图片修复

## 问题与边界

DSH 的 `read_image` 返回 `user → tool-result → image`。原传输层仅扫描 user 顶层图片，并把工具结果限制为纯文本，导致读图成功后下一步报 `UNSUPPORTED_CONTENT`，包含该结果的历史重放也会失败。此前 V4.1 分支撤回展示改动后只剩测试，不能修复这个问题。

本次在既有 `codex/c20260916-deepseek-v41` 分支完成 rebase，基线为 `origin/dev` `68832f858db597cb8de2c255f0fcfa0663976c07`。修复只涉及插件，不改变后台目录、模型 ID、价格、服务费、HTTP 契约、表结构或索引。不修改 DSH 源码、插件版本或根 README。

## 实现合同

- 统一递归遍历用户/工具内容，校验允许的叶子类型、收集全部图片引用。系统与助手消息继续遵守原有类型边界，整份请求在附件读取和上传前完成校验。
- 工具文字仍是带原 `tool_call_id` 的字符串 `tool` 消息。连续工具结果全部发出之后，再追加含图片的 user 消息，用外层工具调用 ID 标明图片来源。既有服务端只接受 user 消息中的 `image_asset`；不放宽服务端角色校验。
- 嵌套工具内容归属于外层真实调用，不凭内层块创建新的工具回复。普通文本、空工具结果回退、推理内容保持原样。
- 复用现有附件读取、缩图、上传并发、账号/模型/能力作用域、缓存与过期恢复。重复图片可复用上传，但每次出现都保留，并计入图片数量和总字节限制。
- 所有转换仅作用于本次请求，不更改持久会话和附件。普通文件转换与纯文本模型的图片投影仍由 DSH runtime 负责。
- `UNSUPPORTED_CONTENT` 使用固定、安全的可操作提示；不把原始供应商错误或本地路径显示给用户。

当前安装的 DSH `0.1.5-rc.2` 的官方 DeepSeek 适配器同样把工具结果图片放在连续 tool 回复之后。此处只实现 Arkme `image_asset` 协议适配，不导入或复制上游私有序列化模块。

## 能力面

| 面 | 处理与证据 |
| --- | --- |
| Tools | 通过原有注册与权限链使用 DSH `read_image`；浏览器真实会话触发两次工具调用并继续回答 |
| UI | 既有模型选择/发送/错误展示；无新入口；验收同会话继续与切换纯文本模型 |
| SDK | N/A：本次未新增 Arkme 业务能力或 Host API，是既有 LLM 传输适配；外部工具按 DSH 内容合同返回的图片共用同一路径 |
| Host owner | `ManagedAiTransport` 统一转换、校验和上传；后端继续负责资产验证、模型路由和结算 |

## 测试入口

相关单测：

```sh
pnpm test tests/managed-ai-tool-images.test.ts tests/managed-ai-adapter.test.ts tests/managed-ai-image-preparer.test.ts
pnpm typecheck
pnpm test --maxWorkers=1
pnpm build
```

新增测试覆盖并行工具、图文混合、嵌套文字与图片、历史重放、压缩请求、重复引用、数量/尺寸/字节限制、过期刷新上限、纯文本边界、缺失附件、取消后重发和不支持内容提示。原有账号隔离、上传故障恢复和并发测试继续执行。

打包验收先用 `pnpm pack --out <artifact.tgz>` 生成不可变产物，再通过官方 `dsh plugin --profile web add -w <artifact.tgz>` 安装到全新临时 `DSH_HOME`。不复用用户 Profile。

```sh
ARKME_DSH_CHECKOUT='<未修改的官方 DSH checkout>' \
ARKME_PACKED_PROFILE='<新临时 DSH_HOME>/profiles/web' \
JOTMO_INTELLIGENT_CHECKOUT='<Intelligent checkout>' \
MANAGED_AI_TEST_MYSQL_ADDR='127.0.0.1:<本任务隔离 MySQL 端口>' \
ARKME_E2E_SCREENSHOT='<输出截图绝对路径>' \
bash scripts/run-managed-ai-tool-images-e2e.sh
```

Runner 使用 Go overlay 加载插件仓内的测试 fixture，**不写入 Intelligent 或 DSH checkout**。MySQL 必须是允许测试建库的隔离实例。临时数据库/用户、浏览器、DSH、凭据命名空间、TLS 和测试目录均由对应 owner 清理；调用者负责回收自己创建的 MySQL 容器及安装 Profile。

链路：Chrome → 正式 tgz 插件 → DSH read_image/持久附件 → 实际插件上传 → 后端 HTTP/InputAssetService/真实图片解码校验/MySQL → 正式 DeepSeek transport → 本地供应商 fixture → 浏览器结果与账本核验。

OSS、供应商 file ID 与模型响应是本地 fixture，不证明真实 DeepSeek 推理效果、外网 Files API、生产部署或 Windows/Linux 真机情况。未读取生产凭据或调用付费模型。

预期七次请求图片出现次数为 `0 / 2 / 2 / 2 / 2 / 0 / 2`，唯一图片为 `0 / 1 / 1 / 1 / 1 / 0 / 1`。依次为工具调用、工具结果续跑、同会话历史重放、图片请求收到错误供应商模型、同会话恢复、切换纯文本模型、切回视觉模型。第 4 次必须失败且基础费/服务费/扣费均为零，无结算、一次释放。其他六次在固定 usage 下每次基础费用 `14080 nano-CNY`、10% 服务费 `1408 nano-CNY`、总计 `15488 nano-CNY`，每请求一次结算，最终预占为零。

## 本次验收记录

- 已用生产故障的实际 `read_image` 工具结果，对最终 tgz 内的序列化代码作不联网回放：一个关联工具消息、一个 user 图片消息、一个图片引用，原持久消息不变。
- 新增 21 项工具图片测试通过，原图片/适配器相关测试继续通过；类型检查、构建通过。
- 隔离浏览器链路使用未修改官方 DSH `d347e703908d0406b7a7ef80e3a0e594d86b2215`；真实会话的工具读图、历史重放、失败恢复、模型往返切换以及六次结算/一次失败释放均通过。该浏览器环境与生产安装的 DSH 版本不同；生产当前内容结构已独立核对并回放，未替换用户常驻实例。
- 初轮全量出现打包检查失败、后续并发全量出现首页引导时序失败；对应测试独立复测通过，未修改无关业务或删除断言，最终串行全量复验通过：565 个文件、6757 项测试通过，8 个文件/11 项测试按既有条件跳过。

- 最终 tgz 的工具图片跨仓验收再次通过；已有官方/百炼文本代理的 8 场景回归也通过，覆盖历史模型 ID、正常请求、供应商模型不匹配、缺失 usage 与同会话恢复，失败场景零结算。
- 最终 tgz SHA-256：`f3a2274831b10a2171446c52f6eefb7cf404e6ecc9581a47d10320d37a4c90ef`；扫描发布清单未包含测试 fixture，也未发现本任务 worktree 路径。

## 2026-09-17 合并前复核

审查对象为 `codex/c20260916-deepseek-v41` 相对最新 `origin/dev`（`68832f858db597cb8de2c255f0fcfa0663976c07`）的完整分支差异，包含先前 V4.1 展示变更及其撤回。最终生产代码只有 `src/managed-ai/transport.ts` 的内容适配和 `src/managed-ai/adapter.ts` 的错误提示；未恢复价格/服务费展示，未修改模型目录、费率、协议、数据库结构、索引或配置项。

后端验收使用 `9f689f5238c81a859ab33b9b34ba9baeeba757a3`，其完整源码树与已合并 `origin/master` 的 `a58632a9` 一致。Web V4.1 改动已合入 `38ea4423`；更新的 Web master 仅增加录音页面改动，本次无额外 Web 变更。两个已合并仓库的旧远端任务分支已删除，不重新创建它们。

### 场景到代码及证据

| 场景 | 实际 owner / 边界 | 验证 |
| --- | --- | --- |
| 已保存模型 ID、官方与百炼 V4.1 | `adapter.ts` 的目录解析、`resolveModel`、`stream` 保留后台公开 ID；供应商路由仍由后端目录负责 | `managed-ai-adapter.test.ts` 目录用例；文本浏览器 8 场景 |
| 工具读图后继续回答 | DSH `read_image` 保存附件并返回 `tool-result`；`transport.ts:userContentLeaves/serializeMessages` 统一转换 | 正式 tgz、实际 Chrome、实际工具、后端 HTTP/MySQL 七次请求 |
| 同步与并行工具，图片上传乱序 | DSH `agent-loop/tool-calls.ts` 按模型顺序提交结果，额外上下文放在下一步；插件并发解析后按消息顺序组装，连续 tool 回复后追加图片 | 两个真实 read_image 调用；工具图片单测验证文本工具混排与各消息边界 |
| 同图重复、直接附件与工具图片共存 | 递归遍历统计每次出现；上传缓存只去重资产，序列化保留位置；后端 `AssetRefOccurrences` 与唯一资产分开 | 插件单测；浏览器/后端同时断言 2 次出现、1 个唯一资产 |
| 嵌套结果、只有图片、空结果、纯文本结果 | 同一递归函数；仅外层调用产生 tool 回复；空文本沿用 `(no output)` | 工具图片单测 |
| 数量、尺寸、总字节限制 | `requestImageAttachments` → `assertImageRequestWithinCapability` → `effectiveImageRules` → `assertPreparedImageRequestBytes`；后端再次校验 | 工具图片单测与已有 image-preparer 测试；后端 capability/provider-plan 测试 |
| 不支持内容、system/assistant 带图 | 全请求内容验证先于凭据读取、附件读取和上传；未放宽角色边界 | 工具图片单测验证上述副作用均未发生 |
| 工具返回普通文件，纯文本模型遇到历史图片 | DSH `LlmRuntime` 的 `projectFilesToText/projectImagesForTextModel` 先转换，插件不复制这些上游规则 | 对当前安装的生产 DSH `0.1.5-rc.2` 公开函数做嵌套 file/image 回放，原历史不变；浏览器模型往返切换 |
| 历史重放、压缩、切回视觉模型 | 转换只生成请求对象，不改持久消息；压缩标记保留 | 单测；浏览器切回后图片引用与首次相同 |
| 图片缺失、服务端资产过期 | 附件 owner 显式失败；可刷新的资产最多重新上传一次，非法请求不重试 | 工具图片单测、原 adapter 上传恢复测试；后端 service/input_asset 测试 |
| 取消、取消后重发、多个请求共享上传 | 复用既有 signal、并发队列及上传 waiter owner，最后一个等待者取消才中止上传 | 新工具读图取消测试及已有 adapter 共享上传/排队取消测试 |
| 换账号、换模型或能力规则 | 缓存键包含凭据指纹、附件、公开模型、能力版本和转换规则 | 新工具图换账号测试及已有 adapter 作用域测试 |
| 供应商失败、缺失 usage、失败后继续 | 后端校验供应商模型/usage；失败释放预占；插件保留明确错误，不自动重试付费请求 | 图片浏览器失败/恢复；官方和百炼文本浏览器错误模型/缺失 usage/恢复 |
| 基础价与 10% 服务费 | 后端 `Tariff` 与 `Charging` 独立快照；`PricingBasePlusChargePolicy.Apply` 对整笔基础费按万分比计算一次 | 每个成功图片请求基础费 14080、服务费 1408；失败三项均 0；逐条核验结算/释放及账户余额 |

### 审查与修复循环

1. 全差异及调用链审查未发现需要追加生产代码修改的问题。确认 `world-native-integration.test.ts` 的一行变更只是把既有断言对齐当前 `dev` 的 `backFromWorld()`，不涉及 World 业务实现。
2. 发现验收缺口：原图片浏览器测试没有覆盖图片请求失败后继续与切回视觉模型；原成功断言仅等待最后一个同名答案，可能命中上一轮答案。
3. 已补全七次图片请求场景，核验失败零扣费、预占释放及图片恢复；图片/文本两套浏览器测试均改为断言本轮新增一个答案。
4. 对修改后的测试再次运行：七次图片请求及账本核验通过，原官方/百炼文本八场景通过；再次审阅最终 diff，无未关闭的代码级阻断项。

本轮另外重跑 95 项插件相关测试，以及 `go test ./internal/managedai/... ./gin/managedai/... -count=1`，全部通过。生产代码与前轮完整 6757 项测试、类型检查、构建和 tgz 验收的版本一致；本轮只修改测试及本文档。tgz 中 `lib/index.js` 与工作区构建文件 SHA-256 均为 `7a52d5225926a73decd4f1b73e24a7f8d80060be1970a9b1fe1ad9b7896a0ffb`。

以上结论支持本分支合并。外网供应商调用、真实生产更新后的冒烟和 Windows/Linux 真机验收仍不在隔离 fixture 的证明范围内；发布后需确认客户端实际加载新插件，再复测原失败会话。不能把本报告当作已经发布到生产的证明。

## 发布

按现有插件发布链生成并分发新版本，客户端加载新产物后生效；仅合并代码或重新发布后台目录不会更新客户端运行代码。无需重发目录、改价、迁移会话或数据库。旧失败会话中的持久图片只要仍可读取，可由新适配器重新转换；图片已丢失时仍需用户重新提供附件，不能虚报读取成功。
