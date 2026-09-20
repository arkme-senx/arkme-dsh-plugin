import { useId } from 'react'
import type { ArkmeSourceItem } from '../types.js'

/** The compact four-point star beside private-chat peer names. */
export function ArkmeMembershipBadge({ memberType }: { memberType: ArkmeSourceItem['peerMemberType'] }) {
  const clipId = useId()
  if (memberType !== 'vip' && memberType !== 'svip') return null
  const svip = memberType === 'svip'
  const label = svip ? 'SVIP 会员' : 'VIP 会员'
  const star = 'M9.81831 6.37497C8.21817 6.03157 6.96869 4.78208 6.62528 3.18195L6.50013 2.59961L6.37187 3.19746C6.03053 4.78725 4.78725 6.03053 3.19746 6.37187L2.59961 6.50013L3.19126 6.62735C4.78518 6.96972 6.03053 8.21404 6.37187 9.80796L6.49909 10.4006L6.62218 9.82555C6.96662 8.22128 8.22024 6.96765 9.82451 6.62321L10.3996 6.50013Z'
  return <svg width="13" height="13" viewBox="0 0 13 13" role="img" aria-label={label}
    data-arkme-membership={memberType} className="arkme-peer-membership"
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}>
    <circle className="arkme-peer-membership-disc" cx="6.5" cy="6.5" r="6.37"
      fill={svip ? '#fdf8f5' : '#f2f2f9'} stroke={svip ? '#f4efed' : '#e6dff3'} strokeWidth=".26" />
    <defs><clipPath id={clipId}><path d={star} /></clipPath></defs>
    <path d={star} fill={svip ? '#e3b65b' : '#d8c7f9'} />
    <g clipPath={`url(#${clipId})`} fill={svip ? '#c59741' : '#c9b2e4'}>
      <rect x="2.24316" y="2.48047" width="4.25048" height="4.01214" />
      <rect x="6.49219" y="6.49219" width="4.25048" height="4.01214" />
    </g>
  </svg>
}
