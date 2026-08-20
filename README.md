# DSH Arkme Plugin

Arkme 的 DeepSeek Harness 集成插件。

## 安装与启动

```sh
DSH_HOME=<arkme-dsh-home> dsh plugin --profile web add @senguoyun/dsh-arkme
DSH_HOME=<arkme-dsh-home> dsh web --port 3081
```

安装本地构建：

```sh
pnpm pack --pack-destination <artifact-directory>
DSH_HOME=<arkme-dsh-home> dsh plugin --profile web add <artifact-directory>/senguoyun-dsh-arkme-<version>.tgz
DSH_HOME=<arkme-dsh-home> dsh web --port 3081
```

## 本地开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```
