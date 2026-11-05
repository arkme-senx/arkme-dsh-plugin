# 桌面世界内容举报：华焱后端补充交接

桌面已按用户确认补齐世界卡片与详情的「更多 → 举报」、移动端六类原因、必填说明（最多500个字符）、重复点击保护、错误保留与未知结果提示。仅前端插件／本地 Runtime 改动，本次不修改或发布云端业务代码。

## 当前可用与缺口

生产 Record #227 / 27042ac7 的 POST `/api/v1/reports/create` 已有个人公开稿举报合同，接受 owner_id、obj_type=1、obj_id=0、obj_uid、rm_subject_id=0、report_type、reason。桌面只从新读取的 World 公开投影获取个人 owner，不接受页面直接传 owner ID，不读取作者私有原件。

团队公开稿在 World 以 UserId=0、TeamID>0 表示，公开投影 principal.kind=team。现有 Record Submit 要求 OwnerID>0，且 World 举报证据 BuildReportPublication 返回 p.UserId，因此不能把 team_id 冒充 owner_id。后端需补统一的公开稿举报归属接口。

## 桌面已接的统一合同（由华焱落地）

POST `/api/v1/world/reports/create`，使用当前正式账号鉴权。请求：

```json
{
  "record_uid": "公开稿UID",
  "content_revision": "最新公开读取返回的版本；旧稿未提供时省略",
  "report_type": 1,
  "reason": "必填，最多500个Unicode字符",
  "request_uid": "稳定UUID"
}
```

report_type 与移动端一致：1网络暴力、2违法信息、3人身攻击、4违规营销、5骚扰我、6诈骗信息。

成功须明确返回 World envelope `{code:200,data:{submitted:true}}`。仅实际持久受理后返回 submitted；提交后进入既有统一举报流程，不直接将内容视为已封禁。

- Reporter 来自鉴权，target principal、公开状态、来源归属和当前内容版本来自 World owner。提交时冻结举报版本和必要公开证据；携带 content_revision 时精确匹配，变更／撤回／不可见稿明确拒绝。不给前端或普通用户管理／试听私密原件的权限。
- 后端按账号＋request_uid 持久幂等，同参数重试返回原回执，不同参数拒绝；响应丢失可安全重试。团队与个人命名空间独立，不依赖 TeamID 和 UserID 数值碰巧相等。
- 与现有总后台举报队列和权限集成，团队归属清楚显示；声音公开稿的证据应能查阅所选转写并试听公开片段，不能仅按空 voices 字段丢失音频或暴露原通话／录音。
- 桌面优先调用该统一接口。仅明确 HTTP 404/501 才对个人稿兼容现有 Record `/reports/create`。团队明确显示接口未接通并保留输入；403/超时/5xx 不作兼容降级或显示成功。
- 当前个人旧接口没有 request_uid 持久幂等与明确回执。桌面防止重复点击；写入超时、连接失败或无效回执显示「结果尚未确认，请勿重复提交」，本次打开的弹窗禁止再提交，不把未知结果当失败自动重发。统一后端落地后解决跨设备／重开窗口的幂等边界。

## 华焱验收

个人／团队／声音稿 → 当前真实公开版本 → 选择6类原因及500字符边界 → 未登录、跨账号、自己内容、撤回／换版本拒绝 → 并发同request_uid、丢响应重试、不同载荷冲突 → 统一后台出现正确归属及公开证据 → 员工权限、声音试听、处理时版本CAS → 处理回执与通知。隔离测试内容验收，不用真实用户内容制造生产举报。

总交接：[World #52](https://codeup.aliyun.com/senguo/jotmo/jotmo-world/change/52)。已有的订阅／声音／分享建议任务仍按该交接接续。
