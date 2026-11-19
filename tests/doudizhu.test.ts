import { describe, expect, it } from 'vitest'
import * as d from '../src/client/game/doudizhu.js'

const members = ['host','left','right']
function deal() { return d.createRound(members,{now:0,starter:0}) }
function playing() { return d.bid(d.startBidding(deal(),1),'host',3,2) }
function cards(ranks: number[]) {
  const counts = new Map<number,number>()
  return ranks.map(r => {
    const n = counts.get(r) ?? 0
    counts.set(r,n+1)
    return r < 13 ? 4*r+n : r+39
  })
}

describe('斗地主牌型', () => {
  const examples: [d.Kind,number[]][] = [
    ['single',[14]],['pair',[12,12]],['triple',[1,1,1]],['tripleSingle',[1,1,1,14]],
    ['triplePair',[0,0,0,12,12]],['straight',[7,8,9,10,11]],['pairRun',[3,3,4,4,5,5]],
    ['plane',[0,0,0,1,1,1]],['planeSingles',[0,0,0,1,1,1,2,2]],
    ['planePairs',[0,0,0,1,1,1,2,2,4,4]],['fourSingles',[0,0,0,0,1,1]],
    ['fourPairs',[0,0,0,0,1,1,2,2]],['bomb',[12,12,12,12]],['rocket',[13,14]],
  ]
  it.each(examples)('%s 判型并生成对应候选',(kind,ranks) => {
    const hand = cards(ranks)
    expect(d.classify(hand)?.kind).toBe(kind)
    const hint = d.legalPlays(hand).find(c => c.length === hand.length)
    expect(d.classify(hint!)?.kind).toBe(kind)
  })
  it.each([[8,9,10,11,12],[10,10,11,11,12,12],[11,11,11,12,12,12],
    [0,0,0,0,1,1,1,2],[0,0,0,0,1,1,1,1],[0,0,0,1,1,1,3,3,3,3]].map(r => [r]))('拒绝非法主体或带牌 %j',r => {
    expect(d.classify(cards(r))).toBeNull()
  })
  it('不比较花色，严格匹配长度和翼型，炸弹和火箭递进',() => {
    const pattern = (r: number[]) => d.classify(cards(r))!
    expect(d.beats(d.classify([1])!,d.classify([2])!)).toBe(false)
    expect(d.beats(pattern([1,2,3,4,5,6]),pattern([0,1,2,3,4]))).toBe(false)
    expect(d.beats(pattern([1,1,1,2,2]),pattern([0,0,0,2]))).toBe(false)
    const target = pattern([0])
    const hints = d.legalPlays(cards([0,1,2,2,2,2,13,14]),target)
    expect(hints.map(c => d.classify(c,target)?.kind)).toEqual(['single','single','single','single','bomb','rocket'])
    expect(d.legalPlays(cards([0,0,0,0]),pattern([1,1,1,1]))).toEqual([])
    expect(d.legalPlays(cards([13,14]),pattern([13,14]))).toEqual([])
  })
  it('非法和重复牌拒绝',() => {
    for (const c of [[54],[-1],[0,0],[1.5]]) expect(() => d.classify(c)).toThrow()
  })
})

describe('斗地主牌局',() => {
  it('发牌完整、投影隔离、握手截止与计时选项',() => {
    const state = deal()
    expect(new Set([...state.hands.flat(),...state.bottom]).size).toBe(54)
    expect(d.publicView(state)).toMatchObject({counts:[17,17,17],bottom:null,remaining:null,turn:null})
    expect(d.publicView(state)).not.toHaveProperty('hands')
    expect(d.privateView(state,'host').hand).toEqual(state.hands[0])
    expect(() => d.privateView(state,'spectator')).toThrow()
    expect(() => d.startBidding(state,30000)).toThrow()
    expect(d.timeout(state,30001)).toBe(state)
    expect(() => d.createRound(['x','x','y'])).toThrow()
    for (const turnSeconds of [30,60,90,120]) {
      expect(d.startBidding(d.createRound(members,{turnSeconds,now:0}),1).deadline).toBe(1+1000*turnSeconds)
    }
    expect(() => d.createRound(members,{turnSeconds:20})).toThrow()
  })
  it('轮流一次叫分、全不叫重发并轮换、最高分得底牌',() => {
    let s = d.startBidding(deal(),1)
    expect(() => d.bid(s,'right',1)).toThrow()
    const first = d.bid(s,'host',2,2)
    expect(() => d.bid(first,'left',2,3)).toThrow()
    const assigned = d.bid(d.bid(first,'left',0,3),'right',0,4)
    expect(d.publicView(assigned)).toMatchObject({landlord:0,turn:0,counts:[20,17,17],bottom:s.bottom})
    for (const m of members) s = d.bid(s,m,0,2)
    expect(s).toMatchObject({round:2,phase:'dealing',starter:1,bids:[null,null,null]})
    expect(d.startBidding(s,3).turn).toBe(1)
  })
  it('超时叫分、自由领出最小单、跟牌不出、两次不出清空',() => {
    const b = d.startBidding(deal(),1)
    expect(d.timeout(b,60000)).toBe(b)
    expect(d.timeout(b,60001).bids).toEqual([0,null,null])
    const s = playing()
    expect(() => d.pass(s,'host')).toThrow()
    expect(() => d.play(s,'host',[s.hands[1]![0]!])).toThrow()
    let p = d.timeout(s,s.deadline!)
    expect(p.lastCards).toEqual([Math.min(...s.hands[0]!)])
    p = d.timeout(p,p.deadline!)
    p = d.timeout(p,p.deadline!)
    expect(p).toMatchObject({turn:0,target:null,lastPlayer:0,passes:0,recent:[{type:'play'},{type:'pass'},{type:'pass'}]})
  })
  it('重新入座、主动退出与轮换开新局',() => {
    const s = playing()
    const resumed = d.replaceMember(s,'host','host2')
    expect(d.privateView(resumed,'host2').hand).toEqual(s.hands[0])
    expect(() => d.replaceMember(s,'host','left')).toThrow()
    const ended = d.withdraw(resumed,'right')
    expect(d.publicView(ended)).toMatchObject({phase:'ended',remaining:s.hands,winners:[],reason:'withdraw'})
    expect(d.nextRound(ended,5)).toMatchObject({round:2,starter:1,phase:'dealing'})
  })
  it.each([0,1,2])('座位 %i 出完后按阵营结算',seat => {
    const s = {...playing(),hands:[[0],[4],[8]],turn:seat}
    const done = d.play(s,members[seat]!,s.hands[seat]!,3)
    expect(done).toMatchObject({phase:'ended',turn:null,winners:seat === 0 ? [0] : [1,2],reason:'empty'})
  })
})

it('按点数穷举子集与合法候选完全一致',() => {
  const hand = cards([0,0,0,0,1,1,1,2,2,3,13,14])
  const key = (choice: number[]) => choice.map(d.rank).sort((a,b) => a-b).join(',')
  for (const target of [null,d.classify(cards([0,0,0,4])),d.classify(cards([0])),d.classify(cards([13,14]))]) {
    const expected = new Set<string>()
    for (let mask=1; mask<2**hand.length; mask++) {
      const choice = hand.filter((_,i) => Boolean(mask & (1 << i)))
      if (d.classify(choice,target)) expected.add(key(choice))
    }
    const actual = d.legalPlays(hand,target)
    expect(new Set(actual.map(key))).toEqual(expected)
    expect(actual.length).toBe(expected.size)
  }
})

it('不同长度顺子也按主体点数升序提示',() => {
  const straights = d.legalPlays(cards([0,1,2,3,4,5,6])).map(p => d.classify(p)!).filter(p => p.kind === 'straight')
  expect(straights.map(p => p.high)).toEqual([4,5,5,6,6,6])
})

it('歧义飞机按实际出牌主体排列提示',() => {
  const hand = [12,13,14,16,17,18,20,21,22,24,25,26,28,32,36]
  const target: d.Pattern = {kind:'planeSingles',high:4,length:3}
  const highs = d.legalPlays(hand,target).map(choice => d.classify(choice,target)!.high)
  expect(new Set(highs)).toEqual(new Set([5,6]))
  expect(highs).toEqual([...highs].sort((a,b) => a-b))
})
