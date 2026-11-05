// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArkmeRecordExportPanel } from '../src/client/ArkmeRecordExportPanel.js';
const mock = vi.hoisted(() => ({ run: vi.fn(), dispose: vi.fn(), preview: vi.fn(), pick: vi.fn(), open: vi.fn() }));
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ exportRecords: mock.run, dispose: mock.dispose, previewRecordExport: mock.preview, pickRecordExportDirectory: mock.pick, openRecordExportDirectory: mock.open }) }));
let root: Root, host: HTMLDivElement;
const preflight = { accountScope: 'test:11', canExport: true, recordCount: 0, imageCount: 0, voiceCount: 0, message: '', latestAtMillis: 0, rangeExportV2: { chainVersion: 1, savedAtMillis: 1000 } };
const preview = { accountScope: 'test:11', supported: true, folderSupported: true, canExport: true, baselineRequired: false, recordCount: 2, imageCount: 1, voiceCount: 0, newCount: 1, updatedCount: 1, removedCount: 0, chainVersion: 1, savedAtMillis: 1000, previewUid: 'plan', selectionFingerprint: 'a'.repeat(64) };
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(501); });
beforeEach(() => { vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); for (const fn of Object.values(mock))
    fn.mockReset(); mock.preview.mockResolvedValue(preview); mock.pick.mockResolvedValue({ accountScope: 'test:11', canceled: false, destinationRef: 'selected', displayName: '备份目录' }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
it('always exposes three tabs and defaults to incremental before any baseline exists', async () => { await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>)); expect([...host.querySelectorAll('[role=tab]')].map(b => b.textContent)).toEqual(['增量导出', '按日期导出', '全部导出']); expect(button('增量导出').getAttribute('aria-selected')).toBe('true'); expect(host.querySelector('select')).toBeNull(); expect(button('导出到文件夹').disabled).toBe(true); });
it('opens a calendar only after selecting dates and clicking the date control', async () => { await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>)); await act(async () => button('按日期导出').click()); expect(document.querySelector('[aria-label="导出日期范围"]')).toBeNull(); await act(async () => (host.querySelector('[aria-label="选择导出日期"]') as HTMLButtonElement).click()); expect(document.querySelector('[role=dialog]')).not.toBeNull(); await act(async () => button('上月').click()); await act(async () => button('确定').click()); expect(document.querySelector('[role=dialog]')).toBeNull(); expect(host.querySelector('input[type=date]')).toBeNull(); await settle(); expect(mock.preview.mock.calls.at(-1)?.[1].mode).toBe('dates'); });
it('writes directly to a selected folder and never offers a ZIP or manual saved confirmation', async () => { mock.run.mockResolvedValue({ accountScope: 'test:11', kind: 'directory', directoryRef: 'selected', fileRef: '', fileName: '内容.md', size: 100, count: 2, quotaFinalized: true, savedAtMillis: 2000 }); await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>)); await act(async () => button('选择文件夹').click()); await settle(); await act(async () => button('导出到文件夹').click()); expect(mock.run).toHaveBeenCalledWith(expect.objectContaining({ destinationRef: 'selected', selection: expect.objectContaining({ mode: 'incremental' }) }), expect.any(AbortSignal), expect.any(Function)); expect(host.textContent).toContain('已导出到本地文件夹'); expect(host.textContent).not.toContain('我已保存'); expect(host.querySelector('a[download]')).toBeNull(); mock.open.mockResolvedValue(undefined); await act(async () => button('打开文件夹').click()); expect(mock.open).toHaveBeenCalledWith('test:11', 'selected'); });
it('keeps full/date quota messages out of incremental and clears indefinite loading on failure', async () => { mock.preview.mockRejectedValue(new Error('网络暂不可用')); await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={{ ...preflight, rangeExportV2: { chainVersion: 0, savedAtMillis: 0 } }}/>)); await settle(); expect(host.textContent).toContain('增量进度读取失败'); expect(host.textContent).not.toContain('正在读取增量进度…'); expect(host.textContent).toContain('网络暂不可用'); expect(host.textContent).toContain('增量不限次数'); });
it('requires a complete backup in the selected folder and offers the full tab without silently starting it', async () => { mock.preview.mockResolvedValue({ ...preview, canExport: false, baselineRequired: true, previewUid: undefined, chainVersion: 0, savedAtMillis: 0 }); await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={{ ...preflight, rangeExportV2: { chainVersion: 0, savedAtMillis: 0 } }}/>)); await settle(); expect(host.textContent).toContain('先建立完整备份'); await act(async () => button('选择全部').click()); expect(button('全部导出').getAttribute('aria-selected')).toBe('true'); expect(mock.run).not.toHaveBeenCalled(); });
it('drops directory selection and aborts an active export on account change', async () => { let signal!: AbortSignal; mock.run.mockImplementation((_v, s) => { signal = s; return new Promise(() => { }); }); await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>)); await act(async () => button('选择文件夹').click()); await settle(); await act(async () => button('导出到文件夹').click()); await act(async () => root.render(<ArkmeRecordExportPanel scope="test:12" preflight={undefined}/>)); expect(signal.aborted).toBe(true); expect(host.textContent).not.toContain('备份目录'); expect(button('导出到文件夹').disabled).toBe(true); });

it('retains the confirmed counts while writing instead of flashing empty statistics',async()=>{
 mock.run.mockImplementation(()=>new Promise(()=>{}));await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));await act(async()=>button('选择文件夹').click());await settle();await act(async()=>button('导出到文件夹').click());expect(host.querySelector('.arkme-export-summary')?.textContent).toContain('2条快记');expect(host.querySelector('.arkme-export-summary')?.textContent).not.toContain('—');
})

it('keeps the selected folder next to the export action with its complete local location available',async()=>{
 mock.pick.mockResolvedValue({accountScope:'test:11',canceled:false,destinationRef:'selected',displayName:'一个很长的备份文件夹名称',displayPath:'/本机目录/一个很长的备份文件夹名称'});
 await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));await act(async()=>button('选择文件夹').click());await settle();
 const folder=host.querySelector('[aria-label="更换导出文件夹"]') as HTMLButtonElement;
 expect(folder.title).toBe('/本机目录/一个很长的备份文件夹名称');expect(folder.parentElement).toBe(button('导出到文件夹').parentElement);expect(host.querySelector('.arkme-export-options')?.contains(folder)).toBe(false);expect(host.querySelectorAll('[aria-label="更换导出文件夹"]')).toHaveLength(1);expect(host.querySelector('.arkme-export-summary')?.textContent).toBe('2条快记1张图片0段语音');
});

it('uses a newly prepared plan after a failed export instead of retrying the stale confirmation',async()=>{
 let plan=0;let rejectRun!:(e:Error)=>void;mock.preview.mockImplementation(async()=>({...preview,previewUid:'plan-'+(++plan)}));mock.run.mockImplementation(()=>new Promise((_resolve,reject)=>{rejectRun=reject}));
 await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));await act(async()=>button('选择文件夹').click());await settle();await act(async()=>button('导出到文件夹').click());const first=mock.run.mock.calls[0][0].previewUid;await act(async()=>rejectRun(new Error('temporary failure')));await settle();await act(async()=>button('导出到文件夹').click());expect(plan).toBeGreaterThan(1);expect(mock.run.mock.calls[1][0].previewUid).not.toBe(first);expect(mock.run.mock.calls[1][0].previewUid).toBe('plan-'+plan);
});
it('keeps controls locked while cancellation is waiting for the active operation to settle',async()=>{
 let rejectRun!:(e:Error)=>void;mock.run.mockImplementation(()=>new Promise((_resolve,reject)=>{rejectRun=reject}));await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));await act(async()=>button('选择文件夹').click());await settle();await act(async()=>button('导出到文件夹').click());await act(async()=>button('取消导出').click());expect(button('全部导出').disabled).toBe(true);await act(async()=>rejectRun(new Error('canceled')));await settle();expect(button('全部导出').disabled).toBe(false);
});

it('requests a directory preview immediately and retains display counts while revalidating a folder or returning tab', async () => {
 await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));
 expect(mock.preview).toHaveBeenCalledTimes(1);
 expect(mock.preview.mock.calls[0][5]).toEqual({directory:true,refresh:false});
 await act(async()=>button('全部导出').click());
 await act(async()=>button('增量导出').click());
 let resolve!: (p: typeof preview)=>void;
 mock.preview.mockImplementation(()=>new Promise(r=>{resolve=r}));
 await act(async()=>button('选择文件夹').click());
 expect(host.querySelector('.arkme-export-summary')?.textContent).toBe('2条快记1张图片0段语音');
 expect(button('导出到文件夹').disabled).toBe(true);
 await act(async()=>resolve(preview));
 expect(button('导出到文件夹').disabled).toBe(false);
});
it('explicit refresh bypasses prepared plans and an old account cannot repaint the new account',async()=>{
 const refresh=vi.fn();await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight} onRefresh={refresh}/>));
 await act(async()=> (host.querySelector('[aria-label="刷新导出信息"]') as HTMLButtonElement).click());
 expect(mock.preview.mock.calls.at(-1)?.[5]).toEqual({directory:true,refresh:true});expect(refresh).toHaveBeenCalledTimes(1);
 let resolve!:(p:typeof preview)=>void;mock.preview.mockImplementation(()=>new Promise(r=>{resolve=r}));
 await act(async()=>button('全部导出').click());
 await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:12" preflight={undefined}/>));
 await act(async()=>resolve(preview));
 expect(host.querySelector('.arkme-export-summary')?.textContent).not.toContain('2条快记');
});

it('shows actual phases without invented percentages for local repacks and deletion-only syncs',async()=>{
 mock.preview.mockResolvedValue({...preview,recordCount:0,newCount:0,updatedCount:0,removedCount:2});
 let notify!:(v:{count:number;phase?:string})=>void;
 let resolve!:(v:unknown)=>void;
 mock.run.mockImplementation((_o,_s,p)=>{notify=p;return new Promise(r=>{resolve=r})});
 await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));await act(async()=>button('选择文件夹').click());await act(async()=>button('导出到文件夹').click());
 expect(host.textContent).toContain('正在准备导出');
 for(const [phase,label] of [['syncing','正在同步快记和原文件'],['writing','正在生成并校验备份文件'],['confirming','正在确认备份已保存']]){
  await act(async()=>notify({count:0,phase}));expect(host.textContent).toContain(label);
  expect(host.querySelector('progress')?.hasAttribute('value')).toBe(false);
  expect(host.textContent).not.toContain('已导出到本地文件夹');
 }
 await act(async()=>resolve({accountScope:'test:11',kind:'directory',directoryRef:'selected',fileRef:'',fileName:'内容.md',size:10,count:0,quotaFinalized:true}));
 expect(host.querySelector('progress')).toBeNull();expect(host.textContent).toContain('共 0 条快记');
});
it('reports cancellation as pending until the request settles without claiming owner cleanup completed',async()=>{
 let reject!:(e:Error)=>void;mock.run.mockImplementation(()=>new Promise((_r,j)=>{reject=j}));
 await act(async()=>root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));await act(async()=>button('选择文件夹').click());await act(async()=>button('导出到文件夹').click());
 await act(async()=>button('取消导出').click());expect(host.textContent).toContain('正在取消导出');expect(button('取消导出').disabled).toBe(true);expect(host.textContent).not.toContain('取消请求已发出');
 await act(async()=>reject(new Error('aborted')));expect(host.textContent).toContain('取消请求已发出，已保存内容保留');expect(host.querySelector('progress')).toBeNull();
});

it('exposes clearly named range tabs and keeps keyboard focus with the selected range', async () => {
 await act(async () => root.render(<ArkmeRecordExportPanel scope="test:11" preflight={preflight}/>));
 const tabs = host.querySelector('[role="tablist"][aria-label="导出范围"]')!;
 expect(tabs.previousElementSibling?.textContent).toBe('导出范围');
 const incremental = button('增量导出');
 incremental.focus();
 await act(async () => incremental.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true})));
 expect(button('按日期导出').getAttribute('aria-selected')).toBe('true');
 expect(document.activeElement).toBe(button('按日期导出'));
 await act(async () => button('按日期导出').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft',bubbles:true})));
 expect(incremental.getAttribute('aria-selected')).toBe('true');
 expect(document.activeElement).toBe(incremental);
});
