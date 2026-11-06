// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js';
import { dispatchArkmeHostOperation } from '../src/host-api.js';
import { createArkmeSdk } from '../src/sdk/index.js';
const transport = vi.hoisted(() => ({ call: undefined as undefined | ((...args: any[]) => Promise<any>), navigate: vi.fn() }));
vi.mock('../src/client/api.js', () => ({ callArkme: (...args: any[]) => transport.call!(...args) }));
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: transport.navigate } }));
import { ArkoReplyManager } from '../src/client/ArkoReplyManager.js';
const directory = process.env.ARKO_REPLY_E2E_DIR;
it.skipIf(!directory)('actual UI, SDK and Host use authenticated Go handlers, encrypted Mongo and real source owners', async () => {
    const settings = JSON.parse(await readFile(join(directory!, 'intelligent.json'), 'utf8'));
    for (const key of ['url'])
        expect(new URL(settings[key]).hostname).toBe('127.0.0.1');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const temporary = await mkdtemp(join(tmpdir(), 'arko reply e2e '));
    const chatOwner = JSON.parse(await readFile(join(directory!, 'chat.json'), 'utf8'));
    let userId = 11;
    const sessions = { async read() { return { userId, accessToken: settings[`token${userId}`], refreshToken: 'synthetic' }; }, async write() { }, async delete() { } };
    const config = { environment: 'test', authBaseUrl: settings.url, recordBaseUrl: settings.url, chatBaseUrl: chatOwner.url, botBaseUrl: settings.url, imBaseUrl: settings.url, webrtcBaseUrl: settings.url, worldBaseUrl: settings.url, relationBaseUrl: settings.url, intelligentBaseUrl: settings.url, audioBaseUrl: settings.url, routePath: '/arkme-self/api', requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: 'synthetic', fileStateDirectory: temporary } as ArkmeServiceConfig;
    const service = new ArkmeService(config, sessions, { async uniqueCode() { return 'synthetic-contract-signing-key'; } } as never, fetch);
    const dispatch = async (op: string, params: unknown, signal?: AbortSignal) => await dispatchArkmeHostOperation(service, op as never, params as never, undefined, undefined, undefined, undefined, signal);
    transport.call = dispatch;
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => { const r = JSON.parse(String(init?.body)); const value = await dispatch(r.operation, r.params, init?.signal ?? undefined); return new Response(JSON.stringify({ ok: true, value })); } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.startsWith(label))!;
    const click = async (label: string) => { await vi.waitFor(() => expect(button(label)).toBeDefined()); await act(async () => button(label).click()); };
    const input = async (text: string) => { await act(async () => { const field = host.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }); };
    try {
        const initial = await sdk.arkoReplyPrompts('test:11');
        expect(initial.items).toHaveLength(7);
        for (const item of initial.items) {
            const body = `Exact ${item.scene} 100%\n保留 🐱\n`;
            const saved = await sdk.saveArkoReplyPrompt({ scene: item.scene, expectedRevision: 0, baseOfficialRevision: item.officialRevision, body }, 'test:11');
            expect(saved.conflict).toBe(false);
            const frozen = await fetch(settings.url + '/api/v1/__test/frozen', { method: 'POST', headers: { Authorization: `Bearer ${settings.token11}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: item.scene }) }).then(r => r.json());
            expect(frozen.body).toBe(body);
            expect(frozen.user_revision).toBe(1);
        }
        await act(async () => root.render(<ArkoReplyManager accountScope="test:11" onClose={() => { }}/>));
        await vi.waitFor(() => expect(button('提示词')).toBeDefined());
        await click('提示词');
        await click('快记想法');
        expect(host.querySelector('textarea')!.value).toContain('Exact record_auto');
        const current = (await sdk.arkoReplyPrompts('test:11')).items.find(i => i.scene === 'record_auto')!;
        await sdk.saveArkoReplyPrompt({ scene: 'record_auto', expectedRevision: 1, baseOfficialRevision: current.officialRevision, body: 'other device' }, 'test:11');
        await input('保留本窗口输入');
        await click('保存修改');
        await vi.waitFor(() => expect(host.textContent).toContain('其他设备更新'));
        expect(host.querySelector('textarea')!.value).toBe('保留本窗口输入');
        await click('保存修改');
        await vi.waitFor(() => expect(host.textContent).toContain('已保存并在云端生效'));
        expect((await sdk.arkoReplyPrompts('test:11')).items.find(i => i.scene === 'record_auto')?.effectiveBody).toBe('保留本窗口输入');
        await sdk.arkoRepliesPage({ scene: 'all' }, 'test:11');
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="返回提示词列表"]')!.click());
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="返回回复管理"]')!.click());
        await click('全部回复');
        await vi.waitFor(() => expect(host.textContent).toContain('automatic reply'));
        expect(host.textContent).toContain('manual reply');
        const history = await sdk.arkoRepliesPage({ scene: 'all' }, 'test:11');
        expect(history.items).toHaveLength(4);
        expect(history.items.every(i => !!i.item.messageActionRef && i.item.sendAtMillis === 1712991000001)).toBe(true);
        expect(new Set(history.items.map(i => i.scene))).toEqual(new Set(['record_auto', 'record_mention', 'direct_mention', 'group_mention']));
        expect(history.items.find(i => i.scene === 'group_mention')?.source.displayName).toBe('闭环验收群');
        expect(history.items.find(i => i.scene === 'direct_mention')?.source.displayName).toBe('小林');
        expect(host.textContent).toContain('群聊公开回应 · 闭环验收群');
        expect(host.textContent).toContain('私聊主动回应 · 小林');
        await fetch(chatOwner.url + '/__test/leave', { method: 'POST' });
        expect((await sdk.arkoRepliesPage({ scene: 'all' }, 'test:11')).items).toHaveLength(2);
        userId = 12;
        const other = await sdk.arkoReplyPrompts('test:12');
        expect(other.items.every(i => i.revision === 0)).toBe(true);
        expect((await sdk.arkoRepliesPage({ scene: 'all' }, 'test:12')).items).toHaveLength(0);
        userId = 11;
        const selected = (await sdk.arkoReplyPrompts('test:11')).items.find(i => i.scene === 'record_auto')!;
        const reset = await sdk.resetArkoReplyPrompt({ scene: 'record_auto', expectedRevision: selected.revision, baseOfficialRevision: selected.officialRevision }, 'test:11');
        expect(reset.current.userBody).toBeNull();
        const receiver = (await sdk.arkoReplyPrompts('test:11')).items.find(i => i.scene === 'direct_receive')!;
        const restored = await sdk.saveArkoReplyPrompt({scene:'direct_receive',expectedRevision:receiver.revision,baseOfficialRevision:receiver.officialRevision,body:receiver.officialBody},'test:11');
        expect(restored.current.userBody).toBeNull();
        expect(restored.current.revision).toBe(receiver.revision+1);
    }
    finally {
        await act(async () => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
        service.dispose();
        await rm(temporary, { recursive: true, force: true });
    }
}, 30000);
