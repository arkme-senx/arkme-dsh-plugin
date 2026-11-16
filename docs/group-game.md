# 内部群游戏

群聊快记输入 `/game` 并发送，选择跳棋。房主复制房间钥匙，将完整文本分享给其他人；完整分享文案可正常发送为快记；接收者提取「」内的 /game join 命令，单独粘贴到群聊输入框发送以加入。只有裸命令被客户端消费。最多26个房间成员，房主选择2/3/4/6名玩家，其余观察。

独立游戏资源：`lib/game.js`，由 tsdown 构建并通过 `${routePath}/game/index.html` 与 `/game/game.js` 提供。游戏 SDK 不使用通话 iframe，退出不注销设备。设备注册仍由单一 DeviceRegistrationService 管理，新安装游戏自身的ready也能建立绑定。

桌面需要配套客户端 `zp-codex/v232-group-game` 的专用弹窗策略。旧客户端未放行时不能打开，输入保留。游戏窗口左棋盘右聊天；同设备只允许一个窗口。

后端默认启用游戏，复用 `trtc.admin-user-id`，腾讯后台必须支持Public群REST管理；管理员凭证不下发。

验证：`vitest run tests/game.test.ts tests/game-runtime.test.ts tests/device-registration-service.test.ts`；`tsc --noEmit`；`tsdown`。

浏览器隔离冒烟：`node scripts/game-browser-smoke.mjs`，需可用 playwright 和 Chrome。可用 `GAME_PLAYWRIGHT_MODULE` 指定模块路径、`GAME_CHROME_PATH` 指定浏览器。测试替换Tencent SDK和后端，只验证真实界面/游戏模块，不访问真实账号。截图输出 `test-results/game/window.png`。

真实腾讯多人联调需在部署测试后端、配置管理员后完成，模拟测试不代表已经验证腾讯生产套餐/权限。

身份配置已确认：当前worktree保留通话接收器自动登录路径，用户已确认腾讯同账号允许至少两个Web实例。游戏继续复用registration_id，并独立管理自己的SDK。未修改接收器或腾讯全局登录设置；测试服仍需验证真实多人及同时通信。
