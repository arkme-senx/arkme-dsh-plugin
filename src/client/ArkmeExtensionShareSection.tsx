import type { CSSProperties } from 'react'
import type { ArkmeExtensionShare, ArkmeExtensionSource } from '../extensions/types.js'

export function ArkmeExtensionShareSection({ source, share, canRotate, busy, notice, onCopy, onRotate }: {
	source?: ArkmeExtensionSource
	share?: ArkmeExtensionShare
	canRotate: boolean
	busy: boolean
	notice?: string
	onCopy(): void
	onRotate(): void
}) {
	if (source === undefined && share === undefined) return null
	return <section style={styles.section}>
		{source !== undefined && <div style={styles.row}>
			<span style={styles.label}>{source.label}</span>
			<a href={source.url} target="_blank" rel="noopener noreferrer nofollow" style={styles.link}>查看 GitHub 仓库</a>
		</div>}
		{share !== undefined && <div style={styles.row}>
			<span style={styles.label}>只读分享网页</span>
			<span style={styles.actions}>
				<button type="button" style={styles.button} disabled={busy} onClick={onCopy}>复制分享链接</button>
				{canRotate && <button type="button" style={styles.button} disabled={busy} onClick={onRotate}>
					{busy ? '轮换中…' : '轮换链接'}
				</button>}
			</span>
		</div>}
		{notice !== undefined && notice !== '' && <div role="status" style={styles.notice}>{notice}</div>}
	</section>
}

const styles: Record<string, CSSProperties> = {
	section: { display: 'grid', gap: 8, marginTop: 12, padding: 12, border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 10 },
	row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
	label: { color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 12 },
	link: { color: 'var(--dsw-alias-state-success-primary, #09b83e)', fontSize: 12, fontWeight: 600, textDecoration: 'none' },
	actions: { display: 'inline-flex', gap: 8 },
	button: { height: 28, padding: '0 10px', border: '1px solid var(--dsw-alias-border-l1, #e7e9ec)', borderRadius: 7, background: 'transparent', color: 'inherit', fontSize: 11 },
	notice: { color: 'var(--dsw-alias-label-secondary, #717780)', fontSize: 11 },
}
