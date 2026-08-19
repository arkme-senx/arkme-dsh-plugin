# Arkme Arko 入口实现说明

## OpenSpec 一致性判断

- 本次改变 Arkme DSH 插件内的前端入口和交互支线：左侧会话列表新增 Arko 固定入口，主面板新增 Arko 对话模式。
- 不改变服务端接口契约，不新增跨仓字段语义；Arko 调用仍复用插件已有 AgentDirect 能力。
- 本次修复改变任务失败恢复、待确认发送和 Tool 结果回收分支，已在根仓新增 `c20260819-dsh-arko-run-recovery` OpenSpec change；本文件保留插件实现级图示。

## UI 图

```mermaid
flowchart LR
  Sidebar[Arkme 左侧列表] --> Community[即我社区入口]
  Sidebar --> Arko[Arko 入口：客户端同源头像 + AI 标识]
  Sidebar --> Self[发给自己]
  Sidebar --> Recording[全天候录音]
  Arko --> Surface[Arko 主面板：展示云端当前名称]
  Surface --> Actions[当前名称右侧：模型选择 / 清除上下文]
  Actions --> Models[服务端模型目录与当前选择]
  Surface --> Messages[AgentDirect 历史与本地消息流]
  Messages --> UserAvatar[用户消息：当前账号头像]
  Messages --> ArkoIdentity[AI 消息：客户端同源头像 + 云端当前名称]
  Messages --> Thinking[思考过程：展开 / 收起 / 计时]
  Messages --> Running[运行状态：思考 / 处理 / 等待操作 / 等待补充]
  Messages --> Earlier[加载更早消息]
  Surface --> Composer[输入框与发送按钮]
  Composer --> Stop[运行中：停止当前任务]
  Profile[Arko Profile Store] --> Arko
  Profile --> Surface
  CloudDefault[云端 Agent / version 0] -->|仅展示映射| Profile
  Profile -->|Arko| Arko
```

## 交互图

```mermaid
sequenceDiagram
  participant U as 用户
  participant Nav as ArkmeNavigation
  participant UI as ArkmeUiController
  participant Panel as ArkmeArkoSurface
  participant Profile as Arko Profile Store
  participant Host as Arkme Host API
  participant Cloud as AgentDirect

  U->>Nav: 点击 Arko
  Nav->>UI: showArko()
  UI->>Panel: mode=arko
  par 独立恢复
    Panel->>Host: arko.session
    Panel->>Host: arko.profile
    Panel->>Host: arko.models
    Panel->>Host: arko.history(session_type=2)
    Panel->>Host: user.profile
  end
  Host-->>Panel: 会话 / 名称 / 用户头像 / 模型 / 历史
  alt 新任务
    U->>Panel: 输入并发送
    Panel->>Host: arko.ask(model_route_key, wait=1s)
  else waiting_user 续接
    U->>Panel: 补充或确认
    Panel->>Host: arko.ask(reply_to_run_uid, reply_to_assistant_msg_id)
  end
  Host->>Cloud: new-msg-v2 + stream-v2
  Cloud-->>Host: answer / run projection
  alt SSE 正常但首秒未结束
    Host-->>Panel: run_uid + queued/running
    loop 直到终态
      Panel->>Host: arko.run.status
      Host-->>Panel: queued/running/waiting_tool/terminal
    end
    Panel->>Host: arko.history
  else new-msg-v2 已受理但 SSE 断线
    Host-->>Panel: 保留 run_uid + stream_timeout
    Panel->>Host: arko.run.status
  else new-msg-v2 响应不确定
    Panel->>Panel: 保存原 client_turn_uid 并锁定新发送
    U->>Panel: 重试确认
    Panel->>Host: arko.ask(复用原 client_turn_uid)
  else 首秒完成
    Host-->>Panel: 正文 / 思考过程 / 终态
  end
  alt 状态为 waiting_tool
    Panel-->>U: 提示当前 DSH 不支持该客户端操作
    U->>Panel: 停止当前任务
    Panel->>Host: arko.cancel(session_id, assistant_msg_id, run_uid)
    Host-->>Panel: cancel_requested，继续轮询到终态
  end
  Panel->>Panel: 更新回复、等待补充、处理中或失败
  alt 回复携带改名后的 agent_profile
    Panel->>Profile: 发布最新名称与版本
    Profile->>Profile: 仅接受高于当前 version 的同账号数据
    Profile-->>Panel: 刷新顶部标题和消息发送者名称
    Profile-->>Nav: 同步刷新左侧 Arko 入口名称
  else 云端默认名为 Agent 且 version=0
    Profile-->>Panel: 仅展示为 Arko
    Profile-->>Nav: 仅展示为 Arko
  end
```

## 模型选择交互图

```mermaid
stateDiagram-v2
  [*] --> LoadingCatalog
  LoadingCatalog --> Hidden: 目录失败或少于两个模型
  LoadingCatalog --> Ready: 有效目录
  Ready --> Selecting: 选择新模型
  Selecting --> Ready: activate 成功并采用服务端回显
  Selecting --> SelectionError: activate 失败
  SelectionError --> Ready: 重试或关闭
  Ready --> SendingNewTurn: 新任务冻结 effective_route_key
  Ready --> ContinuingRun: waiting_user 续接
  ContinuingRun --> Ready: 继承原 Run 模型，不发送新 route
```

## 状态与失败恢复

- 会话是唯一阻断项：`arko.session` 失败时禁用输入并展示错误。
- Profile 和模型目录是独立增强项：读取失败时名称回退为 `Arko`、模型回退服务端默认。历史失败必须显示独立错误与重载入口，不能显示为“暂无对话记录”。
- 新任务携带模型目录的 `effective_route_key`；目录无效时省略字段，由服务端回退默认模型。
- `waiting_user` 后的下一条输入必须携带原 `run_uid + assistant_msg_id`，且不得发送新模型路由。
- 清除上下文通过新建 `type=2` 会话实现，保留历史消息并切断旧 Run 的续接关系。
- 模型选择、发送、清除上下文和历史翻页分别防重入，并为失败保留可重试入口。
- Arko 主面板不重复展示 Agent 资料头；模型选择和清除上下文位于当前 Arko 名称右侧。
- 用户消息头像读取当前账号的安全头像引用；AI 消息头像复用客户端 AgentDirect 头像，发送者名称只展示云端当前名称，不追加 `AI` 文案。
- Arko profile 是侧边栏入口与主面板共享的前端状态；改名回执会同时刷新两处。仅云端 `Agent/version=0` 默认投影映射为 `Arko`，用户主动保存的 `Agent/version>0` 保持原样。
- 新发送和重进页面发现的 active Run 都由同一轮询链恢复；只恢复当前会话最新 Run。首次查询前保留 1.2 秒状态投影窗口，前两次失败保持“正在处理”，连续三次失败后才展示同步异常，并以最高 10 秒退避继续重连。
- `new-msg-v2` 成功后即视为任务已受理；后续 SSE 断线不得回报“发送失败”，必须保留 Run 身份并转状态轮询，避免用户重试造成重复业务操作。
- `new-msg-v2` 响应不确定时在当前标签页保存 pending turn；重试确认必须复用原 `client_turn_uid`，未完成对账前禁止新发送和清除上下文。
- Tool 状态查询进入终态后使用 `surface_assistant_msg_id` 从现有历史分页回收最终正文，不修改系统提示词或服务端契约。
- `waiting_tool` 保持运行锁，但必须展示“不支持的客户端操作”说明和停止按钮；停止请求继续轮询到权威终态。
- Profile Store 以账号和云端 `version` 为一致性边界：跨账号快照不展示，同账号低版本或同版本迟到响应不覆盖当前名称。

## 登录态初始化图

```mermaid
sequenceDiagram
  participant UI as Arkme Surface
  participant Host as Arkme Host API
  participant Store as 本地凭据/资料缓存
  participant Auth as Arkme 用户接口

  UI->>Host: auth.status
  Host->>Store: 读取 active / pending session
  Store-->>Host: 已登录 / 待绑定 / 未登录
  Host-->>UI: 立即返回本地三态
  alt active session 且页面首次挂载
    UI->>Host: user.profile.refresh
    Host->>Auth: 校验凭据并读取手机号
    Auth-->>UI: 已绑定手机号
    UI->>UI: 保持当前 Arko / 录音 / 会话模式
  else 凭据过期
    Auth-->>UI: login-expired
    UI->>UI: 回到登录页并允许重新登录
  else 用户资料查询临时失败
    Auth-->>UI: 网络错误 / 服务繁忙
    UI-->>UI: 保持 checking 并显示重新检查按钮
    UI->>Host: 用户点击后重新执行 user.profile.refresh
  end
```

- `auth.status` 不在每次组件挂载时重复访问远端；active session 有资料缓存时直接返回，旧凭据首次无缓存时仍执行一次迁移校验。
- 手机号远端校验只更新绑定门禁，不再触发全局登录事件或把当前 Arko 页面重置成登录模式。
