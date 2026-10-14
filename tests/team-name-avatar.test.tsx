import {expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {ArkmeTeamAvatar,teamNameAvatarText} from '../src/client/ArkmeTeamAvatar.js'
it.each([
 ['即我','即我'],['研发团队','研发'],['ABABA1','AB'],[' alpha ','AL'],['a','A'],[' a b ','AB'],
 ['👩🏽‍💻研发','👩🏽‍💻研'],['e\u0301quipe','E\u0301Q'],['🇨🇳研发','🇨🇳研'],['','团'],
])('keeps at most two visible characters for %s', (name,expected)=>expect(teamNameAvatarText(name)).toBe(expected))
it('renders the current team name without images or member avatars',()=>{
 const render=(name:string)=>renderToStaticMarkup(<ArkmeTeamAvatar name={name} avatar={{mode:'default',key:'team-default'}} size={38}/>)
 expect(render('研发团队')).toContain('>研发</span>')
 expect(render('产品团队')).toContain('>产品</span>')
 expect(render('研发团队')).not.toContain('<img')
})
