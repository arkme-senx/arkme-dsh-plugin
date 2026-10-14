# 录音总结、时间轴生成失败排查交接

日期：2026-10-13；时区：Asia/Shanghai（UTC+8）。

## 结论与边界

真实账号 2026-10-13 的录音有转写数据，但总结和时间轴任务在模型调用阶段失败。生产接口已经返回 `status=3`、`generation_stage=2`、`llm_error=llm_request_failed`，并非前端自行把仍在生成的任务判成失败。

前端原来丢弃了 `llm_error`，且首次生成和失败重试直接使用当前模型，绕过了已有的模型选择弹窗。这次修复错误展示和选择模型的入口；**不代表生产模型请求失败已经解决**。

本次仅只读查询已有生产任务和配置，没有新建生成任务、修改个人模型配置或修改 Arkme 客户端。本交接未实施任何后端改动。

## 生产证据

读取接口：

- `POST /api/v1/summary/list-timeline-by-range`，传 `from_stamp`、`to_stamp`、`date_stamp` 和 `kind`；当天起点为 2026-10-13 00:00:00 +08:00，`kind=2` 为总结，`kind=1` 为时间轴。
- `POST /api/v1/audio-summary/model-config/list`，实际配置位于 `data.item`。

| 类型 | 任务 ID | 创建时间（UTC+8） | 创建到失败间隔 |
| --- | --- | --- | --- |
| 时间轴 | `6acdce5ad1b7e026eb4593d8` | 2026-10-13 14:23:22.116 | 345 ms |
| 总结 | `6acdce5dd1b7e026eb4593d9` | 2026-10-13 14:23:25.083 | 268 ms |
| 时间轴 | `6acdce69d1b7e026eb4593dc` | 2026-10-13 14:23:37.133 | 316 ms |
| 时间轴 | `6acdce8cd1b7e026eb4593dd` | 2026-10-13 14:24:12.853 | 245 ms |

四个任务共同信息：

- `status=3`，`generation_stage=2`，`llm_error=llm_request_failed`；没有生成内容。
- `model_display_name=DeepSeek V4 Flash`，`model_route_key=dashscope/deepseek-v4-flash`。
- 总结任务的 `llm_duration_ms=241`、`prompt_tokens=0`、`completion_tokens=0`。
- 查询时个人路由与生效路由均为 `dashscope/deepseek-v4-flash`；系统默认路由为 `dashscope/qwen3-max`。
- 可选模型列表包含该 DeepSeek 路由；出现在列表中只代表可选配置，不证明实际调用成功。

## 代码链路及尚未确定的信息

本地 `jotmo-audio` 参考版本为 `edd8699`；生产部署版本需后端核实，不能默认与本地一致。

1. `gin/api/summary.go` 的创建接口接收普通 JSON 或 zstd 数据，保存任务和模型快照。现有证据不支持“插件未压缩请求导致失败”。
2. `task/summary/summary.go` 的任务进入 `reqLLMToAudioSummaryV2`；失败时记录 `audio summary generation failed summary_id=...`，通过 `persistAudioSummaryGenerationFailure` 保存终态。
3. `callLLMOnce` 调用 DashScope 兼容接口 `/compatible-mode/v1/chat/completions`。非 200 时仅记录 `callLLMOnce provider status=...`，返回 HTTP 状态错误，未保留上游错误码、request ID 等定位信息。
4. `sanitizeAudioSummaryLLMError` 将多种未单独分类的错误归为 `llm_request_failed`；列表接口返回这个安全码。仅凭该码无法区分鉴权、模型可用性、请求参数、连接失败、响应解析或空输出等原因。

任务均在约 0.25–0.35 秒结束，更像模型调用被迅速拒绝或返回异常，**尚不能确认具体 HTTP 状态或归责于某个模型参数/密钥**。代码对 408、429 和 5xx 有重试；可优先核实非重试型拒绝，但这是排查线索，不是已确认根因。

## 后端需要完成

1. 用上述任务 ID 与创建时间关联任务日志、Sentry 和上游请求，核实实际部署版本及 provider HTTP 状态。
2. 检查该路由实际使用的模型名、账号权限/可用区域、服务端凭据有效性，以及 `enable_thinking`、`response_format`、`max_tokens` 等参数与模型的兼容性。
3. 在服务端保留脱敏后的上游错误码、request ID、HTTP 状态和路由，以任务 ID 关联；不要记录鉴权头、密钥或完整录音转写正文。
4. 对可识别失败提供稳定的安全错误码和可公开原因，前端再补充对应提示。不要把原始 provider 响应直接暴露给用户。
5. 修复后分别验证总结、时间轴：任务可进入成功态、内容可读；失败仍有终态且可重试；旧版本仍可查看。若更换默认路由，不应静默覆盖用户已有个人配置。

## 本次前端处理

- 日历选中日期复用日历板块的高对比配色；右侧顶部常驻选中日期、星期，简体中文下显示农历。空日期、加载中和多选时均保留日期。
- 将 `llm_error` 接入版本错误字段，兼容旧 `error` / `error_message`。
- 失败页和已有历史内容上方的失败提示显示可读原因及失败任务的模型名称；不把当前配置误当成历史失败模型。
- 首次生成、失败重试、已有版本重新生成统一进入已有模型弹窗。确认后才发起生成；取消不发起任务、不修改模型配置。选择不同模型时仍沿用既有的个人模型配置更新行为。
- 配置暂不可用或模型列表为空时允许重新加载；加载中避免重复点击；切换日期后不弹出旧日期发起的迟到弹窗。

## 联调验收

前端自动化使用模拟服务检查失败码映射、总结/时间轴选择模型并重试、取消不写入、独立生成、重复确认防重、配置恢复及切换日期后的异步回包。真实 Web 页面只查看已有失败与模型列表，不以创建生产任务作为 UI 验证。

生产生成成功的最终验收需后端修复后，用有转写的日期分别实际生成总结、时间轴，再检查成功内容及失败恢复。此次前端完成不替代该验收。
