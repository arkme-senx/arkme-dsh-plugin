# 编辑历史跨仓验收

`tests/e2e/record-edit-history-live.test.tsx` 由 jotmo-chat 的 `TestRecordEditHistoryEndToEnd` 启动。后者创建独占的 Chat 会话和 Record，通过公开接口生成超过50个修订，并以0600临时文件提供隔离账号的测试JWT。测试结束删除该文件。

验收使用原 ArkmeSurface 的消息菜单、重新编辑输入框和保存按钮，经过公开 SDK、同源 Host HTTP、RecordService 持久提交队列和真实 Record owner/Mongo，再经真实 Chat 成员/关系授权读取历史。随后操作原历史卡片的加载更多和右键记忆快照，同时检查公开SDK和只读Tool的单次耗时、实测0及脱敏输出。UI目录和初始时间线、账号资料为合成shell；编辑、草稿、回执、历史、快照与服务权限不替换业务owner。

准备 Node24 和插件依赖，启动独占的 Chat/Record/Mongo E2E环境，按照 Chat `test/e2e/README.md` 设置 `JOTMO_RECORD_HISTORY_FRONTEND_FIXTURE`、`JOTMO_RECORD_HISTORY_WORKSPACE` 与该环境端口，再执行上述 Go 用例。测试会重置其测试数据库，禁止复用生产配置或与其他测试共享实例并发执行。未配置fixture时，插件整包单测跳过该跨仓场景，由Go联合验收显式执行。

作者可完整读取已保存修订；另一成员在私聊/群聊均不能调用历史分页或精确历史。原普通时间线在新正文尚未放行时不返回该消息，批准当前版本后恢复；该既有行为由联合用例实测，不能承诺总显示旧批准正文。历史无逐版本公开证据时，不补造证明，也不新增数据结构。
