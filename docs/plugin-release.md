# 插件自动发版

日常功能分支不修改 `package.json.version` 或 `arkme.updateNotice`。普通 PR 合并到 `master` 后，发布工作流自动确定版本，更新版本号、插件内更新说明和 GitHub Release 链接，再安装依赖，执行完整测试、类型检查、资源校验和构建。验证成功后会创建并合并 `release/v<版本号>` 发版 PR。

需要手动指定发版级别时，由发版负责人在 GitHub 的 **Actions → 准备插件发版 → Run workflow** 中选择级别并填写一句更新说明。该工作流先更新版本元数据，再安装依赖，执行完整测试、类型检查和构建，验证成功后创建发版 PR，等待合并。

`prepare` 成功后输出精确发布 SHA 和该提交中的版本，随后并行启动两条发布链路：`publish` job 检出该 SHA，完成类型检查、资源校验、构建和 npm 发布，再创建 Git Tag / GitHub Release；Runtime 派发 job 同时向默认分支发送 `arkme-plugin-release-prepared` 事件，由独立的 production workflow 校验 SHA 属于 master 历史、版本与提交一致，检出同一 SHA，构建 `tar.zst`，通过 Backend 获取单对象 STS 上传 OSS，并在 Runtime 校验通过后自动激活。

生产 Runtime 的构建、上传和激活均不等待 npm 发布、Registry 回读、Tag 或 GitHub Release。npm 发布失败不会阻断 Runtime；Runtime 发布失败也不会阻断 npm。`prepare`（包括版本准备与前置测试）仍是共同前提，失败时两条链路都不会启动；版本准备仍会读取 npm latest。生产 workflow 继续兼容旧的 `arkme-plugin-release-published` 事件，供历史工作流重跑使用。

npm 接受发布请求后仍可能异步处理版本。工作流以 15 分钟为等待窗口，每次未通过后间隔 5 秒回读精确版本，并在等待窗口结束时再检查一次；单次请求（含最后一次检查）最多 30 秒。日志会输出 HTTP 状态、网络或 JSON 错误，以及版本、integrity、provenance 的具体缺失或不一致字段。只有全部校验通过后才会继续创建 Tag、GitHub Release 和同步 master 到 dev；这段等待与生产 Runtime 独立。

每次普通 PR 发版时，会查询当前 master 版本对应的 `release/v<版本号>` PR 是否已合并。已经合并表示该版本已分配，即使 npm latest 仍落后，新一轮发版也会递增 patch，避免复用可能已经上线的 Runtime 版本。未分配的显式版本递增仍保持原版本；重跑同一次发版时，先复用已有 `release_sha`，并从该提交读取原版本，不重复分配。

npm 失败时，Runtime 可以先完成上线，对应的 Git Tag 和 GitHub Release 可能暂未创建。可重跑 npm 所在工作流的失败 job，继续发布同一提交的 npm 包。两条链路的结果分别查看 npm Action 与生产 Runtime Action；派发成功仅表示事件已发出。

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

普通 PR 合并到 `master` 后，完整构建由原来的 8 次减少为 3 次：npm `prepare`、npm `publish`、生产 Runtime 各 1 次。重跑并复用已有发布提交或合并 `release/v*` PR 时，npm `prepare` 会跳过验证和构建。批量测试内部用于验证产物的 `bundle` 调用单独保留，不计入这 3 次完整构建。

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

OSS bucket、直传 endpoint、CDN origin 与对象前缀只配置在对应 Backend 中，不进入 GitHub Secrets。测试环境使用 `/app/arkme/test/plugin/`，生产环境使用 `/app/arkme/prod/plugin/`；Backend 会去掉首尾斜杠后生成 OSS Object Key。production 与 pre-release Runtime workflow 都使用全局串行 concurrency，且不会取消正在运行的发布。

`pre-release` 分支必须通过 GitHub Ruleset 禁止直接 push，要求 PR 和 CODEOWNERS 审批；`pre-release` Environment 也必须限制为该受保护分支。工作流会在无 Secret 的 job 中构建触发提交，再由持密 job 从受保护的 `master` 检出发布工具和锁定依赖，下载并重新校验制品后发布。

对应 OSS bucket 必须为各环境规范化后的 `object-prefix` 启用 Bucket 级覆盖保护规则：测试环境为 `app/arkme/test/plugin/`，生产环境为 `app/arkme/prod/plugin/`。GitHub Actions 上传时也会发送 `x-oss-forbid-overwrite: true`，但 Bucket 级规则才是对临时 STS 凭据的服务端强制约束；未完成该配置前不得启用 `arkme-plugin-ci`。

## 版本选择

- `patch`：修复和小优化，如 `0.1.19 → 0.1.20`。
- `minor`：新增一组用户可见能力，如 `0.1.19 → 0.2.0`。
- `major`：存在不兼容变更时使用。
