import {renderToStaticMarkup} from 'react-dom/server'
import {expect,it,vi} from 'vitest'
import {ArkmeTopicCard,ArkmeTopicTreeRow} from '../src/client/ArkmeVirtualWorkspace.js'
const source={kind:'topic' as const,sourceRef:'t',displayName:'主题',activeAtMillis:0,unreadCount:0}
it('renders the same action slot in both topic presentations',()=>{
 const actions=<button aria-label="主题操作">···</button>
 const common={selected:false,hovered:true,onHoverChange:vi.fn(),onSelect:vi.fn(),actions}
 expect(renderToStaticMarkup(<ArkmeTopicTreeRow {...common} row={{source,depth:0,hasChildren:false,expanded:false}} onToggle={vi.fn()} onCreateChild={vi.fn()}/>)).toContain('aria-label="主题操作"')
 expect(renderToStaticMarkup(<ArkmeTopicCard {...common} source={source}/>)).toContain('aria-label="主题操作"')
})

it('keeps system topics read-only in both topic presentations',()=>{
 const systemSource={...source,topicKind:3}
 const common={selected:false,hovered:true,onHoverChange:vi.fn(),onSelect:vi.fn(),actions:<button aria-label="主题操作">···</button>}
 const tree=renderToStaticMarkup(<ArkmeTopicTreeRow {...common} row={{source:systemSource,depth:0,hasChildren:false,expanded:false}} onToggle={vi.fn()} onCreateChild={vi.fn()}/>)
 expect(tree).not.toContain('aria-label="主题操作"')
 expect(tree).not.toContain('创建子主题')
 expect(renderToStaticMarkup(<ArkmeTopicCard {...common} source={systemSource}/>)).not.toContain('aria-label="主题操作"')
})
