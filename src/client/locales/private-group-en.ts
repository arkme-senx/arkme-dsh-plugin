export const privateGroupEnglish: Record<string, string> = Object.fromEntries(`
发起群聊|Start a group chat
已带入你和当前私聊对象，再选择至少一人即可建群。新成员从新群开始聊天。|You and your chat partner are included. Select at least one more person. New members start with the new group’s messages.
联系人列表未加载完整，请刷新重试|The people list is incomplete. Please refresh.
打开已创建的群|Open the created group
重试确认创建结果|Retry to confirm creation
仍然新建群聊|Create another group
仍然创建群聊|Create group anyway
发现已有群聊，可以直接打开，也可以选择另建。|An existing group was found. Open it or choose to create another.
移除 {v0}|Remove {v0}
已选 {v0} 人|{v0} people selected
选择群成员|Choose group members
搜索联系人或最近聊天|Search contacts or recent chats
选择成员：{v0}|Select person: {v0}
正在读取联系人和最近聊天…|Loading contacts and recent chats…
已加载的联系人中没有匹配结果|No matches among the loaded people
没有找到匹配的联系人|No matching people
部分联系人暂未加载完整|Some people could not be loaded
刷新联系人|Refresh people
已有群聊检查|Check existing groups
已有群聊|Existing groups
选择其他成员后，检查是否已有相同成员的群。|Choose more people to check for existing groups with these members.
正在检查已有群聊…|Checking existing groups…
已有群聊尚未检查完整|The group check is incomplete
重新检查|Check again
你也可以选择仍然创建群聊。|You can also choose to create a group anyway.
未找到包含全部已选成员的已有群聊|No existing group containing everyone selected was found
成员完全相同 · {v0} 人|Same members · {v0} people
包含全部已选成员，另有 {v0} 人|Includes everyone selected and {v0} other people
群聊名称（可选）|Group name (optional)
创建结果待确认，重试将沿用本次成员和请求，不会另起一次创建。|Creation is unconfirmed. A retry reuses these members and the same request.
`.trim().split('\n').map(line => line.split('|') as [string, string]))
