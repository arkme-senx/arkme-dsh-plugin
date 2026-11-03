/** Public social interface copy; never translate user-authored introductions or names. */
export const publicSocialEnglish: Record<string, string> = Object.fromEntries(`
公开群聊|Public groups
展示群聊|Show a group publicly
找人聊聊|Find people to chat
公开群聊目录|Public group directory
我的公开展示|My public listing
展示自己|List myself
管理我的展示|Manage my listing
展示后，其他用户可以在“找人聊聊”中找到你并发起私聊。你可以随时下架。|Once listed, others can find you and start a private chat. You can unlist yourself at any time.
正在读取公开资料…|Loading public profile…
使用当前账号的公开昵称和头像|Uses your account’s public nickname and avatar
聊天介绍（选填）|Chat introduction (optional)
聊天介绍|Chat introduction
想聊什么，或者愿意分享什么？|What would you like to talk about or share?
下架我的展示|Unlist myself
公开与展示|Public visibility
公开群资料可被其他用户发现。聊天记录仍遵循原有权限。|Others can discover public group details. Chat history follows the existing access rules.
正在读取群公开设置…|Loading group visibility settings…
公开后会出现在群聊目录和你创建的公开群中。|Public groups appear in the group directory and among the groups you created.
群介绍（选填）|Group introduction (optional)
群介绍|Group introduction
在我的世界展示此群|Show this group in my world
其他人可以从你的世界发现并申请加入此群。|Others can discover this group in your world and request to join.
此群目前未公开，公开后才可以展示在个人世界。|This group is private. It can be shown in a personal world after it becomes public.
打开群聊|Open group chat
加入群聊|Join group
等待审批|Awaiting approval
进入群聊|Enter group chat
重新申请|Apply again
申请加入|Request to join
入群申请已提交，可以刷新查看审批状态。|Your join request was submitted. Refresh to check its status.
这是你|This is you
{v0}的公开群聊|{v0}’s public groups
搜索公开群聊|Search public groups
搜索公开用户|Search public people
搜索群名称或介绍|Search group names or introductions
搜索昵称或聊天介绍|Search nicknames or chat introductions
刷新目录|Refresh directory
正在读取公开目录…|Loading public directory…
没有找到匹配的结果|No matching results
暂时没有可展示的公开群聊|No public groups to show yet
暂时没有用户公开展示，欢迎先展示自己|No one is listed yet. You can be the first.
暂无群介绍|No group introduction yet
查看群聊：{v0}|View group: {v0}
查看用户：{v0}|View person: {v0}
即我用户|Arkme user
愿意认识新朋友|Open to meeting new people
公开资料详情|Public profile details
返回世界|Back to World
关闭详情|Close details
此群允许直接加入|You can join this group directly
加入此群需要审批|Joining this group requires approval
申请正在等待审批，刷新后可查看最新状态。|Your request is awaiting approval. Refresh to check its status.
看看 TA 的世界|View their world
公开展示已保存|Public listing saved
已下架我的展示|Your listing has been removed
正在读取公开群聊…|Loading public groups…
公开展示设置已保存|Public visibility settings saved
公开群可以被其他用户发现，并显示在你创建的公开群中。|Others can discover public groups, which also appear among the groups you created.
浏览公开群聊|Browse public groups
返回创建群聊|Back to creating a group
操作失败，请重试|The operation failed. Please try again.
读取失败，请重试|Loading failed. Please try again.
`.trim().split('\n').map(line => line.split('|') as [string, string]))
