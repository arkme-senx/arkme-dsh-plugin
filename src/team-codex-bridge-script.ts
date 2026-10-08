import { TEAM_CODEX_MACHINE_SCRIPT } from './team-codex-machine-script.js'
/** Installed only in the plugin's private local data directory. Never reads a Codex transcript. */
export const TEAM_CODEX_BRIDGE_SCRIPT = String.raw`#!/usr/bin/env python3
import argparse, hashlib, json, os, re, shlex, sys, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EVENTS = ('UserPromptSubmit', 'Stop', 'Interrupt')

def read(path, limit=524288):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('Invalid local bridge file')
    return json.loads(path.read_text(encoding='utf-8'))

def write(path, value):
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with os.fdopen(os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(str(tmp), str(path))

def live(control):
    active = read(ROOT / 'active.json')
    return active.get('userId') == control['userId'] and 0 <= time.time()*1000-active.get('at', 0) < 15000

def connect(folder, args):
    control = read(folder / 'control.json')
    session = args.session_id or os.environ.get('CODEX_THREAD_ID', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,160}', session):
        raise ValueError('Cannot identify this task. Supply its exact --session-id; do not scan other chats.')
    if control['status'] != 'pending' or time.time()*1000 > control['expiresAt'] or not live(control):
        raise ValueError('Connection expired, inactive, or already used. Create a new invitation in Arkme.')
    claim_path = folder / 'claim.json'
    claim = {'sessionId': session, 'title': args.title[:160], 'at': int(time.time()*1000)}
    if claim_path.exists():
        if read(claim_path)['sessionId'] != session:
            raise ValueError('This invitation is already bound to another task.')
    else:
        with os.fdopen(os.open(str(claim_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as f:
            json.dump(claim, f)
    codex_dir = Path(os.environ.get('CODEX_HOME') or str(Path.home() / '.codex')).expanduser()
    if codex_dir.is_symlink():
        raise ValueError('Review the Codex config directory symlink manually first.')
    codex_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    hooks_path = codex_dir / 'hooks.json'
    original = hooks_path.read_bytes() if hooks_path.exists() and not hooks_path.is_symlink() else None
    config = read(hooks_path) if hooks_path.exists() else {}
    hooks = config.setdefault('hooks', {})
    command = ' '.join(shlex.quote(v) for v in (sys.executable, str(Path(__file__).resolve()), 'record'))
    for event in EVENTS:
        groups = hooks.setdefault(event, [])
        if not isinstance(groups, list):
            raise ValueError('Existing hook configuration needs manual review.')
        if not any(h.get('command') == command for g in groups for h in g.get('hooks', [])):
            groups.append({'hooks': [{'type':'command', 'command':command, 'timeout':1}]})
    if original is not None:
        backup = codex_dir / ('hooks.json.arkme-backup-' + uuid.uuid4().hex)
        with os.fdopen(os.open(str(backup), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f:
            f.write(original)
        # Do not overwrite concurrent edits made during enrollment.
        if hooks_path.read_bytes() != original:
            raise ValueError('Hooks changed during setup. Please retry.')
    write(hooks_path, config)
    print('Arkme local sync configured for this task only. Review and trust the new hooks in Codex; resume this task if needed. No trust settings were changed. Arkme shows connected only after receiving a real hook event.')

def redact(text):
    text = re.sub(r'(?i)\bBearer\s+\S+', 'Bearer [REDACTED]', text)
    text = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b', '[REDACTED]', text)
    text = re.sub(r'(?im)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*["\x27]?[^\s"\x27,;]+', r'\1=[REDACTED]', text)
    return re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----', '[REDACTED PRIVATE KEY]', text)

def record(folder, event):
    # Fail open for Codex, closed for collection. Never emit model instructions or blocking decisions.
    claim = read(folder / 'claim.json')
    if event.get('session_id') != claim['sessionId']: return
    control = read(folder / 'control.json')
    if control['status'] not in ('pending', 'active') or not live(control): return
    if control['status'] == 'pending' and time.time()*1000 > control['expiresAt']: return
    kind = event.get('hook_event_name')
    turn = event.get('turn_id')
    if kind not in EVENTS or not isinstance(turn, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', turn): return
    value = event.get('prompt') if kind == 'UserPromptSubmit' else event.get('last_assistant_message') if kind == 'Stop' else ''
    value = value if isinstance(value, str) else ''
    safe = redact(value)
    record = {'version':1, 'sessionId':claim['sessionId'], 'turnId':turn, 'kind':kind,
              'generation':control['generation'], 'at':int(time.time()*1000), 'text':safe[:65536], 'truncated':len(safe)>65536}
    inbox = folder / 'inbox'
    if sum(1 for _ in inbox.iterdir()) >= 1000: return
    # Immutable spool files avoid overwriting an event while the host acknowledges it.
    # Journal deduplication uses connection + turn + kind, not this transport ID.
    identity = hashlib.sha256((turn + ':' + kind + ':' + uuid.uuid4().hex).encode()).hexdigest()
    write(inbox / (identity + '.json'), record)

def main():
    parser = argparse.ArgumentParser(description='Arkme local-only Codex task bridge')
    parser.add_argument('mode', choices=['connect', 'record'])
    parser.add_argument('connection', nargs='?', default='')
    parser.add_argument('--session-id', default='')
    parser.add_argument('--title', default='')
    args = parser.parse_args()
    if args.mode == 'record':
        raw = sys.stdin.buffer.read(524289)
        if len(raw) > 524288: return
        event = json.loads(raw)
        for folder in ROOT.iterdir():
            if re.fullmatch(r'[0-9a-f-]{36}', folder.name) and folder.is_dir() and not folder.is_symlink():
                try: record(folder, event)
                except Exception: pass
        return
    if not re.fullmatch(r'[0-9a-f-]{36}', args.connection): raise ValueError('Invalid connection')
    folder = ROOT / args.connection
    if folder.is_symlink() or not folder.is_dir(): raise ValueError('Unknown connection')
    connect(folder, args)

${TEAM_CODEX_MACHINE_SCRIPT}

if __name__ == '__main__':
    try: main()
    except Exception:
        if len(sys.argv) > 1 and sys.argv[1] in ('connect', 'enroll'):
            print('Arkme setup could not finish. Check the invitation, active Arkme account and existing hooks file; no hook trust was granted.', file=sys.stderr)
            sys.exit(1)
    finally:
        if len(sys.argv) > 1 and sys.argv[1] in ('record', 'capture'): print('{}')
`
