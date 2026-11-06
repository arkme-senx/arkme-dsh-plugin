# 管家引用回复验收（2026-11-06）

## 发现与修复

实际 PC 负责人通过决策卡回复时，页面缓存的 `arkme-bot-v2` 引用已过期，Host 在发送前拒绝并保留草稿。Chat 已支持按当前用户有权读取的原消息及祖先消息定位管家；决策回复不应再依赖缓存的 Bot mention。

本次仅调整客户端：真实管家卡片的决策、补充和进度询问沿用原消息引用；普通 Bot 的延展 mention 行为保留。没有新增 Host 路由、权限、配置或持久化。人类伪造的卡片文字、转发内容、不可操作消息不启用此入口。发送授权及唯一接收方仍由 Chat owner 验证，负责人身份仍由 Runner 核验。

能力矩阵：UI 已实际验证；Tools/SDK 无新增业务能力（N/A）；既有消息发送与引用 owner 不变。

## 真实链路证据

使用未修改的官方 DSH 0.2.1-rc.2，插件 worktree 生成的不可变 3.0.55 tgz，经官方 plugin add 安装到专用测试 Profile。没有操作其他 DSH 实例。

- 原任务：`3f776b6d-06cb-4ad7-b4f9-2561cc1b2c50`，Vivo 实机群内派工。
- 决策：`b9d1949c-1350-4860-86f9-f57ec87a1b0d`。
- 修复后点击“采用建议并回复”，自动生成引用草稿，无 Bot mention。
- 18:17:24 负责人发送；消息 `2f77240c-41e8-42d8-a4c5-4df1cb760da2`。
- Runner 核对负责人账号并将该决策标记 completed，原任务恢复原生 Codex 主会话；移动端同步展示已收到负责人回复。
- 主会话继续派发独立开发任务 `425195c8-7068-47a1-9c7e-4ee1040471d4`，未把回复错误地创建为另一项开发。

## 自动检查

- 相关 5 个文件 65 tests passed；typecheck、build、pack 通过。
- 完整插件测试：1511 files passed / 5 failed / 29 skipped；17007 tests passed / 6 failed / 39 skipped。
- 首轮与打包同时运行导致构建产物竞争，部分 UI 测试超时或时序断言失败；停止并行构建后，全部失败文件串行复跑 5 files / 92 tests passed。没有通过修改断言、扩大超时或跳过测试规避失败。
- Runner 回归 117 tests passed。

## 范围

基于既有功能分支 `codex/runner-conversation-20261106`。验收时已 fetch 最新 dev `ad6a033dda683528c96a761b279185bdbc3f580e`；其推进未修改本次客户端实现文件。上述实际安装证据对应本次 feature tree，不冒称最新 dev 集成包或 Windows/Linux 已实测。完整开发交付链的记录见 Runner 仓库验收报告。
