# 当前转写与历史读取（2026-11-19）

当前页、当前内容的总结和时间轴生成使用 `/api/v1/audio/transcripts/current/query`。Audio 从既有 session/child 提供正文和有效区间，不读取历史集合。只有带显式 `version_id` 的历史读取使用 `/api/v1/audio/transcript-versions/query`；版本列表使用 `/list`。

Host/SDK 的 `recordingTranscriptPage` 签名不变：没有 `versionRef` 是当前读，有合法的 `versionRef` 是历史读。服务端 snapshot_id 和分页游标继续由 Host 封装，不暴露数据库身份。当前翻页时来源变化返回409，不拼接不同视图；历史分页仍固定不可变版本。

删除源文件后旧正文保留，当前和历史都可读；没有原音时不允许播放。部分覆盖继续返回明确的 active_ranges，非连续/裁剪/区间不完整时不允许整句播放或编辑。活跃完整原句仍用原 owner 读取补充播放和私有编辑身份。

历史下拉框可以独立加载失败，但不阻塞当前正文和总结/时间轴输入。当前接口仅在服务端尚未部署（HTTP404/405）时兼容回退既有录音owner读取；网络、权限、格式和业务错误不降级成空正文，也不回退历史集合。

新集合已不作为正常业务当前正文来源。后端历史协调/冻结、旧数组留存、切换审计属于 Audio owner。手动修改录音日期后按各日期现存来源重算；删除源文件不改变转写来源位置。

验证：`tests/recording-transcript-versions.test.ts` 覆盖当前/历史路由隔离、历史故障下当前和两类生成输入可用、跨账号/日期分页绑定、历史只读、部分覆盖播放限制。
