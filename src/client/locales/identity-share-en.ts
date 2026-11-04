export const identityShareEnglish: Record<string, string> = Object.fromEntries(`
以团队联系|Contact as team
该消息缺少成员身份，请刷新会话后重试|This message has no member identity. Refresh the conversation and retry.
成员资料返回异常，请重试|Invalid member details. Please retry.
成员资料加载失败，请重试|Unable to load member details. Please retry.
正在确认 @{name} 的身份…|Verifying @{name}…
@{name} 暂不可用|@{name} is unavailable
成员资料读取失败，重试|Unable to load member details. Retry
正在打开私聊…|Opening private chat…
正在打开TA的世界…|Opening their world…
以 {team} 联系|Contact as {team}
切换联系团队|Switch contact team
重试读取团队|Retry loading teams
暂时无法读取团队|Unable to load teams
团队列表返回异常，请重试|Invalid team list. Please retry.
联系用户 · {team}|Contact user · {team}
搜索联系人 / 即我号 / 手机号|Search contacts / account / phone
查找用户“{query}”|Find user “{query}”
发起会话|Start conversation
你已不在该团队中，请重新进入团队|You are no longer a member. Reopen the team.
目录返回异常，请重试|Invalid directory response. Please retry.
会话分页异常，请重试|Invalid conversation pagination. Please retry.
正在加载群聊…|Loading groups…
重试加载群聊|Retry loading groups
加载更多会话|Load more conversations
{v0} 的成员|Members of {v0}
更新中…|Updating…
更新失败|Update failed
重试更新名片|Retry profile update
名片链接无效，请重新打开|Invalid card link. Reopen the card.
更多操作|More actions
进入我的世界|Enter my world
看看日常、想法与分享|Discover moments, thoughts and stories
正在读取资料…|Loading profile…
联系人名片|Contact card
群聊名片|Group card
名片|Contact or group card
复制个人链接|Copy profile link
复制群聊链接|Copy group link
复制我的链接|Copy my profile link
复制对方链接|Copy contact link
正在复制…|Copying…
链接已复制|Link copied
复制失败，请重试|Could not copy. Please try again.
账号已切换，请重新复制链接|Your account changed. Please copy the link again.
正在读取名片…|Loading card…
名片暂时无法打开|This card is temporarily unavailable
查看我的世界|View my world
查看世界|View world
邀请人：|Invited by:
群主：|Group owner:
你已在此群聊中|You are already in this group
加入此群需要审批|Approval is required to join this group
点击加入后即可进入群聊|Choose Join to enter this group
邀请有效期至：|Invitation expires:
刷新名片|Refresh card
在浏览器中打开|Open in browser
邀请已过期|Invitation expired
`.trim().split('\n').map(line => line.split('|') as [string, string]))
