# 搜索中的原生 DSH 任务

DSH 原生搜索结果并入“主题”，不再提供独立 Tab。单击查看摘要，双击或 Enter 打开原会话；原生结果直接使用官方搜索返回的 sessionId。同步快记仍使用现有 kind=3 的系统主题和普通 record/topic 数据结构。

## 会话与同步快记

同步接口不写 extra.dsh_origin，后端不存储、解析或返回该来源字段。插件也不消费旧服务可能返回的字段。DSH 同步仍使用既有确定性记录 UID，写入协议保持原样。

同步快记搜索由共享 SearchService 使用官方 sessionQuery.listSessions/filterEvents 读取本地 user/message 事件，用 session ID 与事件序号重算 record UID，精确匹配后仅在当前结果中附带 dshOrigin。不会按文本相似度猜测，不重写历史数据。本机能确认会话存在则打开原对话；无法关联或本机不存在时，使用记录原 topic 目标定位同步快记。

局部本地查询失败不阻断远端搜索；未完整核验标记 dshOriginUnverified，不冒充不存在。按时间倒序串行读取，5 秒期限后不再发起下一次扫描；官方单次 filterEvents 无中途取消能力。调用者取消继续向上传递。

## 普通主题链路

搜索来源通过共享 sourceItem 构造，携带与目录相同的 topicHierarchyKey。目录刷新复用来源投影更新，不清除待定位目标。普通主题与 DSH 主题共用记录读取与历史分页定位，最多 80 页。不使用 all:dsh-input，不修改个人首页读取规则。

后端本分支只修复主题搜索误用“普通用户主题专属校验”而排除 DSH 容器的问题；只允许本人、活跃、公开的 DSH 主题，不开放内部 AI 助手容器。没有新增来源字段、创建协议或首页开关。

## 展示与公开能力

防抖等待期即显示加载提示，提示覆盖在结果区域正中央，不占布局；保留已有结果。DSH badge 在标题后。已移除跳转说明 toast 与消息定位能力说明；实际失败仍显示错误。

官方 dsh-v0.1.5-rc.2 的 sessions.open 只能打开对话，未提供按消息序号加载、滚动、高亮的公开接口；本机只打开原对话，不访问私有组件或 DOM。

| 能力面 | 实现 |
| --- | --- |
| UI | 原生会话直接打开；同步记录本地精确关联或原 topic 兜底 |
| Tools | arkme_records_search 共用 SearchService；不新增写入能力 |
| SDK | searchRemote 和 remoteRecordSearch 能力位，共享同一结果语义 |
| Host | 既有搜索和普通主题读取 owner；没有新增业务接口 |
| Client | 未改 Electron、DSH 上游或 Release Set；插件版本保持不变 |

## 验证与边界

测试覆盖原生会话打开、本地事件 UID 精确匹配、同文不同记录、编辑后记录、第 21 个会话、查询失败与取消、普通/DSH 主题跨页定位。真实后端测试覆盖创建重试、默认首页隐藏、主题分页/around、跨账户拒绝、全局/主题搜索、编辑与删除重放。联合测试不传任何来源字段，验证 UI/SDK→Host→后端的本地命中及 topic 兜底。

搜索索引使用 fakesearch，不代表真实 OpenSearch 分词与性能验收。后端 around 能力已有，但插件仍沿用既有主题分页定位；本轮不新增插件 around 接口。本任务未执行生产部署。
