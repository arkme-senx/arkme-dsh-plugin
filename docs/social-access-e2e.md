# 社交 UI 目标运行时验收

`tests/e2e/social-access.e2e.mjs` 使用未修改官方 DSH Web scaffold、正式安装的插件包和真实 Chrome，验证已绑定首屏完整呈现、资料读取失败不改变展示、明确未绑定隐藏主要导航、恢复后草稿和编辑器身份保留。

账号/业务 HTTP 与浏览器收到的 profile 绑定观察是隔离夹具。既有 Host 登录资料保持绑定，不为 UI 测试改动登录策略；本次没有新增 Tools/SDK/Host 能力。本测试不等同于生产账号、短信或供应商通话验收。只使用本次创建的状态目录和唯一 Keychain service，不指定用户正在使用的 Profile。


准备条件：

1. 按项目脚本 build/pack 当前插件，保留不可变 `.tgz`。
2. 使用目标版本官方 CLI，在全新的 `DSH_HOME` 下通过 `dsh plugin --profile web add --workspace-root` 安装插件 `.tgz` 和该目标的官方运行时依赖。Profile 的插件依赖必须是 `file:...tgz`，不能是 `link:`。DSH 预发布版本应明确安装对应依赖，不能依赖 npm 默认 stable 标签；本次验证的是 `0.1.5-rc.2`。
3. 官方 DSH checkout 保持未修改且已具备其 Web 测试构建资产。使用该版本支持的 Node，安装 Chrome。
4. 生成仅用于本次夹具的 TLS 证书与私钥，证书包含 `subjectAltName=IP:127.0.0.1`。通过 `NODE_EXTRA_CA_CERTS` 信任该证书，不关闭 TLS 校验。

设置以下环境变量后，**在官方 DSH checkout 根目录**执行插件仓的 Vitest（这样其 `tsconfig.base.json` 与官方源码解析保持一致）：

```sh
export ARKME_DSH_CHECKOUT="<未修改的目标 DSH checkout>"
export ARKME_PACKED_PROFILE="<隔离 DSH_HOME>/profiles/web"
export ARKME_E2E_TLS_KEY="<本次夹具私钥>"
export NODE_EXTRA_CA_CERTS="<本次夹具证书>"
export ARKME_E2E_SCREENSHOT="<测试输出目录>/social-access.png"
cd "$ARKME_DSH_CHECKOUT"
node "<插件 checkout>/node_modules/vitest/vitest.mjs" run \
  --config "<插件 checkout>/vitest.social-access-e2e.config.mts"
```

默认单测不会运行此独立 E2E lane。测试完成还需核对安装包的 `lib/index.js`、`lib/client.js` 哈希与本次构建一致，并分别记录全量单测、官方安装、运行态与原生平台的结果，不能互相替代。
