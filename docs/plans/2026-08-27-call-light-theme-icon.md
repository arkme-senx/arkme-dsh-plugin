# 2026-08-27 通话页浅色模式视频图标适配

## 范围

本次只修复 Arkme 插件通话页里的视频通话图标主题适配。通话历史、发起通话、Host API、Tools、SDK 和桌面通话资源分发契约不变。

## UI 图

```text
浅色模式
┌─ 通话列表 ─────────────────┐   ┌─ 通话详情 ────────────────────┐
│ 头像  姓名                 │   │ 姓名                 [电话][视频]│
│      [currentColor 视频] 视频通话 │   │ AI 摘要 / 视频回放 / 转写       │
└───────────────────────────┘   └───────────────────────────────┘

深色模式
┌─ 通话列表 ─────────────────┐   ┌─ 通话详情 ────────────────────┐
│ 头像  姓名                 │   │ 姓名                 [电话][视频]│
│      [currentColor 视频] 视频通话 │   │ AI 摘要 / 视频回放 / 转写       │
└───────────────────────────┘   └───────────────────────────────┘
```

## 交互图

```text
用户进入通话页
  -> DSH 注入当前主题 token
  -> ArkmeCallSurface 使用 arkmeTheme.text / secondary / tertiary
  -> 视频图标以内联 SVG stroke=currentColor 渲染
  -> 图标随父级按钮或元信息颜色变化

用户点击视频按钮
  -> outgoingCallUi.request({ mediaType: "video" })
  -> 现有通话 runtime 继续处理准备、权限、发起和失败反馈

主题切换或宿主 token 改变
  -> 父元素 color 更新
  -> 视频 SVG 自动继承新颜色
  -> 不再依赖 invert/brightness filter，避免浅色模式洗白
```

## 能力矩阵

| 能力面 | 结论 | 证据 |
| --- | --- | --- |
| UI | 修改视频图标渲染方式，让浅色/深色均继承主题色。 | `ArkmeCallSurface` 的 `CallVideoIcon` 使用 `currentColor`。 |
| Tools | N/A，未新增或改变模型工具能力。 | `arkme_call_start` 契约不变。 |
| SDK | N/A，未新增或改变外部插件 SDK 能力。 | 公开导出与类型不变。 |
| Host owner | N/A，未新增 Host 路由、查询、命令或持久化。 | 通话发起仍走 `outgoingCallUi` 和既有 Host owner。 |
