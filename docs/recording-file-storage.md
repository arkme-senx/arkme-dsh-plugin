# 文件级云端音频大小

音频文件行显示“云端 … MB”，单位固定 MB，沿用文件列表已有的 1024² 换算。普通大小保留两位小数，极小正数最多保留六位，正值不会因切换到 B 或取整而失真。数值统计正式播放包、增强补充包及历史正式音频；不包含上传原件、处理临时文件与独立策略对比。原有文件大小和计费字段含义不变。

## 共享入口

- Host/UI：`recordings.files.storage`，一次 1–20 个不同的当前账号不透明 `sessionRefs`。
- SDK：`recordingFileStorage(input, signal?)`，公开 `RecordingFileStorage` / `RecordingFileStoragePage`，发现 `features.recordingFileStorageV1`。
- Tool：`arkme_recording_file_storage`，business/hybrid 只读能力，参数 `session_refs`。
- 三者共用 RecordingService / RecordingFileStorageService；正式媒体字节由 Audio owner 解释，插件不重复解释上传、配额或对比数据。

每项成功结果只有 `sessionRef`、非负整数 `bytes`、`checkedAtMillis`；没有 null 或存储状态。0.00 MB 表示当前未接受正式媒体，之后可能增长。统计不触发模型、回填、计费或清理，也不暴露 Key、签名 URL 或内部身份。

## 生命周期

页面只查询所展示日期的文件，按 20 个分批，全部完成后一次发布成功结果以避免长列表逐批反复渲染。切日、账号、失活、删除和刷新取消旧请求并丢弃晚到结果。请求错误保留已有数值和全部文件操作，页面提供“重试读取存储”；不把错误变成 0，不展示“云端暂不可用”。没有后台轮询或持久缓存。

SDK 共用既有请求生命周期：调用者 signal 与 dispose 都取消在途统计并拒绝晚到响应。账号变更前后复核与不透明引用保持当前账号边界。

## 验证

`pnpm test`、`pnpm run typecheck`、`pnpm run build`。安装验收为 `tests/e2e/recording-file-storage-installed.mjs`：环境提供官方 DSH CLI、不可变 tgz、Playwright 锚点、真实 Go fixture 的 ready.json 和证据目录；创建全新含空格路径 DSH_HOME/Profile，文件列表及统计转发真实认证 Audio API/Mongo，验证正式 Agent Tool、仓外 SDK 编译/调用/取消与 Chrome 页面。身份及其他外部服务使用确定性回环 fixture。结束时关闭本次 Host/浏览器。

没有新增版本号、配置项、集合、持久字段、索引或上线数据步骤。
