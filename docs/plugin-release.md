# 插件自动发版

日常功能分支不修改 `package.json.version` 或 `arkme.updateNotice`。功能合并到 `master` 后，由发版负责人在 GitHub 的 **Actions → 准备插件发版 → Run workflow** 中选择发版级别并填写一句更新说明。

该工作流会自动创建 `release/v<版本号>` 发版 PR，并在其中更新版本号、插件内更新说明和 GitHub Release 链接，随后执行完整测试、类型检查和构建。

合并该发版 PR 后，发布工作流会再次验证代码，发布 npm 包、创建 `v<版本号>` Git Tag，并生成 GitHub Release。随后由独立的 production workflow 校验 npm、Tag、GitHub Release 与发布 SHA，检出该精确 SHA，构建 `tar.zst`，通过 Backend 获取单对象 STS 上传 OSS，并在 Runtime 校验通过后自动激活。

`pre-release` 分支的每次 push 会走同一套 Runtime 发布链路，但不会发布 npm。测试版本由稳定基准版本的下一补丁与 GitHub run number 组成，例如 `0.1.34` 在 run `128` 中生成 `0.1.35-pre.128`；版本修改只存在于 Action 临时工作区。

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
