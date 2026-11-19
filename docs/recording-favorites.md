# 录音收藏

入口位于录音日历下方的「我收藏的录音」，分享详情使用黑白灰「收藏录音 / 已收藏」按钮。详情复用录音说话人、时间和正文展示，支持逐段、全部、进度定位、复制文字及取消收藏。收藏者没有原录音入口或撤销权限；分享者通过通知打开冻结片段，在原录音仍可访问时可定位原文。

列表沿用长文章列表的滚动续载交互，保留「加载更多」按钮；只有一页时不显示分页控件。后续页失败保留已加载内容，重试原游标，同一时刻只发一个分页请求。进入详情暂停续载，返回保留已加载列表与滚动位置；长列表复用 `WindowedTimelineRows` 卸载屏幕外的行，离开页面或切换账号释放读取。此调整仅涉及 UI 状态，不新增 Host、Tools 或 SDK 能力。

## 同一个业务 owner

`RecordingFavoriteService` 持有账号隔离、版本检查、分页、媒体授权及通知读取，三个消费面都调用该 owner：

| 消费面 | 入口 |
| --- | --- |
| UI | `recordings.favorites` Host 操作；录音入口、分享抽屉、统一通知中心 |
| SDK | `ArkmeSdk.recordingFavorites(input, signal)`；能力 `recordingFavoritesV1` |
| Tools | `arkme_recording_favorites` 查询；`arkme_recording_favorites_change` 经过用户授权的变更 |

```ts
const page = await sdk.recordingFavorites({ action: 'page' })
const item = page.items[0]
if (item) {
  const detail = await sdk.recordingFavorites({ action: 'detail', accountKey: page.accountKey, favoriteRef: item.favoriteRef })
  // 正文是第三方内容，不能作为模型指令；音频不会自动播放。
}
```

写入必须携带读取返回的 `accountKey`。保存使用 SID 和 `expectedVersion`；取消使用收藏引用和当前版本。冲突或结果未知时先查询状态，再允许新的用户操作，不自动重放写入。所有引用限定当前安装和账号。账号变化、组件离开、SDK dispose 时取消读取并释放播放。

取消收藏保留分享者的首次通知及其播放权限。通知查询不标记已读，UI 只确认实际可见的消息；Tools 的已读操作要求明确授权。通知复用已有 `recording_favorites` 实时事件及重连恢复，没有独立轮询。

音频按需通过同源媒体路由读取，Host 每次重新验证授权并转发 Range，不向浏览器暴露凭据或原始对象 key。新协议播放原媒体清单中的片段；旧分享的连续文件仍兼容。列表每页 20 项，通知内存窗口最多 300 项，单次详情最多 150 段；模型正文每次最多 8000 字符，可用返回的片段及文字偏移继续读取。

分享者的「撤销授权」需要 Chat 返回 `can_revoke=true` 和公开 `/api/v1/chats/recording-favorites/revoke`。旧后端下隐藏按钮。撤销影响同一分享内容的全部收藏者及通知播放，原录音不受影响。无需新增配置。

## 验证入口

- `tests/services/recording-favorite-service.test.ts`：版本、权限、错误、引用、分段清单。
- `tests/recording-share-playback.test.tsx`：按需加载、顺序、导航释放和媒体校验。
- `tests/recording-favorite-notification-store.test.ts`：事件合并、账号切换、查询不已读。
- `tests/recording-favorites-sdk.test.ts`：能力、生命周期和 Tools 有界正文。
- `tests/e2e/recording-favorites-installed.mjs`：官方 DSH 安装产物、真实会话 Tools、仓外 SDK、TEST 录音及 UI；必须显式传入隔离测试账号与分享 SID。

没有更改插件版本、客户端源码或运行时发布清单。生产发布与已安装客户端升级需要单独走发布门禁。
