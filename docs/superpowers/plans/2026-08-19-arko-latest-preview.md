# Arko 会话列表最新消息预览

## OpenSpec 一致性判断

- 本次只把已有 `arko.history` 与当前 Arko 消息流投影到左侧固定入口，不改变业务主线、失败恢复、接口字段语义或仓库范围。
- 不新增服务端请求契约；无历史时保留原产品描述。因此本次无需更新 OpenSpec 文档。

## UI 图

```mermaid
flowchart LR
  Row[Arko 会话入口] --> Name[动态名称 + Agent 标签]
  Row --> Preview{存在可见消息?}
  Preview -->|是| Latest[最新一条消息，单行省略]
  Preview -->|否| Fallback[对话并处理 Arkme 业务]
```

## 交互图

```mermaid
sequenceDiagram
  participant U as 用户
  participant Nav as ArkmeNavigation
  participant Host as Arkme Host
  participant Store as Arko Preview Store
  participant Surface as Arko Surface

  U->>Nav: 登录后打开 Arkme 列表
  Nav->>Store: 创建带 surface revision 的请求代次
  Nav->>Host: arko.history(limit=10, offset=0)
  Host-->>Nav: 最近历史
  Nav->>Store: 仅在请求仍是最新且 Surface 未变化时发布
  Store-->>Nav: 刷新列表预览
  U->>Surface: 发送消息或收到 Arko 回复
  Surface->>Store: 发布消息流最新可见消息
  Store-->>Nav: 即时刷新列表预览
  alt 账号切换
    Nav->>Store: activateUser(newUserId)
    Store-->>Nav: 清空旧账号预览并重新加载
  end
```

## 状态与边界

- 历史读取失败不阻断列表，继续显示原产品描述或当前会话已发布的预览。
- 空白中的 assistant 处理占位不覆盖上一条可见用户消息。
- 多行消息折叠为空格，列表继续使用既有单行省略样式。
- 同秒历史使用数字 `messageId` 决定先后，不使用字符串排序。
- Surface 以页面实际展示顺序发布，避免本地毫秒时间与服务端秒级时间互相比较。
- 每次重新打开 Arkme 列表都会刷新历史；迟到请求和 Surface 发消息后的旧响应都不能覆盖新预览。
- Store 以 `userId` 隔离，账号切换立即清空旧预览。
