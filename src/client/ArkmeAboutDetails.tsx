import { useEffect, useRef, useState } from 'react'
import type { ArkmeInvitationRewards } from '../types.js'
import { callArkme } from './api.js'
import { tr, useArkmeLocale } from './locale.js'
import productIcon from '../../assets/branding/jiwo-about-icon.png'
import wechatQr from '../../assets/branding/jiwo-official-wechat.png'
import wechatSocialIcon from '../../assets/branding/icon_run_weixin_gongzhonghao.svg'
import xiaohongshuIcon from '../../assets/branding/icon_run_xiaohongshu.svg'
import douyinIcon from '../../assets/branding/icon_run_douyin.png'
import jikeIcon from '../../assets/branding/icon_run_jike.svg'
import weiboIcon from '../../assets/branding/icon_run_weibo.svg'

/** Official addresses and registry identifiers match Flutter's domestic About page.
 * Identifiers and company legal name are preserved verbatim in every locale. */
export const aboutSocialLinks = [
  { get label() { return tr("小红书") }, icon: `data:image/svg+xml;base64,${xiaohongshuIcon}`, href: 'https://www.xiaohongshu.com/user/profile/645464ff00000000290168b1' },
  { get label() { return tr("抖音") }, icon: `data:image/png;base64,${douyinIcon}`, href: 'https://www.douyin.com/user/MS4wLjABAAAACyK_g4xd0gUVN4ViU4FigeAYc2RFPO-sEp9RjXc6C4OWmDF9cJx9nzXBSEDw2J-C' },
  { get label() { return tr("即刻") }, icon: `data:image/svg+xml;base64,${jikeIcon}`, href: 'https://okjk.co/tHwXUq' },
  { get label() { return tr("微博") }, icon: `data:image/svg+xml;base64,${weiboIcon}`, href: 'https://weibo.com/u/7960184078' },
] as const

export function ArkmeAboutProduct() {
  return <div className="arkme-about-product"><img src={`data:image/png;base64,${productIcon}`} alt={tr('即我')} /></div>
}

export function ArkmeAboutDetails({ accountScope }: { accountScope?: string | undefined }) {
  useArkmeLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  const [panel, setPanel] = useState<'invite' | 'wechat'>()
  const [rewards, setRewards] = useState<ArkmeInvitationRewards>()
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => { if (panel) dialog.current?.showModal() }, [panel])
  useEffect(() => { setPanel(undefined); setRewards(undefined) }, [accountScope])
  useEffect(() => {
    if (panel !== 'invite' || !accountScope) return
    const controller = new AbortController()
    setRewards(undefined); setError(''); setCopied(false)
    void callArkme<ArkmeInvitationRewards>('account.invitation.get', { expectedAccountScope: accountScope }, controller.signal)
      .then(value => { if (!controller.signal.aborted && value.accountScope === accountScope) setRewards(value) })
      .catch(() => { if (!controller.signal.aborted) setError('邀请信息暂时无法读取') })
    return () => { controller.abort() }
  }, [panel, accountScope, revision])
  return <>
    <button type="button" className="arkme-profile-edit-row" onClick={() => { setPanel('invite') }}><span>{tr('邀请得会员')}</span><span aria-hidden>›</span></button>
    <nav className="arkme-about-social" aria-label={tr('社交平台')}>
      <button type="button" onClick={() => { setPanel('wechat') }}><img src={`data:image/svg+xml;base64,${wechatSocialIcon}`} alt="" aria-hidden /><span>{tr('公众号')}</span></button>
      {aboutSocialLinks.map(item => <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"><img src={item.icon} alt="" aria-hidden /><span>{item.label}</span></a>)}
    </nav>
    <footer className="arkme-about-legal">
      <p><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{tr('ICP备案号')}：鄂ICP备2024037215号</a></p>
      <p>{tr('增值电信业务经营许可证')}：鄂B2-20240478</p>
      <p>{tr('软著')}：软著登字第14519261号</p>
      <p>森奇思(武汉)科技有限公司</p>
    </footer>
    {panel && <dialog ref={dialog} className="arkme-profile-edit-dialog" aria-label={tr(panel === 'invite' ? '邀请得会员' : '公众号')} onCancel={() => { setPanel(undefined) }}>
      <h3>{tr(panel === 'invite' ? '邀请得会员' : '公众号')}</h3>
      {panel === 'wechat' ? <img src={`data:image/png;base64,${wechatQr}`} width={220} height={220} style={{ display:'block', margin:'20px auto', background:'#fff' }} alt={tr('公众号二维码')} /> : <>
        {!accountScope ? <p>{tr('登录后查看邀请奖励')}</p> : rewards ? <>
          <p>{tr('我的邀请码')}</p><strong className="arkme-about-code">{rewards.code}</strong>
          <p>{tr('已邀请 {count} 位好友', { count: rewards.invitedCount })}</p>
          <p>{tr('好友可在手机端的“邀请得会员”中填写邀请码，奖励以当前活动规则为准。')}</p>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(rewards.code).then(() => { setCopied(true) }).catch(() => { setError('复制失败，请手动复制') }) }}>{tr(copied ? '已复制' : '复制邀请码')}</button>
          {error && <p role="alert">{tr(error)}</p>}
        </> : error ? <p role="alert">{tr(error)} <button type="button" onClick={() => { setRevision(value => value + 1) }}>{tr('重试')}</button></p> : <p role="status">{tr('正在读取…')}</p>}
      </>}
      <footer><button type="button" onClick={() => { setPanel(undefined) }}>{tr('关闭')}</button></footer>
    </dialog>}
  </>
}
