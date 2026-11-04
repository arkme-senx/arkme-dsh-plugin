import { DownloadSimple } from '@phosphor-icons/react/dist/icons/DownloadSimple';
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise';
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle';
import { FolderOpen } from '@phosphor-icons/react/dist/icons/FolderOpen';
import { useEffect, useRef, useState } from 'react';
import exportCss from './record-export.css?inline';
import type { ArkmeExportPreflight, ArkmeRecordExport, ArkmeRangeExportPreview } from '../data-management.js';
import { createArkmeSdk } from '../sdk/index.js';
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js';
import { ArkmeExportDateRange } from './ArkmeExportDateRange.js';
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js';
import { recordExportDatePreset, type RecordExportRangeKind } from './record-export-selection.js';
import { useRecordExportRange } from './use-record-export-range.js';
export function ArkmeRecordExportPanel({ scope, preflight, loading = false, onRefresh }: {
    scope: string;
    preflight: ArkmeExportPreflight | undefined;
    loading?: boolean;
    onRefresh?: () => void;
}) {
    useArkmeLocale();
    const [range, setRange] = useState<RecordExportRangeKind>('incremental'), [dates, setDates] = useState(() => recordExportDatePreset('week')), [attachments, setAttachments] = useState(true), [order, setOrder] = useState<1 | 2>(1);
    const [destination, setDestination] = useState<{
        ref: string;
        name: string;
        path?: string;
    }>(), [picking, setPicking] = useState(false), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [count, setCount] = useState(0), [error, setError] = useState(''), [result, setResult] = useState<ArkmeRecordExport>();
    const [taskPreview, setTaskPreview] = useState<ArkmeRangeExportPreview>();
    const controller = useRef<AbortController>(), pickController = useRef<AbortController>(), generation = useRef(0);
    const current = preflight?.accountScope === scope ? preflight : undefined;
    const state = useRecordExportRange(scope, (!!current?.rangeExportV2 || !!destination) && !busy && !result, range, dates, attachments, order, destination?.ref);
    const preview = taskPreview ?? state.preview, locked = busy || picking || confirm;
    const canRun = !!destination && preview?.canExport === true && preview.folderSupported === true && !preview.baselineRequired && !!preview.previewUid && (preview.recordCount + preview.removedCount > 0 || preview.countsPending === true) && !state.loading && !loading;
    const savedAt = preview?.savedAtMillis || current?.rangeExportV2?.savedAtMillis || 0;
    useEffect(() => { generation.current++; controller.current?.abort(); controller.current = undefined; pickController.current?.abort(); pickController.current = undefined; setDestination(undefined); setResult(undefined); setError(''); setBusy(false); setPicking(false); setConfirm(false); setRange('incremental'); return () => { generation.current++; controller.current?.abort(); pickController.current?.abort(); }; }, [scope]);
    useEffect(() => { setTaskPreview(undefined); setResult(undefined); }, [range, dates, attachments, order, destination, scope]);
    async function pick() {
        if (locked)
            return;
        const g = generation.current, sdk = createArkmeSdk(), ctrl = new AbortController();
        pickController.current = ctrl;
        setPicking(true);
        setError('');
        try {
            const selected = await sdk.pickRecordExportDirectory(scope, ctrl.signal);
            if (g === generation.current && !ctrl.signal.aborted && !selected.canceled && selected.destinationRef)
                setDestination({ ref: selected.destinationRef, name: selected.displayName || tr('已选择文件夹'), ...(selected.displayPath ? { path: selected.displayPath } : {}) });
        }
        catch (e) {
            if (g === generation.current && !ctrl.signal.aborted)
                setError(e instanceof Error ? e.message : tr('选择文件夹失败'));
        }
        finally {
            sdk.dispose();
            if (g === generation.current) {
                setPicking(false);
                pickController.current = undefined;
            }
        }
    }
    async function run() {
        if (!canRun || !destination || controller.current)
            return;
        const ctrl = new AbortController(), sdk = createArkmeSdk(), g = generation.current;
        controller.current = ctrl;
        setTaskPreview(preview);
        setBusy(true);
        setConfirm(false);
        setCount(0);
        setError('');
        try {
            const value = await sdk.exportRecords({ expectedAccountScope: scope, confirmed: true, orderKind: order, selection: state.selection, previewUid: preview!.previewUid!, destinationRef: destination.ref }, ctrl.signal, v => {
                if (g === generation.current && !ctrl.signal.aborted)
                    setCount(v.count);
            });
            if (g === generation.current && !ctrl.signal.aborted)
                setResult(value);
        }
        catch (e) {
            if (g === generation.current) {
                setTaskPreview(undefined);
                state.refresh();
                if (!ctrl.signal.aborted)
                    setError(e instanceof Error ? e.message : tr('导出失败，请重试'));
            }
        }
        finally {
            sdk.dispose();
            if (g === generation.current) {
                controller.current = undefined;
                setBusy(false);
            }
        }
    }
    const switchRange = (value: RecordExportRangeKind) => { setRange(value); setResult(undefined); setError(''); };
    return <div className="arkme-record-export" aria-busy={busy || loading}>
 <style>{exportCss}</style>
 <div className="arkme-export-intro"><p>{tr('将快记与原文件直接保存到本地文件夹。')}</p>{onRefresh && <button type="button" className="arkme-export-refresh" disabled={locked || loading} title={tr('刷新导出信息')} aria-label={tr('刷新导出信息')} onClick={onRefresh}><ArrowClockwise size={17} aria-hidden/></button>}</div>
 <div className="arkme-export-range-row"><div role="tablist" aria-label={tr('导出范围')} className="arkme-export-tabs">{(['incremental', 'dates', 'all'] as const).map((value, index) => <button type="button" role="tab" key={value} aria-selected={range === value} disabled={locked} onClick={() => switchRange(value)} onKeyDown={event => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const next = (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                    switchRange((['incremental', 'dates', 'all'] as const)[next]!);
                    (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
                }
            }}>{tr(value === 'incremental' ? '增量' : value === 'dates' ? '按日期' : '全部')}</button>)}</div>{range === 'dates' && <ArkmeExportDateRange value={dates} disabled={locked} onChange={setDates}/>}</div>
 {range === 'incremental' && <div className="arkme-export-incremental"><strong>{savedAt ? tr('上次成功保存：') + new Date(savedAt).toLocaleString(arkmeIntlLocale()) : preview?.baselineRequired ? tr('先建立完整备份') : state.loading ? tr('正在读取增量进度…') : state.error ? tr('增量进度读取失败') : tr('尚未建立完整备份')}</strong><p>{tr('自动保存新增、修改和移除的内容，包括补录的旧日期记录。增量不限次数，不占用全量导出额度。')}</p></div>}
 {range === 'dates' && <p className="arkme-export-notice">{tr('按记录显示日期筛选，包含结束日期全天。')}</p>}
 {range !== 'incremental' && <p className="arkme-export-notice">{tr(preview?.localSnapshotOnly ? '当前离线，将导出上次完整保存的本地副本。' : preview?.localReplica ? '复用本地备份，仅同步变化，不占用全量导出次数。' : '日期与全部导出共用原有云端导出额度；本地已有原文件会优先复用。')}</p>}
 {preview?.localSnapshotOnly && savedAt > 0 && <p className="arkme-export-notice">{tr('数据截至：')}{new Date(savedAt).toLocaleString(arkmeIntlLocale())}</p>}
 <div className="arkme-export-summary" aria-label={tr('备份内容')}>{[{ label: '条快记', value: preview?.previewUid ? preview.recordCount : undefined }, { label: '张图片', value: preview?.previewUid ? preview.imageCount : undefined }, { label: '段语音', value: preview?.previewUid ? preview.voiceCount : undefined }].map(v => <span className="arkme-export-summary-item" key={v.label}><strong>{v.value === undefined ? '—' : v.value.toLocaleString(arkmeIntlLocale())}</strong><span>{tr(v.label)}</span></span>)}</div>
 {preview?.countsPending && <p className="arkme-export-notice">{tr('以上为所选范围的本地已保存数量，完成同步后更新。')}</p>}
 {state.loading && <p className="arkme-export-notice" role="status">{tr('正在统计本次导出范围…')}</p>}
 {state.error && <p className="arkme-export-error" role="alert">{state.error}</p>}
 {preview?.baselineRequired && <p className="arkme-export-notice">{tr('请先在所选文件夹建立完整备份，再使用增量。')} <button type="button" className="arkme-settings-link" disabled={locked} onClick={() => switchRange('all')}>{tr('选择全部')}</button></p>}
 {preview && preview.folderSupported !== true && <p className="arkme-export-notice">{tr("当前服务尚未支持文件夹导出，请更新后重试。")}</p>}
    {preview && !preview.canExport && !preview.baselineRequired && <p className="arkme-export-notice" role="status">{preview.message || tr('当前暂不满足导出条件，请稍后重试。')}</p>}
 {preview?.previewUid && preview.recordCount + preview.removedCount === 0 && !preview.countsPending && <p className="arkme-export-notice">{tr('暂无新增或更新内容。')}</p>}
 <div className="arkme-export-options"><div className="arkme-export-option"><span>{tr('附件')}</span><label className="arkme-export-attachments"><input type="checkbox" checked={attachments} disabled={locked} onChange={event => { setAttachments(event.target.checked); setResult(undefined); }}/>{tr('包含图片、语音等原文件')}</label></div><div className="arkme-export-option"><span>{tr('备份格式')}</span><span className="arkme-export-format">Markdown / {tr('原文件')}</span></div><div className="arkme-export-option"><span>{tr('记录顺序')}</span><div className="arkme-export-order" role="radiogroup" aria-label={tr('记录顺序')}>{([1, 2] as const).map(value => <label key={value} className={order === value ? 'is-selected' : ''}><input type="radio" checked={order === value} name={`order-${scope}`} disabled={locked} onChange={() => setOrder(value)}/><span>{tr(value === 1 ? '从新到旧' : '从旧到新')}</span></label>)}</div></div></div>
 <p className="arkme-export-notice">{tr('不含隐私锁定内容。导出成功后自动保存增量进度。')}</p>
 {error && <p role="alert" className="arkme-export-error">{error}</p>}
 {busy && <div className="arkme-export-progress" role="status"><div><span>{tr('正在写入本地文件夹')}</span><span>{tr('已处理 {v0} 条', { v0: count })}</span></div><progress aria-label={tr('导出进度')} max={100} value={preview?.recordCount ? Math.min(97, count / (preview.localReplica ? Math.max(1, preview.newCount + preview.updatedCount) : preview.recordCount) * 100) : undefined}/></div>}
 {result ? <div className="arkme-export-result" role="status"><div className="arkme-export-result-title"><CheckCircle size={20} weight="fill" aria-hidden/><strong>{tr('已导出到本地文件夹')}</strong><span>{tr('共 {v0} 条快记', { v0: result.count })}</span></div><div className="arkme-export-file"><FolderOpen size={26} aria-hidden/><div><strong>{destination?.name}</strong><small>{tr('内容与原文件已保存，无需另行下载。')}</small></div><button type="button" className="arkme-export-primary" onClick={() => { const sdk = createArkmeSdk(); void sdk.openRecordExportDirectory(scope, result.directoryRef!).catch(e => setError(e.message)).finally(() => sdk.dispose()); }}>{tr('打开文件夹')}</button></div><button type="button" className="arkme-settings-link" onClick={() => { setResult(undefined); setTaskPreview(undefined); onRefresh?.(); }}>{tr('继续导出')}</button>{!result.quotaFinalized && <p className="arkme-export-notice">{tr('内容已保存，导出额度确认暂未完成，请勿重复发起云端全量导出。')}</p>}</div> : <div className="arkme-export-footer"><button type="button" className="arkme-export-folder" aria-label={tr(destination ? '更换导出文件夹' : '选择导出文件夹')} title={destination?.path || destination?.name || tr('选择文件夹')} disabled={locked} onClick={() => void pick()}><FolderOpen size={17} aria-hidden/><span>{picking ? tr('正在选择…') : destination?.name || tr('选择文件夹')}</span></button>{busy ? <button type="button" className="arkme-export-cancel" onClick={() => { controller.current?.abort(); setError(tr('导出已取消，已下载的原文件保留供重试。')); }}>{tr('取消导出')}</button> : <button type="button" className="arkme-export-primary" disabled={!canRun || locked} onClick={() => { if (range === 'incremental' || preview?.localReplica)
        void run();
    else
        setConfirm(true); }}><DownloadSimple size={16} aria-hidden/>{tr('导出到文件夹')}</button>}</div>}
 {confirm && <ArkmeConfirmDialog titleId="arkme-export-folder-confirm" title={tr('确认导出到所选文件夹？')} description={tr('将保存所选内容及原文件，成功后使用一次云端导出额度。取消或失败不扣次数。')} confirmLabel={tr('确认导出')} busyLabel={tr('正在导出…')} busy={false} error="" onClose={() => setConfirm(false)} onConfirm={() => void run()}/>}
 </div>;
}
