# 手动导入录音：批次通知与自动日总结、时间轴

日期：2026-10-13。本次已在任务开发分支实现并提交 Audio 后端与插件配套，尚未部署。验收证据见 [实现矩阵](recording-import-workflow-implementation-matrix.md)。截图中的原交接草案由本合同替代；不代表现网已具备能力。

## 产品结果与职责

一次手动导入点击形成固定批次。所有文件的主处理链成功且转写可读后，服务端持久化 processing 通知；随后自动更新实际录音日期的日总结和时间轴；两种结果逐一验证可读后持久化 analysis 通知。客户端关闭、推送送达和已读都不是调度条件。

Audio 独占处理事实、版本与协调。插件负责上传身份、通知读取和结果导航。总结使用 kind=2，时间轴 kind=1；不替换为相关联系人记忆或日语义事件，也不随自动总结触发安排提取。日输入覆盖账号当日全部已可用的 system 原文，保留说话人身份及历史版本。

无声文件不会伪造转写；全静音批次不调用模型。失败/暂停/缺失成员先显示未全部完成，续传恢复后更新同一阶段通知。两个生成结果独立显示，失败不能拿旧成功版本替代。多日期中有日期无可整理内容、其余成功时为 partial，不伪报全部完成。

## 创建与固定身份

`POST /api/v1/audio/new-session` 保持旧字段和响应，手动批次新增：

```json
{
  "create_request_uid": "019a0000-0000-7000-8000-000000000001",
  "import_batch": {
    "batch_id": "batch-example-001",
    "item_index": 0,
    "item_count": 12,
    "time_zone": "Asia/Shanghai",
    "file_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "file_size": 12345,
    "ownership": "self"
  }
}
```

- 每个新任务持久化一个 UUIDv7，丢失响应/重启后重放同一身份；不靠文件名扫描恢复新批次。
- 成员最多 10000，index 从 0 起。固定数量、时区、文件身份、归属及创建信息冲突明确拒绝；同请求返回原 Session。
- Session 创建与批次成员绑定同一个 Mongo 事务。不增加独立成员集合，不复制 Child 状态。
- 本地任务只在 batch/index/count/timezone 和录音分类相符时复用；新批次不会偷用旧批次身份。
- 无 batch 的旧端、实时/设备录音保留原路径。尚未上传字节不可能在关机后继续上传。
- 最后一个新成员接纳后 24 小时仍未完整结束，给出软提醒并降低检查频率；不自动取消，后续恢复继续推进。明确失败可以更早提醒。

## 通知 HTTP 合同

全部使用现有鉴权与 POST JSON envelope，账号来自鉴权。业务码按现有 Audio 约定检查，HTTP 200 不等于业务成功。前缀 `/api/v1/audio/import-batches/`：

| 后缀 | 请求 | 用途 |
| --- | --- | --- |
| capabilities | `{}` | 返回 `supported:true`；启动已验证事务与必要索引，部署时须完整提供 API/cron/worker |
| notifications/query | `{"cursor":"","limit":50}` | 账号级通知页和统计 |
| notifications/read | `{"items":[{"id":"ObjectID","sequence":"60"}]}` | 只标记观察到的通知版本，最多 50 个 |
| notifications/read | `{"through_sequence":"60"}` | 只标记已观察序号及之前的通知 |

query data 包含 `supported,items,total,unread_count,latest,through_sequence,next_cursor`。序号是服务端十进制整数字符串，分页 cursor 为不透明编码。按 sequence 倒序；恢复产生新结果时更新原 ID、分配新序号并重新未读；单纯已读不改变排序。选中项按 id + sequence 精确匹配，旧页面点击不得吞掉同一通知更新后的未读状态；items 与 through_sequence 互斥。列表/统计/水位在一致快照中读取。

notice 字段：`id,sequence,batch_id,stage,state,time_zone,file_count,completed_count,failed_count,created_at,updated_at,read_at,message,days`。stage 为 processing/analysis；state 为 completed/partial/failed/skipped。时间戳均毫秒，未读 read_at=0。

days 的每项包含 `date,date_stamp,end_stamp,summary,timeline`。日期为固定 IANA 时区的自然日 `[date_stamp,end_stamp)`，DST 可为 23/25 小时；最多 366 天。summary/timeline 各含 `state` 与可选 `version_id`，completed 必须有可读的精确 ID。处理通知允许 pending；生成通知仅含终态。

文件数量始终表示文件处理数量，不能拿生成版本数冒充。普通说明不包含密钥或录音全文。权限校验覆盖列表、已读及版本读取。

## 自动执行与恢复

持久批次是恢复锚点，不额外引入 outbox/任务引擎。处理通知与阶段推进事务提交；同一天两种版本与批次引用也事务提交。cron 按索引有界扫描，每次只准备一天，MQ 丢失可以补投。

自动任务使用独立 `jm.audioSummary.recordingImport` 队列和单消费者，复用 summary worker、用户模型快照和既有限流。消费者用数据库 CAS 独占认领；重复投递不会重复请求模型，迟到结果不能改写已失败版本。执行结果未知超过五分钟标为失败，不盲目重调供应商；用户手动重试产生新版本。当前不新增用户收费政策，不虚构外部供应商 exactly-once 能力。

同日手动/自动提交共用日锁，自动 identity 包含账号、输入、区间、类型、模型、提示词。全日正文与说话人从同一 Mongo snapshot 构建。它不是插件 UI 的会话重叠展示剪枝，人工原入口正文合同保持原样。

## 插件接入

Host `RecordingWorkflowService` 是 UI、SDK 与 Tools 的统一 owner。SDK 提供能力查询、通知页、已读和精确版本读取；Tools 正式注册查询/已读，写操作要求明确用户授权。访问令牌不进入浏览器或模型。

通知携带原时区/日界。详情按既有 `/api/v1/summary/get-by-ids` 的 `ids` 数组查询精确版本，不依赖浏览器本地日期列表；版本缺失明确显示不可用。日查询、轮询及手动再生成保持通知原日界。手动 `/api/v1/summary/create` 随通知传 `time_zone` 与 `day_end_stamp`，Audio 校验完整自然日、由该时区推导 offset，并为时间轴冻结同一窗口的 system 证据；未携带这两个字段的原手动入口保持已有合同。零时间戳附近的日界允许因时区为负数，不改变历史录音起点下限。原通知存储的账号切换保护、分页和轮询继续使用。

旧服务明确不支持时仍可普通上传；不存在本地伪造的完成通知，也没有新增灰度配置。通知轮询不是秒级推送。

## 存储与发布

仅新增 `recording_import_batch` 和 `recording_notification` 两个集合，分别承载固定成员/恢复锚点与独立的收件箱结果。五个显式索引覆盖批次唯一性/到期扫描、阶段唯一性/序号唯一性/未读扫描；audio_summary 增加自动 identity 的 partial unique 索引。没有历史回填，没有 Session 新索引，没有独立结果表或 counter 集合。

发布前核对目标 Mongo 副本集事务、预建索引成本和共享资源容量，再完整部署 API、cron、summary worker 和匹配插件。回滚保留新增数据与历史版本；旧服务不会继续推进新批次。生产发布与真实付费模型验收尚未执行。
