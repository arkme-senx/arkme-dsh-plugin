# 插件自动发版

日常功能分支不修改 `package.json.version` 或 `arkme.updateNotice`。功能合并到 `master` 后，由发版负责人在 GitHub 的 **Actions → 准备插件发版 → Run workflow** 中选择发版级别并填写一句更新说明。

该工作流会自动创建 `release/v<版本号>` 发版 PR，并在其中更新版本号、插件内更新说明和 GitHub Release 链接，随后执行完整测试、类型检查和构建。

合并该发版 PR 后，发布工作流会再次验证代码，发布 npm 包、创建 `v<版本号>` Git Tag，并生成 GitHub Release。

## 一次性配置

在 npm 包 `@senguoyun/dsh-arkme` 的发布设置中创建 GitHub Trusted Publisher，绑定：

- GitHub Organization：`arkme-senx`
- Repository：`arkme-dsh-plugin`
- Workflow：`publish-plugin-release.yml`

Trusted Publisher 配置完成后，GitHub Actions 通过短期身份凭据发布 npm，不需要把 npm Token 保存到 GitHub Secrets。

## 版本选择

- `patch`：修复和小优化，如 `0.1.19 → 0.1.20`。
- `minor`：新增一组用户可见能力，如 `0.1.19 → 0.2.0`。
- `major`：存在不兼容变更时使用。
