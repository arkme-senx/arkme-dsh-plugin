# 发给自己输入框聚焦稳定性回归

## 原因与修复

- 聚焦前后，输入卡片本身均为 103px；变化来自卡片上方统计栏：空草稿失焦时为 0px，聚焦时为 20px。
- 消息视口因此从 809px 缩为 789px，底部锚定使最后一条消息上移 20px。
- 经用户确认，非私聊输入区固定预留 20px 统计栏；私聊维持原有 30px。字数、时长和快捷键仍按原规则显隐，不改变发送、采集或编辑行为。
- 修改前备份：`/tmp/arkme-composer-focus-before-Rkuihn/changes.tar.gz`，含本次涉及的源码和测试原文件。

## 自动化回归

10 个测试文件、417 项测试通过：

```sh
./node_modules/.bin/vitest run \
  tests/conversation-send-directory.test.tsx \
  tests/conversation-composer-presentation.test.tsx \
  tests/conversation-resize-anchor.test.ts \
  tests/resizable-composer-dom.test.tsx \
  tests/resizable-composer.test.tsx \
  tests/conversation-composer-border.test.tsx \
  tests/conversation-composer-visual.test.ts \
  tests/composer-focus.test.ts \
  tests/composer-click-focus.test.tsx \
  tests/composer-paste-focus.test.tsx --maxWorkers=2
```

渲染测试覆盖私聊、群聊、发给自己、主题、未分类的聚焦、失焦、输入、清空以及时长显示切换。
`pnpm run build`（含 TypeScript 声明检查、打包及可执行入口校验）和 `git diff --check` 通过。

## 3098 实际页面回归

- 独立 Chromium 测试，1440px、720px 两种宽度，各覆盖最新消息底部与历史阅读位置，每种场景连续聚焦/失焦 3 次。
- 四种场景的消息位置、滚动位置、消息视口、输入卡片几何均保持不变；消息位移为 0px。
- 统计栏始终 20px，输入区整体始终 143px；统计文字、快捷键在聚焦时显示，空草稿失焦时隐藏。
- 无页面异常。测试未发送消息、修改记录或开启录音；未出现被拦截的业务写请求。
- 已更新 3098 独立 Web 预览，核对安装的 20 个 JavaScript 包与本地构建一致。未改动已安装桌面客户端，未提交或推送。
- 复现脚本：`/Users/tison/arkme/.codex-artifacts/web-preview-3098/check-composer-focus.mjs`。
