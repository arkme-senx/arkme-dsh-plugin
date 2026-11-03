# 桌面日期与增量导出：前后端接入说明

更新：2026-11-04。用户已授权同时实施 Record 后端。当前为开发分支完成并联调，尚未部署生产；不是仅前端占位。

## 行为

数据管理 → 导出，保留全部、按日期、增量三种范围。日期使用记录显示时间 send_at，包含结束日期全天，明确绑定 IANA 时区，夏令时按日历日计算。日期导出不改变全局增量基线。

首次保存完整备份后默认增量；增量包含新增、修改、补录旧日期和移除清单，并处理独立于内容事件的隐私锁定与解锁。每个包包含 Markdown、所选附件和 manifest.json；增量包需与此前备份一起保留。不同账号、环境、设备和附件策略使用独立备份链。

ZIP生成与保存分开。当前插件未取得安装客户端的原生完成回执，使用清晰的“我已保存”及二次确认；只有用户确认完整保存后才推进基线，点击下载、生成成功、取消和失败均不推进。Host再次检查准确制品的SHA256和size；确认引用加密并绑定账号、本地文件和一小时有效期。未来原生可信回执可复用相同saved接口，不能用下载开始替代完成。

## 已实现合同

Record新接口均为已鉴权 POST JSON，前缀 `/api/v1/records/export/range`：

| 路由 | 请求核心 | 结果 |
| --- | --- | --- |
| capabilities | {} | protocol_version=2，date_range/incremental/explicit_saved_confirmation |
| state | device_id, include_attachments | version, saved_at |
| prepare | device_id, selection | can_export, baseline_required, plan, chain |
| start | preview_uid | 冻结计划与计数；重复不重复预占 |
| page | preview_uid, after_index, limit≤100 | items, removed_uids, next_index, has_more |
| files/batch-sign | preview_uid, record_uids, file_asset_uids | 只对快照范围内且当前可访问的文件签名 |
| finish | preview_uid, success, artifact_sha256, artifact_size | quota_finalized；仅记录生成事实 |
| saved | preview_uid, artifact_sha256, artifact_size, user_confirmed_saved=true | 原子推进后的version/saved_at |
| status | preview_uid | 当前账号的准确任务状态 |

selection字段：mode=all/dates/incremental、start_date/end_date（仅dates）、time_zone、include_attachments、order_kind=1/2。plan返回preview_uid、chain_uid、selection_fingerprint、base_version、record_count、new_count、updated_count、removed_count、total_image_count、total_voice_count、expires_at。正文DTO为record_uid/send_at/version/title/text/file_refs。

manifest schema_version=2，包含preview_uid、chain_uid、base_version、selection_fingerprint、selection、完整记录与附件相对路径、removed_uids。稳定UID/版本用于离线合并，移除清单不会远程擦除以前保存的包。

插件内部新增 `data.export.range.preview`、`data.export.saved`，复用现有导出Host、SDK、取消、流式ZIP和下载入口。旧后端不支持新能力时保留原完整导出；范围请求绝不降级成全量。

## 数据、并发与恢复

Record使用只读Mongo snapshot冻结内容、变更序列及隐私事实，分批写入临时快照；同账号准备租约2分钟、读取超时90秒。最多6份有效驻留快照，单份10万候选、64MiB正文、1GiB附件；临时正文1小时TTL，确认保存后同事务清理该快照正文。准备中断留下的孤立条目由TTL清理。

saved事务原子提交摘要账本、设备链与回执；重复确认幂等，旧基线与竞争确认拒绝并回滚。正文分页和附件签名复核当前权限。取消不推进基线。

Premium仍沿用旧接口，尚不提供幂等操作身份。start/finish通过状态CAS抑制重复调用；若进程恰在外部调用边界中断，starting/finishing保留不确定事实，不自动重放。需据原会话和Premium事实核验，不能声称自动退回额度。后续Premium幂等回执属于独立改进。

## 验证与上线边界

- MongoDB 7.0.15独立副本集，127.0.0.1:60478，测试独立数据库、自动清理；未改用户生产数据。
- 真实数据库覆盖冻结分页、同时间戳、并发变化、压缩日志、日期/DST、补录、删除、隐私锁定/解锁、跨账号/设备、重复制品确认与竞争回滚；相关race和根架构检查通过。
- Go真实HTTP路由 → 插件真实owner → ZIP → saved → 下一次空增量已联通；日期保存不推进基线。
- 查询explain：1000条夹具全量扫描1000条，选取10条日期窗口扫描10条，复用现有索引。
- 插件完成范围/旧版回归、Host/SDK、取消、损坏制品、仅移除包、过期/账号保护、UI防过时响应、确认保存流程；类型检查和构建通过。
- 3104真实账号仅做读数据和点击，确认新版前端对旧Host/生产后端保持兼容；没有发起真实扣额度导出。真实生产V2、安装客户端自动落盘回执和Windows/Linux仍未验收。

先部署后端，再更新插件。新增集合与索引由领域初始化幂等创建，旧合同不变；回滚任一端恢复旧全量路径，保留已有设备链。只合开发分支，不由本次任务发布master或生产。
