/** Appended to the legacy helper. A DIFFERENT hook command requires review before global collection. */
export const TEAM_CODEX_MACHINE_SCRIPT = String.raw`

def home_key():
    path = Path(os.environ.get('CODEX_HOME') or str(Path.home() / '.codex')).expanduser()
    if path.is_symlink(): raise ValueError('Review Codex config directory symlink first')
    return path, hashlib.sha256(str(path.resolve()).encode()).hexdigest()

def chatgpt_project_metadata(cwd, config):
    # The project ID is in the local mirror path, not in a conversation/transcript.
    mirrors = config.resolve() / '.chatgpt-projects'
    try: parts = cwd.relative_to(mirrors).parts
    except ValueError: return None
    if not parts or not re.fullmatch(r'g-p-[A-Za-z0-9_-]{1,128}', parts[0]): return None
    project_id = parts[0]
    name = project_id
    # Codex generates these first three lines. Read only the fixed metadata header,
    # never the project instructions that follow it or synced reference files.
    import stat
    try:
        path = mirrors / project_id / 'AGENTS.md'
        if path.is_symlink(): raise ValueError('Symlinked project metadata')
        fd = os.open(str(path), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(fd, 'rb', buffering=0) as f:
            if not stat.S_ISREG(os.fstat(f.fileno()).st_mode): raise ValueError('Invalid project metadata')
            heading = f.readline(2048).rstrip(b'\r\n')
            separator = f.readline(2048).rstrip(b'\r\n')
            label = f.readline(2048).decode('utf-8').rstrip('\r\n')
        match = re.fullmatch(r'This directory is a local mirror of the ChatGPT project “([^\r\n]{1,512})”\.', label)
        if heading == b'# ChatGPT project context' and separator == b'' and match:
            candidate = match.group(1).strip()
            if candidate and not any(ord(c) < 32 or ord(c) == 127 for c in candidate): name = candidate
    except (OSError, ValueError, UnicodeError):
        pass  # Keep the stable project ID even when its display name is unavailable.
    return {'key':hashlib.sha256(('chatgpt-project:' + project_id).encode()).hexdigest(), 'name':name}

def project_metadata(raw):
    # Read only project/Git identity metadata; never execute repository hooks/config or read source files.
    if not isinstance(raw, str) or not os.path.isabs(raw) or len(raw) > 4096:
        return {'key':'unknown', 'name':'', 'cwd':'', 'branch':'', 'worktree':''}
    cwd = Path(raw).resolve()
    result = {'key':hashlib.sha256(('dir:' + str(cwd)).encode()).hexdigest(),
              'name':cwd.name, 'cwd':str(cwd), 'branch':'', 'worktree':''}
    config, _ = home_key()
    project = chatgpt_project_metadata(cwd, config)
    if project:
        result.update(project)
    # Projectless Codex chats live in per-task directories; keep actual project mirrors above.
    elif cwd == Path.home() or cwd == Path('/') or cwd == config.resolve() or config.resolve() in cwd.parents:
        result.update(key='unknown', name='')
    def prefix(path, limit):
        with path.open('r', encoding='utf-8', errors='replace') as f: return f.read(limit).strip()
    for folder in [cwd, *cwd.parents][:64]:
        marker = folder / '.git'
        if not marker.exists(): continue
        try:
            git = marker
            if marker.is_file():
                line = prefix(marker, 4096)
                if not line.startswith('gitdir: '): break
                git = (folder / line[8:]).resolve()
            common = git
            if (git / 'commondir').is_file():
                common = (git / prefix(git / 'commondir', 4096)).resolve()
            try: head = prefix(git / 'HEAD', 256)
            except OSError: head = ''
            branch = head[16:] if head.startswith('ref: refs/heads/') else head[:12]
            result.update(branch=branch, worktree=str(folder))
            if not project:
                result.update(key=hashlib.sha256(('git:' + str(common.resolve())).encode()).hexdigest(),
                              name=common.parent.name if common.name == '.git' else common.name)
        except (OSError, ValueError):
            # Stable repository identity even if HEAD cannot be read.
            result.update(worktree=str(folder))
            if not project:
                result.update(key=hashlib.sha256(('dir:' + str(folder)).encode()).hexdigest(), name=folder.name)
        break
    return result

def enroll_machine(folder, args):
    control = read(folder / 'control.json')
    if control.get('version') != 2 or not live(control): raise ValueError('Inactive invitation')
    config_dir, key = home_key()
    claim_path = folder / 'claim.json'
    previous = read(claim_path) if claim_path.exists() else None
    if control['status'] not in ('pending', 'active'):
        raise ValueError('Resume or create a new connection in Arkme first')
    if previous and previous.get('homeKey') != key: raise ValueError('Bound to a different Codex configuration')
    if not previous and time.time()*1000 > control['expiresAt']: raise ValueError('Invitation expired')
    config_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    hooks_path = config_dir / 'hooks.json'
    if hooks_path.is_symlink(): raise ValueError('Review hooks symlink first')
    original = hooks_path.read_bytes() if hooks_path.exists() else None
    config = read(hooks_path) if original is not None else {}
    hooks = config.setdefault('hooks', {})
    if not isinstance(hooks, dict): raise ValueError('Invalid hooks configuration')
    command = ' '.join(shlex.quote(v) for v in (sys.executable, str(Path(__file__).resolve()), 'capture', folder.name, '--home-key', key))
    for event in EVENTS:
        groups = hooks.setdefault(event, [])
        if not isinstance(groups, list): raise ValueError('Invalid hook groups')
        if not any(h.get('command') == command for g in groups for h in g.get('hooks', [])):
            groups.append({'hooks':[{'type':'command', 'command':command, 'timeout':1}]})
    # Bind the installation, not CODEX_THREAD_ID. Retries in any task of this Codex home are safe.
    if not previous:
        import socket
        with os.fdopen(os.open(str(claim_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as f:
            json.dump({'version':2, 'homeKey':key, 'name':socket.gethostname()[:100], 'at':int(time.time()*1000)}, f)
    if original is not None:
        backup = config_dir / ('hooks.json.arkme-backup-' + uuid.uuid4().hex)
        with os.fdopen(os.open(str(backup), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f: f.write(original)
    if hooks_path.is_symlink() or (hooks_path.read_bytes() if hooks_path.exists() else None) != original:
        raise ValueError('Hooks changed during setup; retry without overwriting other edits')
    write(hooks_path, config)
    print('Arkme configured for ALL future local tasks using this Codex configuration, across projects. Review and trust the new capture hooks; resume/restart open sessions if needed. No history scan, cloud upload, or trust bypass. Keep Arkme running under the bound account. Connected status requires a real event.')

def capture_machine(folder, args):
    control = read(folder / 'control.json')
    claim = read(folder / 'claim.json')
    if control.get('version') != 2 or claim.get('version') != 2 or claim.get('homeKey') != args.home_key: return
    if control['status'] not in ('pending', 'active') or not live(control): return
    if claim['at'] > control['expiresAt']: return
    raw = sys.stdin.buffer.read(524289)
    if len(raw) > 524288: return
    event = json.loads(raw)
    session, turn, kind = event.get('session_id'), event.get('turn_id'), event.get('hook_event_name')
    if not isinstance(session, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,160}', session): return
    if not isinstance(turn, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', turn) or kind not in EVENTS: return
    # Hooks emitted for subagents must not overwrite the parent's user-facing final answer.
    if event.get('agent_id') or event.get('subagent_id'): return
    if session in control.get('excludedSessions', []): return
    project = project_metadata(event.get('cwd'))
    if project['key'] in control.get('excludedProjects', []): return
    value = event.get('prompt') if kind == 'UserPromptSubmit' else event.get('last_assistant_message') if kind == 'Stop' else ''
    safe = redact(value if isinstance(value, str) else '')
    inbox = folder / 'inbox'
    if sum(1 for _ in inbox.iterdir()) >= 1000: return
    record = {'version':2, 'homeKey':args.home_key, 'sessionId':session, 'turnId':turn, 'kind':kind,
              'generation':control['generation'], 'at':int(time.time()*1000), 'text':safe[:65536],
              'truncated':len(safe)>65536, 'project':project}
    identity = hashlib.sha256((session + ':' + turn + ':' + kind + ':' + uuid.uuid4().hex).encode()).hexdigest()
    write(inbox / (identity + '.json'), record)

legacy_main = main
def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('enroll', 'capture'): return legacy_main()
    parser = argparse.ArgumentParser(description='Arkme local Codex installation bridge')
    parser.add_argument('mode', choices=['enroll','capture'])
    parser.add_argument('connection')
    parser.add_argument('--home-key', default='')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f-]{36}', args.connection): raise ValueError('Invalid installation')
    folder = ROOT / args.connection
    if folder.is_symlink() or not folder.is_dir(): raise ValueError('Unknown installation')
    if args.mode == 'enroll': enroll_machine(folder, args)
    else: capture_machine(folder, args)
`
