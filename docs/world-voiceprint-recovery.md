# 世界声音恢复

世界播放仍使用已有 WorldService、world.voiceprint.playback.generate Host 操作和 SDK generateWorldVoiceprintPlayback 方法。只对音频 owner 明确返回的业务码 1106 续查，间隔 3 秒、在一分钟窗口内发起续查（单次在途请求仍使用既有传输超时）；普通服务失败、鉴权失败与超时不重放。等待复用原有 loading，用户取消、页面释放或账号变化后不再续查或交付迟到媒体。

## 能力面

| 消费面 | 本次范围与证据 |
| --- | --- |
| Host owner | WorldService 统一管理恢复等待、身份重新校验与不透明媒体引用；未新增 Host 操作或持久化 |
| UI | 既有世界喇叭与 loading；等待、取消、超时均由共享服务处理，已有播放队列和 Host 测试覆盖 |
| SDK | 既有 generateWorldVoiceprintPlayback 签名及媒体引用不变，继承同一等待行为；world-sdk 合同测试覆盖 |
| Tools | 未新增模型可发现或调用的业务操作，现有世界工具不变；本修复不增加独立声音恢复 Tool |

后端需要先支持候选持久化、续查及 1106，随后再更新插件。未执行生产部署、真实账号页面替换或多平台 GUI 验收；供应商链路使用独立诊断音色验证并回收，未修改业务用户绑定。

## 管理恢复

`voiceprint.restore`、现有恢复 Tool 和 SDK 通用 Host 调用共用 VoiceprintService。只发送一次 restore-playback；明确 1106 后，每 3 秒通过 my 续查同一持久候选，最长一分钟续查窗口。复用播放等待核；清理 status 缓存，换号、Host dispose 或 AbortSignal 取消后停止交付和续查。普通写错误不自动重放恢复写。
