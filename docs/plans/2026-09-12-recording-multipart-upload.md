# 录音导入使用云无关分片传输

现有录音导入的 Host owner 保持不变；`AudioRecordingImportGateway.upload` 改为调用 `recording-file-upload`。上层 Tool、SDK 和 UI 仍消费原导入任务与进度，不获得对象地址、云密钥或新存储操作能力。

公开 SDK 的文件导入使用已授权的 fileRef，同一账号持有的导入引用查询／重试。新增的是能力探测字段和类型化适配器，不是部署配置；敏感写入仍需同源 Provider 传输，不为外部插件放宽 Origin。SDK 无驻留任务／监听器，Consumer 在自身 dispose 时取消 AbortController；Host 一旦接收任务，其持久上传仍由原 coordinator 负责。

| 能力面 | 路径与语义 | 当前证据 |
| --- | --- | --- |
| Tools | 已有录音导入 Tool → 导入 coordinator → 同一 gateway | 官方 DSH preset/授权/ToolRuntime 真实调用通过；确认前无写入，确认后重组字节一致 |
| SDK | 新增公开的类型化文件导入／状态／重试 SDK → 同一 coordinator | 补齐原先仅内置 Host 操作；独立 Consumer 编译/调用、旧能力拒绝、取消、真实分片恢复通过 |
| UI | 原导入页面和任务进度；暂停／重试继续用已保存的任务 | 真实 Chrome 选择文件/修改开始时间/导入/服务端接收后等待处理状态通过 |
| Host owner | Audio 确认归属、对象布局和完成；插件只保存本地源身份与续传 ID | 当前 owner/gateway/传输测试通过，后端全仓 race 通过 |

上传不再请求 OSS STS 或拼接 bucket/key。服务端返回分片布局；Host 对同一个文件句柄按有界块计算分片 MD5，另以流读取该范围到云端，内存不跟随源文件或分片总长度增长。整文件 SHA-256 在完成前与已保存的来源摘要核对；恢复时即使跳过已上传片，也检查对应本地内容。传输因此读取待上传片两遍、已上传片一遍，不能将它宣传为零额外本地 IO。

续传只持久化 upload_id、part_size、child_id 和来源大小／摘要。旧 OSS SDK 的 opaque checkpoint 在本地边界丢弃，未完成的片重新上传；已完整的云对象由服务端 HEAD 调和。无长期双传输链，不增加 Job phase。分片完成后仍调用现有 child-upload-finish 和 finish-session。

授权每片前重新检查账号，字节请求不带 账号 Token 或 Cookie；只接受 HTTPS、禁止 URL 用户名密码与重定向，校验摘要／长度头，网络错误不将签名 URL 写入公开任务错误。普通中断保留 checkpoint；显式取消先尽力 abort 云分片，再走既有 owner 删除，即使 abort 暂时失败也由现有分片生命周期收口。

本轮未修改 DSH、根 README、版本号或 lockfile，未推送／安装到常驻实例。真实 OSS/S3 权限与网络、Windows/Linux 实机和全天大文件仍须验收，单机测试不是生产容量证明。

## 安装包验收

通过未修改官方 DSH `d347e703908d0406b7a7ef80e3a0e594d86b2215`，新建临时 DSH_HOME（路径含空格），由官方 `plugin add` 安装 `.tgz`。Profile 的包管理器版本采用该 DSH 声明的版本，运行使用已有原生依赖对应的 Node 24；没有修改全局默认版本、DSH 或常驻实例。

`scripts/run-recording-pages-e2e.sh` 验证两个真实运行场景：

- 录音分页、跨页全文搜索/导出、Opus 播放、旧 revision 拒绝及公开 SDK。
- 300 秒 / 9.16 MiB WAV 通过公开 SDK 导入，在第二片 HTTP 503 后用持久 checkpoint 恢复；实际 PUT 序号为 `1,2,2`，重组后与原文件逐字节一致。DSH 会话首次 Tool 调用要求确认且没有上传，fixture 通过官方 Session API 记录确认结果和后续用户确认事件后再调用，才完成第二份文件。Chrome 页面上传第三份文件，状态由准备切换为等待处理。

Audio/云端是隔离 HTTPS 协议 fixture；文件流、MD5/SHA-256、Host 本地状态、安装包、SDK、DSH Agent preset/授权与 ToolRuntime、浏览器均使用真实实现。会话事件由 fixture 生成，没有调用真实 LLM 提供方或生产业务。脚本在目标 DSH 目录之外，不以私有 DSH 路径作为产品依赖。

当前不可变 `.tgz` SHA-256 为 `1c899bde84f777e811729f083683f6fc4538163c57a3fdbbcf53d08b19bb07d4`。包内无任务机器绝对路径；根 README、版本号及 lockfile 保持原样。
