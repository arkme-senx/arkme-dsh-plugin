import type { ArkmeRecordingDay, ArkmeRecordingWorkbenchItem, ArkmeRecordingVersion, ArkmeRecordingTimelineEvent } from '../../types.js'
// Presentation-only fixture. These identifiers must never enter real recording state or API payloads.
const dateStamp = new Date(2026, 8, 3).getTime()
const speakers = ['小林', '阿岚', '小周', '陈晨', '许悦', '妈妈'] as const
const at = (time: string) => {
 const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number)
 return dateStamp + (hour * 3600 + minute * 60 + second) * 1000
}
interface Scene {
 title: string; scene: string; emotion: string; description: string; todo: string; tags: string[]
 lines: [time: string, speaker: typeof speakers[number], text: string][]
}
const scenes: Scene[] = [
 {
  title:'早餐时安排一天',scene:'家庭早餐',emotion:'从容',tags:['生活安排','家人'],
  description:'小林与妈妈交流当天行程，约好晚上一起吃饭，出门前确认了天气和购物安排。',todo:'小林下班带牛奶回家。',
  lines:[
   ['08:30:00','妈妈','今天早上做了小米粥，吃完再出门吧。你上午是不是有项目讨论？'],
   ['08:34:00','小林','九点半和阿岚、小周过一下体验活动方案，下午还要检查报名流程。'],
   ['08:38:00','妈妈','那中午记得按时吃饭。我晚上做番茄炖牛肉，你大概几点到家？'],
   ['08:42:00','小林','下班先和朋友喝杯咖啡，七点半左右回来。我顺路带一盒牛奶。'],
   ['08:45:00','妈妈','好，天气预报说傍晚可能有阵雨，门口那把伞记得带上。'],
  ],
 },
 {
  title:'明确体验活动方案',scene:'项目讨论',emotion:'专注',tags:['项目协作','分工'],
  description:'小林、阿岚和小周确定下周体验活动采用小范围邀请，先保证报名和提醒流程完整，再完善视觉细节。',todo:'阿岚周五中午前交付邀请页；小周整理体验清单；小林汇总进度。',
  lines:[
   ['09:30:00','小林','下周的体验活动先邀请二十位用户，今天把报名、提醒和现场反馈串起来。'],
   ['09:38:00','阿岚','邀请页我来做。页面先讲清楚活动内容，再放报名入口，周五中午前给大家看。'],
   ['09:46:00','小周','我整理体验清单，覆盖首次进入、报名成功和活动提醒，重点看用户会不会卡住。'],
   ['09:54:00','小林','我们先保证整个流程能走通，装饰性的细节放到下一轮。我来收集大家的进度。'],
   ['10:02:00','阿岚','那我把报名完成后的提示也补上，下午和小周一起检查，免得用户不知道下一步做什么。'],
  ],
 },
 {
  title:'午餐交流学习与兴趣',scene:'同事午餐',emotion:'轻松',tags:['学习','摄影'],
  description:'午餐时，小林、陈晨与许悦聊到学习安排和摄影，决定从小目标开始，避免同时安排太多事情。',todo:'陈晨把摄影入门文章发到群里。',
  lines:[
   ['12:15:00','陈晨','这家店的套餐上得挺快。最近我想学摄影，但一看课程目录就觉得要学的太多了。'],
   ['12:23:00','许悦','可以先拿手机拍同一个主题，比如每天拍一张路上的光影，比一次报很多课容易坚持。'],
   ['12:31:00','小林','我也想把读书习惯捡起来，先每天留二十分钟，不再给自己列一长串书单。'],
   ['12:39:00','陈晨','这个办法好。我收藏了一篇讲构图的入门文章，吃完发群里，周末可以一起练习。'],
   ['12:47:00','许悦','我们先各选一个小目标，下周午饭时再聊实际做了什么，不用急着比较成果。'],
  ],
 },
 {
  title:'排查报名重复提交',scene:'下午协作',emotion:'踏实',tags:['问题排查','体验优化'],
  description:'下午联调发现慢网络下连续点击会重复提交报名。团队完成防重复处理，并验证失败提示与重新尝试流程。',todo:'小周周五再做一轮手机端回归检查。',
  lines:[
   ['14:00:00','小周','我在手机上试报名，网络慢的时候连点两下会出现两条记录，得把这个场景补上。'],
   ['14:12:00','阿岚','我复现了。提交期间先禁用按钮，并显示正在提交；服务端也要识别重复请求。'],
   ['14:24:00','小林','成功和失败都要给明确反馈，失败时保留已经填写的内容，让用户可以重试。'],
   ['14:36:00','阿岚','防重复和失败提示已经补好了，我们用慢网络再走一次，确认不会重复报名。'],
   ['14:48:00','小周','这次只生成了一条记录，失败后内容也还在。我周五再检查不同手机尺寸和提醒链接。'],
  ],
 },
 {
  title:'与朋友商量周末散步',scene:'下班后咖啡馆',emotion:'期待',tags:['朋友','周末计划'],
  description:'下班后，小林、陈晨与许悦约定周六上午去河边散步拍照；如遇下雨则改去附近的展馆。',todo:'许悦周五确认展馆是否需要预约；陈晨周五晚发天气和集合位置。',
  lines:[
   ['18:30:00','许悦','周六上午要不要去河边走走？那边新修了步道，顺便试试中午说的光影练习。'],
   ['18:38:00','陈晨','好啊，九点半在东门集合，人应该还不多。我把相机带上，手机也一样能拍。'],
   ['18:46:00','小林','我参加，不过如果下雨就别硬走了，附近那个城市展馆可以当备选。'],
   ['18:54:00','许悦','我周五查一下展馆要不要预约，确认后告诉你们，大家不用提前买票。'],
   ['19:02:00','陈晨','那我周五晚上把天气和集合位置发群里。我们轻装出门，走累了再找地方坐坐。'],
  ],
 },
 {
  title:'晚间回顾与家人约定',scene:'居家聊天',emotion:'放松',tags:['每日回顾','陪伴'],
  description:'晚上小林与妈妈回顾当天的协作和生活安排，确认牛奶已买好，并约好周日去花市。',todo:'小林周六晚确认周日去花市的出发时间。',
  lines:[
   ['20:30:00','妈妈','牛奶已经放冰箱了。今天活动方案讨论得怎么样，下午的问题解决了吗？'],
   ['20:38:00','小林','方案定下来了，报名重复提交的问题也处理了。大家分工清楚以后，做起来顺多了。'],
   ['20:45:00','妈妈','听起来挺充实。周六你和朋友出去，周日有空陪我去花市看看阳台上的植物吗？'],
   ['20:52:00','小林','可以，周六晚上我们再定几点出门。今天中午还聊到读书，我准备睡前先读二十分钟。'],
   ['20:59:20','妈妈','慢慢来就好，工作之外也给自己留点时间。书读完早点休息，明天再继续。'],
  ],
 },
]
const items: ArkmeRecordingWorkbenchItem[] = scenes.flatMap((scene,sceneIndex) => scene.lines.map(([time,speaker,text],index) => {
 const speakerIndex=speakers.indexOf(speaker)
 return {
  itemId:`recording-tour-sample:${sceneIndex}:${index}`,itemRef:`recording-tour-sample:${sceneIndex}:${index}`,transcriptSource:'system',sessionKey:`recording-tour-sample:${sceneIndex}`,
  startAtMillis:at(time),endAtMillis:at(time)+40000,speakerNumber:speakerIndex+1,speakerKey:`sample-speaker:${speakerIndex}`,speakerColorIndex:speakerIndex,speakerLabel:speaker,
  sameSpeakerItemCount:scenes.flatMap(value=>value.lines).filter(line=>line[1]===speaker).length,isSelf:speaker==='小林',isBackground:false,text,
 }
}))
const clock = (millis:number) => new Date(millis).toTimeString().slice(0,8)
const events: ArkmeRecordingTimelineEvent[] = scenes.map((scene,index) => {
 const first=items[index*5]!,last=items[index*5+4]!
 return {eventId:`sample-event:${index}`,startAt:clock(first.startAtMillis),endAt:clock(last.endAtMillis),timeRange:`${clock(first.startAtMillis).slice(0,5)}–${clock(last.endAtMillis).slice(0,5)}`,title:scene.title,description:scene.description,todo:scene.todo,scene:scene.scene,emotion:scene.emotion,tags:scene.tags,participants:[...new Set(scene.lines.map(line=>line[1]))],rawText:scene.lines.map(line=>line[2]).join('\n')}
})
const content = `# 我的这一天

## 一、今日概览

今天从与妈妈的早餐交流开始，贯穿了项目讨论、同事午餐、下午协作和下班后的朋友聚会，最后回到家中与家人聊了聊一天的收获。白天主要围绕下周体验活动推进：明确分工、检查报名流程，并解决了慢网络下重复提交的问题。午间和晚间的交流则更多围绕学习、兴趣与陪伴，从每天读书二十分钟，到周末散步拍照，为工作之外的生活留下了具体安排。

## 二、关键事件

- 08:30 早餐时与妈妈交流当天行程，约好晚上回家吃饭，并记下下班购买牛奶的安排。
- 09:30 与阿岚、小周确定下周体验活动先邀请二十位用户，优先打通报名、提醒和反馈流程，明确邀请页、体验清单与进度汇总的分工。
- 12:15 午餐时与陈晨、许悦讨论摄影和阅读，决定从每天一个小目标开始，减少同时安排太多计划带来的压力。
- 14:00 与阿岚、小周联调报名流程，发现并修复慢网络下重复提交的问题，验证了失败提示、内容保留与重新尝试的体验。
- 18:30 下班后与陈晨、许悦约好周六上午九点半在河边东门集合，散步拍照；如果下雨，改去附近的城市展馆。
- 20:30 与妈妈回顾当天工作，确认牛奶已买好，约定周日一起去花市，并为睡前阅读留出时间。

## 三、待办与后续安排

- 阿岚：周五中午前交付体验活动邀请页。
- 小周：整理体验清单，并在周五完成手机端和提醒链接的回归检查。
- 小林：汇总活动准备进度；周六晚与妈妈确认周日去花市的出发时间。
- 陈晨：分享摄影入门文章，周五晚发送周末天气和集合位置。
- 许悦：周五确认城市展馆是否需要预约。

## 四、感受与回顾

今天的协作从明确优先级和分工开始，下午的问题也通过共同复现、调整和验证逐步解决。生活中的交流同样带来了可执行的小安排：把学习拆成每天能完成的一步，为朋友相聚准备雨天备选，也给家人留出陪伴时间。一天的节奏从专注忙碌渐渐转向轻松安定。`
const version: ArkmeRecordingVersion = {id:'recording-tour-sample:version',status:'done',selectable:true,generationStage:2,generatedAtMillis:at('21:05:00'),modelDisplayName:'',content,timelineEvents:events,error:''}
// The day spans morning to evening; only the simulated recorded segments count as duration.
const totalDurationMillis=items.reduce((total,item)=>total+item.endAtMillis-item.startAtMillis,0)
export const recordingTourSample: ArkmeRecordingDay = {
 dateStamp,totalDurationMillis,
 transcript:{state:'ready',items,message:'',totalDurationMillis,processingCount:0},
 summary:{state:'ready',items:[version],message:''},timeline:{state:'ready',items:[version],message:''},
}
