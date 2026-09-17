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

预期四次请求图片出现次数为 `0 / 2 / 2 / 0`，唯一图片为 `0 / 1 / 1 / 0`。前两次是工具调用与工具结果续跑，第三次为同会话历史重放，第四次切换纯文本模型。固定 usage 下每次基础费用 `14080 nano-CNY`、10% 服务费 `1408 nano-CNY`、总计 `15488 nano-CNY`，每请求一次结算，最终预占为零。

## 本次验收记录

- 已用生产故障的实际 `read_image` 工具结果，对最终 tgz 内的序列化代码作不联网回放：一个关联工具消息、一个 user 图片消息、一个图片引用，原持久消息不变。
- 新增 21 项工具图片测试通过，原图片/适配器相关测试继续通过；类型检查、构建通过。
- 隔离浏览器链路使用未修改官方 DSH `d347e703908d0406b7a7ef80e3a0e594d86b2215`；真实会话的工具读图、历史重放、纯文本模型切换以及四次后端结算均通过。该浏览器环境与生产安装的 DSH 版本不同；生产当前内容结构已独立核对并回放，未替换用户常驻实例。
- 初轮全量出现打包检查失败、后续并发全量出现首页引导时序失败；对应测试独立复测通过，未修改无关业务或删除断言，最终串行全量复验通过：565 个文件、6757 项测试通过，8 个文件/11 项测试按既有条件跳过。

- 最终 tgz 的工具图片跨仓验收再次通过；已有官方/百炼文本代理的 8 场景回归也通过，覆盖历史模型 ID、正常请求、供应商模型不匹配、缺失 usage 与同会话恢复，失败场景零结算。
- 最终 tgz SHA-256：`f3a2274831b10a2171446c52f6eefb7cf404e6ecc9581a47d10320d37a4c90ef`；扫描发布清单未包含测试 fixture，也未发现本任务 worktree 路径。

## 发布

按现有插件发布链生成并分发新版本，客户端加载新产物后生效；仅合并代码或重新发布后台目录不会更新客户端运行代码。无需重发目录、改价、迁移会话或数据库。旧失败会话中的持久图片只要仍可读取，可由新适配器重新转换；图片已丢失时仍需用户重新提供附件，不能虚报读取成功。
