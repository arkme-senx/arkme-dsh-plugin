import type { CSSProperties } from 'react'
import type { ArkmeSharedExtensionDetail as SharedExtension } from '../extensions/types.js'
import { ArkmeExtensionIcon } from './ArkmeExtensionIcon.js'
import { arkmeTheme } from './arkme-theme.js'

export function ArkmeSharedExtensionDetail({ extension, onBack }: {
	shareRef: string
	extension: SharedExtension
	onBack(): void
}) {
	return <div style={styles.detail}>
		<button type="button" style={styles.back} onClick={onBack}>‹ 返回列表</button>
		<div style={styles.hero}>
			<span style={styles.icon} aria-hidden><ArkmeExtensionIcon size={26} /></span>
			<div style={styles.heading}>
				<div style={styles.name}>{extension.name}</div>
				<div style={styles.scope}>通过分享链接查看 · 只读</div>
			</div>
		</div>
		<section style={styles.rating} aria-label={`评分 ${extension.rating_summary.average.toFixed(1)}`}>
			<span style={styles.stars} aria-hidden>★★★★★</span>
			<strong>{extension.rating_summary.average.toFixed(1)}</strong>
			<span>{extension.rating_summary.count} 个评分</span>
		</section>
		<section style={styles.section}>
			<div style={styles.label}>市场最新版本</div>
			<div>{extension.latest_stable_version}</div>
		</section>
		<section style={styles.section}>
			<div style={styles.label}>扩展说明</div>
			<div style={styles.description}>{extension.description || '这个扩展还没有填写说明。'}</div>
		</section>
		{extension.source !== undefined && <section style={styles.section}>
			<div style={styles.label}>来源</div>
			<div>{extension.source.label} · <a
				href={extension.source.url} target="_blank" rel="noopener noreferrer nofollow" style={styles.source}
			>查看 GitHub 仓库</a></div>
		</section>}
		<div role="note" style={styles.notice}>分享链接仅用于查看，不授予安装、评论、执行或管理权限。</div>
	</div>
}

const styles: Record<string, CSSProperties> = {
	detail: { padding: '8px 0 18px', color: arkmeTheme.text },
	back: {
		margin: '0 0 18px', padding: 0, border: 0, background: 'transparent', color: arkmeTheme.secondary,
		font: 'inherit', fontSize: 12, cursor: 'pointer',
	},
	hero: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 },
	icon: {
		width: 48, height: 48, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 12,
		background: arkmeTheme.accentSoft, color: arkmeTheme.accent,
	},
	heading: { minWidth: 0 },
	name: { fontSize: 18, lineHeight: '25px', fontWeight: 650, wordBreak: 'break-word' },
	scope: { marginTop: 2, color: arkmeTheme.secondary, fontSize: 11, lineHeight: '17px' },
	rating: {
		display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, padding: '12px 14px',
		borderRadius: 10, background: arkmeTheme.subtle, color: arkmeTheme.secondary, fontSize: 12,
	},
	stars: { color: '#F4A000', letterSpacing: 1 },
	section: { padding: '13px 0', borderTop: `1px solid ${arkmeTheme.borderSoft}`, fontSize: 12, lineHeight: '19px' },
	label: { marginBottom: 4, color: arkmeTheme.secondary, fontSize: 11 },
	description: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
	source: { color: arkmeTheme.accent, fontWeight: 600, textDecoration: 'none' },
	notice: {
		marginTop: 12, padding: '10px 12px', borderRadius: 9, background: arkmeTheme.subtle,
		color: arkmeTheme.secondary, fontSize: 11, lineHeight: '17px',
	},
}
