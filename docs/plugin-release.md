# 插件自动发版

日常功能分支不修改 `package.json.version` 或 `arkme.updateNotice`。普通 PR 合并到 `master` 后，发布工作流自动确定版本，更新版本号、插件内更新说明和 GitHub Release 链接，再安装依赖，执行完整测试、类型检查、资源校验和构建。验证成功后会创建并合并 `release/v<版本号>` 发版 PR。

需要手动指定发版级别时，由发版负责人在 GitHub 的 **Actions → 准备插件发版 → Run workflow** 中选择级别并填写一句更新说明。该工作流先更新版本元数据，再安装依赖，执行完整测试、类型检查和构建，验证成功后创建发版 PR，等待合并。

`prepare` 成功后输出精确发布 SHA 和该提交中的版本，随后并行启动 npm 和生产 Runtime 两条链路。npm 发布与 Registry integrity / provenance 回读校验继续独立运行，但不再创建 Tag 或 GitHub Release。npm 成功后仍按原规则同步 master 到 dev。Runtime 不等待 npm，派发成功只表示事件已发出。

## 生产 Runtime 更新说明与正式发布标记

生产 workflow 使用 master 上受保护的发布工具，并将待构建的精确发布提交检出到独立目录。先固定上次已成功激活的生产版本 Tag 与本次 SHA，再读取最终代码差异、提交和关联的已合并 master PR，通过 OpenAI Responses API 生成说明。测试渠道保持原流程。

公开说明只有连续编号，每条独占一行，不含标题或分类名，顺序为新增功能、体验优化、问题修复。例如：

```text
1. 新增聊天记录导出。
2. 优化消息加载速度。
3. 修复录音中断问题。
```

每条正文包含末尾中文句号最多 15 个 Unicode 字符，编号和编号后的空格不计入。脚本按类别排序、去重并校验；超长或无有效证据的条目要求模型重新生成，最多修正一次，禁止直接截断。短摘要依次选取完整的前置条目，拼接后最多 120 字符，写入本次临时构建目录的 `arkme.updateNotice.summary`；不提交版本号或锁文件变化。

完整说明保存在 `.production-release/notes.txt`，版本、源码、基线、内部分类及证据引用保存在 `record.json`。按版本与 SHA 精确匹配的 Actions cache 在构建前保存，运行附件保留 90 天。创建 Runtime 版本时，发布脚本读取该记录中的同一份 UTF-8 文本，将完整多行说明放入 `POST /api/public/v1/ci/arkme-plugin/runtime/versions` 的 `notes` 字段，不使用短摘要代替。

Runtime 制品上传后，等待 Backend 校验并激活成功；发布脚本再次读取 Backend，核对版本、源码、已激活标记和完整说明，随后创建指向精确发布 SHA 的 `vX.Y.Z` Tag 和 GitHub Release，Release 正文使用同一份说明。npm 成功但 Runtime 未成功激活时不会创建正式 Tag；npm 失败不阻断 Runtime 的 Tag / Release。

### 基线与重跑

- 只检查属于本次源码祖先历史的稳定版本 Tag，按版本倒序核验 Backend 同版本的源码和 `last_activated_version_code > 0`；npm 历史 Tag、测试 Tag、未激活或源码不匹配的版本均不能作为基线。最多检查 100 个稳定 Tag，达到上限后要求补充历史映射，不静默使用错误范围。
- 自动版本使用 Backend 既有确定性 UUID。人工创建过的历史 Runtime 可在 production Environment 的 `ARKME_LEGACY_RUNTIME_IDS` 变量填写 JSON 映射，例如 `{"v0.1.73":"实际版本UUID"}`；映射只提供查询 ID，仍必须通过 Backend 激活记录和源码核验。
- 没有已核验历史 Tag 时记录“首次发布”，不把整个仓库历史当本次更新。没有用户变化、缺少模型配置、API 失败、格式修正失败或证据超限时，固定降级为 `1. 完成本次版本更新。`，并记录具体状态；不编造功能，不阻断原有发版。
- 模型请求单次最多 45 秒，临时失败最多重试两次，整次生成最多 5 分钟。大型差异分块处理再合并；单文件补丁上限 150,000 字符、总证据上限 600,000 字符，超限明确降级而非截断冒充完整说明。仅发送必要的 src/assets 文本差异和关联提交/PR，不发送环境配置或锁文件。
- 同版本重跑优先读取 Backend 已存说明，再读取精确版本 cache；Backend 的授权错误、网络故障不视为“版本不存在”。已有版本的源码不一致时拒绝继续。
- Backend 已确认该版本曾成功激活时，跳过构建、上传和重复激活，只补齐 Tag / Release，因此旧任务重跑不会回滚已上线的新版本。激活返回超时也可通过下一次读取该标记恢复。
- Runtime 发布失败不打 Tag。激活成功后 GitHub 故障，可以重跑生产 workflow 的失败 job；已有 Tag 必须指向相同 SHA，已有正式 Release 保留人工编辑，不覆盖、不强推。

普通 PR 发版仍保留已分配版本判断：已合并的 `release/v<版本号>` 表示该版本已分配，即使 npm latest 落后，也递增 patch。重跑同一次发版时复用原发布 SHA 和版本，不重复分配。

npm 发布仍有 180 秒命令超时和 15 分钟 Registry 回读窗口。版本已暂存、已发布冲突或网络超时不直接视为成功，必须回读精确版本的 integrity 与 provenance；权限等其他错误仍立即失败。其结果不影响 Runtime 正式发布标记。

`pre-release` 分支的每次 push 会走同一套 Runtime 发布链路，但不会发布 npm。测试版本由稳定基准版本的下一补丁与 GitHub run number 组成，例如 `0.1.34` 在 run `128` 中生成 `0.1.35-pre.128`；版本修改只存在于 Action 临时工作区。

## Runtime 测试开关

两个 Runtime workflow 分别通过文件顶部的 `env.RUN_TESTS` 控制批量测试：

| 发布路径 | Workflow | 默认值 |
| --- | --- | --- |
| `master` 发版准备成功后，与 npm 并行发布生产 Runtime | `.github/workflows/publish-production-runtime.yml` | `'false'`：跳过 Runtime 批量测试 |
| `pre-release` push 后构建测试 Runtime | `.github/workflows/publish-pre-release-runtime.yml` | `'true'`：执行 Runtime 批量测试 |

需要调整时，在对应 workflow 中把 `RUN_TESTS` 改为字符串 `'true'` 或 `'false'`。`执行 Runtime 测试` 是独立步骤，仅在值为 `'true'` 时运行 `pnpm test`，测试失败会阻止后续构建和发布；关闭时该步骤显示为跳过。开关只控制批量测试，类型检查、资源校验、构建、打包和发布校验仍然执行。

生产 Runtime 默认跳过测试，依赖正式发版的前置测试：普通 PR 在 npm 发布 workflow 的 `prepare` job 中执行测试；`release/v*` PR 会跳过该测试步骤，应由“准备插件发版”workflow 创建并完成测试。手工创建或修改发版 PR 时，需要另行确认最终发布内容已通过测试；无法确认时，应先把生产 Runtime 的 `RUN_TESTS` 设为 `'true'`。该开关本身不验证前置测试记录。

## CI 构建开关

四个发版 workflow 通过 `env.ARKME_SKIP_PREPARE_BUILD: 'true'` 跳过项目自身的 `prepare` 隐式构建，安装依赖和 Runtime 的 `pnpm pack` 不再重复编译。每个需要构建的 job 仍显式执行一次 `pnpm run build`，该命令不受开关影响；依赖安装脚本的执行策略保持原样。

普通 PR 合并到 `master` 后，完整构建为 3 次：npm `prepare`、npm `publish`、生产 Runtime 各 1 次。重跑并复用已有发布提交或合并 `release/v*` PR 时，npm `prepare` 会跳过验证和构建。批量测试内部用于验证产物的 `bundle` 调用单独保留，不计入这 3 次完整构建。

正式版本元数据在安装依赖前写入，避免安装后修改版本导致 pnpm 再次安装。Pre-Release 仍先安装依赖并测试稳定源码，再生成测试版本、显式构建和打包；即使 pnpm 因版本变化重新检查或安装依赖，`prepare` 也会跳过构建。

本地不设置该变量或设为 `'false'` 时，安装和打包仍自动构建。仅精确值 `'true'` 会跳过隐式构建；它与 `RUN_TESTS` 相互独立。CI 打包使用显式构建生成的产物，Runtime 打包器仍检查必需文件和版本，缺少入口文件会失败。

## 一次性配置

在 npm 包 `@senguoyun/dsh-arkme` 的发布设置中创建 GitHub Trusted Publisher，绑定：

- GitHub Organization：`arkme-senx`
- Repository：`arkme-dsh-plugin`
- Workflow：`publish-plugin-release.yml`

Trusted Publisher 配置完成后，GitHub Actions 通过短期身份凭据发布 npm，不需要把 npm Token 保存到 GitHub Secrets。

另外需要分别在 `production` 和 `pre-release` GitHub Environment 中配置：

- `ARKME_BACKEND_BASE_URL`：对应环境 Backend 的 HTTPS origin。
- `ARKME_CI_TRIGGER_SECRET`：对应环境 Backend 的 CI Bearer Secret。

仅在 production Environment 额外配置：

- Secret `OPENAI_API_KEY`：专用于更新说明生成的 OpenAI API Key。
- Variable `OPENAI_RELEASE_NOTES_MODEL`：有权访问且支持 Responses structured outputs 的固定模型 ID。
- 可选 Variable `ARKME_LEGACY_RUNTIME_IDS`：历史 Tag 到人工 Runtime UUID 的映射。

密钥只传给生成步骤；缺少模型配置会产生明确降级说明。本地测试使用模拟服务，不要求真实密钥。

OSS bucket、直传 endpoint、CDN origin 与对象前缀只配置在对应 Backend 中，不进入 GitHub Secrets。测试环境使用 `/app/arkme/test/plugin/`，生产环境使用 `/app/arkme/prod/plugin/`；Backend 会去掉首尾斜杠后生成 OSS Object Key。production 与 pre-release Runtime workflow 都使用全局串行 concurrency，且不会取消正在运行的发布。

Runtime 发布默认不设置兼容范围，Backend 会从当前环境中最高已发布的 Arkme 插件版本继承并持久化范围。需要为首个版本或明确的兼容调整指定范围时，在发布环境设置 `ARKME_HARNESS_VERSION_CODE_RANGE`，值为 JSON，例如 `{"min":1,"max":42}`。发布脚本会在激活前校验 Backend 返回并持久化的范围，并在日志中输出该范围和继承来源。

`pre-release` 分支必须通过 GitHub Ruleset 禁止直接 push，要求 PR 和 CODEOWNERS 审批；`pre-release` Environment 也必须限制为该受保护分支。工作流会在无 Secret 的 job 中构建触发提交，再由持密 job 从受保护的 `master` 检出发布工具和锁定依赖，下载并重新校验制品后发布。

对应 OSS bucket 必须为各环境规范化后的 `object-prefix` 启用 Bucket 级覆盖保护规则：测试环境为 `app/arkme/test/plugin/`，生产环境为 `app/arkme/prod/plugin/`。GitHub Actions 上传时也会发送 `x-oss-forbid-overwrite: true`，但 Bucket 级规则才是对临时 STS 凭据的服务端强制约束；未完成该配置前不得启用 `arkme-plugin-ci`。

## 版本选择

- `patch`：修复和小优化，如 `0.1.19 → 0.1.20`。
- `minor`：新增一组用户可见能力，如 `0.1.19 → 0.2.0`。
- `major`：存在不兼容变更时使用。
