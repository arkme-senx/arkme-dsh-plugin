# 编辑历史跨仓验收

`tests/e2e/record-edit-history-live.test.tsx` 由 jotmo-chat 的 `TestRecordEditHistoryEndToEnd` 启动。后者创建独占的 Chat 会话和 Record，通过公开接口生成超过50个修订，并以0600临时文件提供隔离账号的测试JWT。测试结束删除该文件。

验收使用原 ArkmeSurface 的消息菜单、重新编辑输入框和保存按钮，经过公开 SDK、同源 Host HTTP、RecordService 持久提交队列和真实 Record owner/Mongo，再经真实 Chat 成员/关系授权读取历史。随后操作原历史卡片的加载更多和右键记忆快照，同时检查公开SDK和只读Tool的单次耗时、实测0及脱敏输出。UI目录和初始时间线、账号资料为合成shell；编辑、草稿、回执、历史、快照与服务权限不替换业务owner。

准备 Node24 和插件依赖，启动独占的 Chat/Record/Mongo E2E环境，按照 Chat `test/e2e/README.md` 设置 `JOTMO_RECORD_HISTORY_FRONTEND_FIXTURE`、`JOTMO_RECORD_HISTORY_WORKSPACE` 与该环境端口，再执行上述 Go 用例。测试会重置其测试数据库，禁止复用生产配置或与其他测试共享实例并发执行。未配置fixture时，插件整包单测跳过该跨仓场景，由Go联合验收显式执行。

作者可完整读取自己的已保存修订与采集快照；可读聊天关系的另一成员保留整条快记历史正文入口，设备、自动地点、背景音及人工耗时不会随正文公开。群聊没有逐版证明的旧正文经现有审核能力独立补审，失败可重试，不能从当前版本通过推导所有旧版通过。原普通时间线和当前消息审核行为不变。

`tests/e2e/record-history-peer-live.test.tsx` 由 Chat 的 `test/e2e/run_record_history_http.py` 编排隔离运行。传入 workspace、独占的回环 Mongo 副本集 URI、artifact 目录和 Node24。编排器分别启动两个仓的 opt-in HTTP fixture，正常结束时通知退出并清理其独占数据库；不需要 Docker 全服务。Record 通过真实 mutation 创建55版历史；插件原历史组件经公开 SDK/Host、真实 Chat/Record HTTP、独立任务及 Mongo，验证待审提示与重试、两页保留54个允许版本、拒绝版不展示、本人精确私有快照及实测0、关系不重发，以及移出群后拒绝访问。仅身份和外部L1/L2审核provider使用测试替身，不宣称真实审核供应商验收。

真实 Mongo 专项另外覆盖并发重放不重置结论/租约、执行键不被调用方关系UID预占、服务故障后的同身份恢复和当前任务与历史任务隔离。1000条历史任务积压下，普通领取复用既有阶段索引只扫描1条文档；历史使用4/5阶段，普通1/2的索引范围不含历史任务；样例历史任务BSON为386字节。不新增索引，没有历史全库回填，按用户实际读取的有界页补审；真实上线会产生审核调用和按需任务存储成本。
