# 通话引导演示语音

`call-demo-utterance-v1.m4a` 对应林小满视频通话示例的第一条转写，仅用于功能演示，不是真实用户录音。

文本：主画面已经比较稳了，我建议把 Arkme 找到结论的过程放到最前面。

使用 macOS 自带 Tingting 语音离线合成，语速 190，单声道 AAC，22050 Hz，约 5.65 秒。生成命令：

```sh
say -v Tingting -r 190 -o /tmp/call-demo-utterance.aiff '主画面已经比较稳了，我建议把 Arkme 找到结论的过程放到最前面。'
afconvert -f m4af -d aac -b 64000 /tmp/call-demo-utterance.aiff assets/desktop_call/call-demo-utterance-v1.m4a
```

文件名带版本号以配合静态资源的不可变缓存；替换音频时需同步更新示例转写 URL 与服务端资源白名单。
