# 录音 owner 分页与媒体接入

本任务继续既定 dev 任务分支。录音正文、归属、可见性及媒体的事实 owner 均为 Audio；插件 Host 只作当前账号的受控消费适配。固件与 DSH 源码不修改，根 README、版本号和 lockfile 保持。

| 能力面 | 本次接入与验收责任 |
| --- | --- |
| UI | 既有录音工作台改为 owner 分页与按需媒体解析，公开不透明 itemRef/mediaRef 合同保持；Host/client、分页/比较/搜索/批量、真实页面须验收 |
| Tools | 保留当前 OpenAPI/MCP 的权威录音读取路线，不复活已被 `tests/recording-agent-tools.test.ts` 明确退休的 transcript/calendar Tools。导入与漫画等独立命令保留其入口和权限；完整内容消费者须验收 |
| SDK | 既有公开调用透传相同 Host owner 和账号作用域，不暴露 locator、存储路径或 token；分页扩展的公开类型、仓外 consumer 和卸载语义须验收 |
| Host owner | RecordingService 负责工作台投影/不透明引用，MediaService 负责凭据、当前账号媒体解析和二进制转发；Audio 决定完整修改范围和身份，禁止客户端猜编号 |

工作台使用 ClipLocator：与不可变 ClipRef 分开解析，点击时向 Audio resolve，严格核对 child/source/ordinal、返回固定路径与媒体类型。只有 Host 看见内部定位信息；外部仍得到已有 mediaRef。包括历史录音在内，RecordingService 均消费 Audio 的媒体入口；旧 FLAC 解释留在 Audio 的最外层。插件其他独立业务的旧签名媒体保持原合同，现代引用失败不能回退 OSS。

验证记录随实现追加；不能用构建成功代替不可变 tgz 在未修改官方 DSH 中的实际验收。


ClipLocator 媒体 owner 的 81 项相关测试及 typecheck 已通过（任务 evidence 日志 `.plugin-locator-tests.log` / `.plugin-locator-typecheck-final.log`）。

新增 `RecordingReadOwner` 作为 Host 对 Audio 的单一读取适配：metadata 每页 50 条；首次每个录音只请求一个正文片段作时间排序前瞻，后续按当前录音游标读取；两个请求并发通道，正文返回 100 条/20,000 Unicode 字符以内。跨录音通过各自 revision/cursor/skip 做无持久状态的归并续页，游标只含定位/版本与末片连续性信息，不存正文。所有录音视图（包括此前已读完的录音）在续页重验，账号或日期/source 更换即拒绝。全文消费者显式 exhaust 并按原 ordinal 拼接 Unicode 片段。

`.plugin-owner-read-tests.log` 14 项通过：重叠录音 500 句全量不漏重、首次只取前瞻+所需页、超过 50 录音的元数据分页、超过 30,000 Unicode 字符并含 emoji/空白的完整拼接、已完成录音修订变化、日期/source/账号切换、定位/文本/游标/时间等损坏 fail closed。读取适配严格接收 Audio 的 coverage/is_background/event，不能把首屏条数充当全日进度。

## 正式消费与完整性

RecordingService、Host、SDK 和工作台均已接入相同读取适配。`recordingDay` 与对比页面只取首页；`recordings.transcript.page`／SDK `recordingTranscriptPage` 暴露 `viewRef`、`nextCursor` 及 Unicode 正文位置，不公开内部 ID、云地址或凭据。Provider 明确公布 `recordingTranscriptPages` 能力；不支持时显式拒绝，未新增运维开关。跨录音游标使用当前账号／日期／来源的加密引用，固定上限 8 MiB；该读操作使用既有 10 MiB 请求边界，超限拒绝而非截断。首屏仍需读完全日录音元数据并对每个录音做前瞻，不宣称与录音数无关。

滚动、跳转和完整读取共享每视图一个续页请求；失败保留已读前缀，重试从原游标继续。账号、环境、日期、来源或修订变化取消旧请求，迟到结果不发布。搜索、导出、生成及既有完整 SDK 消费显式读至末页；导出失败不产生半份文件，取消不向新页面报告旧错误。过长单句按 Unicode 位置合并，完整前不能被选中转发。对比页独立读取／播放各自来源，不再以附近时间猜测另一来源的音频。

连续播放在当前页末续读；结束事件重复到达只推进一次，等待时暂停不重新起播。新录音媒体 HEAD 真实透传 HEAD，在收到头部后释放并发许可；GET 保持许可直至消费／取消，Range、类型、长度、账号与期限均校验。旧独立业务的签名 GET 路径保持原行为。

退休的插件本地转写 parser、按同名或重叠区间去重、旧说话人编号／人工身份推导和来源音频匹配代码已删除。相应机械 parser 测试删除，业务覆盖移至 semantic RecordingService／Audio：同名异人、self 显示名、未知身份限制、原始 ordinal、coverage、背景音规则与跨页完整性；重叠事实保留，生成终点取所有句子的最大结束时间。

## 实际验收与可复现入口

执行 `bash scripts/run-recording-pages-e2e.sh`，明确提供 `ARKME_DSH_CHECKOUT` 和正式 `.tgz` 安装后的全新、可丢弃 `ARKME_PACKED_PROFILE`；需要目标 DSH 的已安装依赖／构建、Chrome、ffmpeg、openssl。脚本为本次运行生成 TLS 身份并清理；使用官方公开 `healProfilesModuleFallback` 准备隔离 Profile，没有手写模块链接或修改 DSH。`scripts/verify-recording-sdk-consumer.mjs` 在安装 Profile 内创建带空格的独立消费者目录，只 import 公开 SDK，编译与运行后删除。

官方 DSH `d347e703908d0406b7a7ef80e3a0e594d86b2215`（0.1.3-alpha.1，tracked clean）与插件 dev 基线 `fe8f663a579a006f70906b38cfd84d6705ff358c` 的任务产物已通过一次真实 Chrome 场景：250 句首屏仅 100 条，搜索命中第 250 条、导出含首末、24 kbps Opus 解码播放、修订变更拒绝旧 cursor，且未调用 `one-day-trans`。安装包检查 1,262 条目，无本机路径、运行配置或临时文件。独立公开 SDK 消费者通过 Unicode 续片拼接、能力缺失与生命周期取消。

该浏览器场景使用隔离 Audio HTTPS 夹具，不代表真实 Mongo、模型音质、实际云请求或跨平台 native 播放验收。DSH 的模型读取仍走正式 OpenAPI/MCP，其真实会话调用与跨仓 Audio 等价性将进入跨仓门禁，当前尚未以此浏览器场景覆盖；不能记为 N/A 或复活退休 Tools 来绕过这一项。具体最终全仓测试与最终安装包哈希在交付证据中记录。

当前接入的最终全仓测试为 504 文件通过、7 文件保持原 skip；5,819 项通过、9 项保持原 skip（共 5,828 项）。相对旧 parser 测试集合的数量变化来自上述退休代码删除与语义测试迁移，不是把失败改为 skip。`typecheck`、`build` 与 `git diff --check` 通过。最终产物在导出取消修复之后重新构建／打包，通过相同官方 CLI 安装及仓外 SDK／真实 Chrome 场景；DSH tracked 状态仍为空。此记录仍不关闭上段明确保留的跨仓／平台门禁。


2026-09-12：同一读取 owner 新增设备采集汇总 `captureCoverage`（仅出现设备采集时返回），与 `processingCount` 独立；UI 的转写/设备接收状态接入现有总结/时间轴轮询入口，并显示未收齐提示。SDK 从既有公开类型接收安全汇总，未新增 Host 路由或复活 Tools。147 项相关测试与 typecheck 通过；本次之后的最终打包/安装仍待执行，不沿用前一次 tgz 作为新改动的验收证据。
