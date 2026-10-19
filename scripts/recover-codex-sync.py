#!/usr/bin/env python3
"""Explicit, single-session recovery. Dry-run by default; never changes Hook trust.

Migrate an inactive journal into an empty, authenticated desktop collector, retaining
source/task/event/ACK identities. Recover only the named session's user inputs and
task_complete final replies after its last captured event. No directory history scan.
"""
import argparse
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time

TABLES = ['connections', 'events', 'codex_installations', 'codex_tasks', 'codex_events',
          'codex_project_exclusions', 'codex_legacy_migrations', 'codex_queue_snapshots',
          'codex_cloud_sources', 'codex_cloud_tasks', 'codex_cloud_turns', 'codex_cloud_events',
          'codex_cloud_consent', 'codex_entry_accounts', 'codex_cloud_source_confirmations']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def regular(path):
    require(not path.is_symlink() and path.is_file(), 'Expected regular file: ' + str(path))
    return path


def read_json(path):
    return json.loads(regular(path).read_text())


def opened(path, writable=False):
    regular(path)
    db = sqlite3.connect(path.as_uri() + ('?mode=rw' if writable else '?mode=ro'), uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA trusted_schema=OFF')
    return db


def millis(stamp):
    return int(datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)


def redact(text):
    text = re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+', r'\1[REDACTED]', text)
    return re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+', r'\1[REDACTED]', text)


def recovered_events(path, session, after):
    """Allowlist records; never returns assistant commentary, tools or reasoning."""
    events, current, root, identified = {}, None, None, False
    for line in regular(path).open():
        row = json.loads(line)
        payload = row.get('payload', {})
        kind = row.get('type')
        if kind == 'session_meta':
            require(payload.get('id') == session, 'Rollout session mismatch')
            identified = True
        if kind in ('turn_context',) or kind == 'event_msg' and payload.get('type') == 'task_started':
            current = payload.get('turn_id')
            root = payload.get('root_turn_id', current)
        if not identified:
            continue
        at = millis(row['timestamp'])
        if at <= after:
            continue
        event_kind, text, turn = None, '', current
        if kind == 'response_item' and payload.get('type') == 'message' and payload.get('role') == 'user' and current == root:
            text = '\n'.join(item['text'] for item in payload.get('content', [])
                             if item.get('type') == 'input_text' and isinstance(item.get('text'), str))
            if not text:
                continue
            event_kind = 'UserPromptSubmit'
        elif kind == 'event_msg' and payload.get('type') == 'task_complete':
            turn = payload.get('turn_id')
            if payload.get('root_turn_id', turn) != turn:
                continue
            text = payload.get('last_agent_message')
            if not isinstance(text, str):
                continue
            event_kind = 'Stop'
        if not event_kind:
            continue
        require(isinstance(turn, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,160}', turn), 'Cannot identify recovered turn')
        key = (turn, event_kind)
        safe = redact(text)
        if key in events and event_kind == 'UserPromptSubmit':
            old = events[key]
            if safe != old['text']:
                old['text'] += '\n\n' + safe
            old['truncated'] = len(old['text']) > 65536
            old['text'] = old['text'][:65536]
        else:
            events[key] = dict(turn=turn, kind=event_kind, text=safe[:65536], at=at, truncated=len(safe) > 65536)
    require(identified, 'Missing session identity')
    return sorted(events.values(), key=lambda item: (item['at'], item['kind'] != 'UserPromptSubmit'))


def recover(args):
    source, target, rollout, audit = map(lambda p: Path(p).expanduser().absolute(), (args.source, args.target, args.rollout, args.audit))
    require(source != target and not source.is_symlink() and not target.is_symlink(), 'Invalid source/target')
    src = opened(source / 'journal.sqlite')
    target_read = opened(target / 'journal.sqlite')
    rows = src.execute('SELECT t.*,i.user_id,i.status FROM codex_tasks t JOIN codex_installations i ON i.id=t.installation_id WHERE t.session_id=?', (args.session,)).fetchall()
    require(len(rows) == 1, 'Session not uniquely bound')
    task = rows[0]
    require(task['user_id'] == args.owner and task['status'] == 'active' and not task['excluded'] and not task['deleted'], 'Task is not authorized for recovery')
    for table, column in [('connections', 'user_id'), ('codex_installations', 'user_id'), ('codex_cloud_sources', 'owner'), ('codex_cloud_consent', 'owner')]:
        require(not src.execute(f'SELECT 1 FROM {table} WHERE {column}<>?', (args.owner,)).fetchone(), 'Mixed-owner journal requires separate review')
    require(not src.execute('SELECT 1 FROM codex_project_exclusions WHERE installation_id=? AND project_key=?', (task['installation_id'], task['project_key'])).fetchone(), 'Project excluded')
    cloud = src.execute('SELECT c.id,s.id source_id,s.team FROM codex_cloud_tasks c JOIN codex_cloud_sources s ON s.id=c.source WHERE c.local_id=?', (task['id'],)).fetchall()
    require(len(cloud) == 1, 'Cloud identity is ambiguous')
    cutoff = src.execute('SELECT MAX(at) FROM codex_events WHERE task_id=?', (task['id'],)).fetchone()[0]
    require(cutoff is not None, 'No capture checkpoint')
    proposed = recovered_events(rollout, args.session, cutoff)
    existing = {(row['turn_id'], row['kind']) for row in src.execute('SELECT turn_id,kind FROM codex_events WHERE task_id=?', (task['id'],))}
    events = [row for row in proposed if (row['turn'], row['kind']) not in existing]
    plan = dict(owner=args.owner, session=args.session, localTask=task['id'], cloudTask=cloud[0]['id'], sourceId=cloud[0]['source_id'],
                cutoff=cutoff, recovered=dict(collections.Counter(e['kind'] for e in events)),
                firstAt=min((e['at'] for e in events), default=None), lastAt=max((e['at'] for e in events), default=None),
                skippedExisting=len(proposed)-len(events), rolloutSha256=hashlib.sha256(rollout.read_bytes()).hexdigest())
    if not args.apply:
        target_read.close(); src.close()
        return {**plan, 'mode': 'dry-run'}
    require(not audit.exists(), 'Recovery audit already exists; inspect outcome before retrying')
    now = int(time.time()*1000)
    active = read_json(target / 'active.json')
    require(active.get('userId') == args.owner and 0 <= now-active.get('at', 0) < 15000, 'Target is not running as expected owner')
    if (source / 'active.json').exists() or (source / 'active.json').is_symlink():
        old = read_json(source / 'active.json')
        require(now-old.get('at', 0) >= 15000, 'Source collector still running')
    folders = [row[0] for table in ('connections', 'codex_installations') for row in src.execute(f'SELECT id FROM {table}')]
    for folder in folders:
        require(re.fullmatch(r'[0-9a-f-]{36}', folder), 'Invalid connection folder')
        inbox = source / folder / 'inbox'
        require(not inbox.is_symlink() and (not inbox.exists() or not any(inbox.iterdir())), 'Source has pending capture files; drain before recovery')
        require(not (target / folder).exists(), 'Destination connection already exists')
    audit.mkdir(mode=0o700, parents=True)
    for name, db in [('source.sqlite', src), ('target-before.sqlite', target_read)]:
        backup = sqlite3.connect(audit / name); db.backup(backup); backup.close(); os.chmod(audit / name, 0o600)
    target_read.close()
    (audit / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2)); os.chmod(audit / 'plan.json', 0o600)
    for folder in folders:
        require(re.fullmatch(r'[0-9a-f-]{36}', folder), 'Invalid connection folder')
        destination = target / folder
        require(not destination.exists(), 'Destination connection already exists')
        destination.mkdir(mode=0o700); (destination / 'inbox').mkdir(mode=0o700)
        for name in ('control.json', 'claim.json'):
            origin = source / folder / name
            if origin.exists():
                shutil.copyfile(regular(origin), destination / name); os.chmod(destination / name, 0o600)
    dst = opened(target / 'journal.sqlite', True)
    try:
        dst.execute('PRAGMA foreign_keys=ON'); dst.execute('BEGIN IMMEDIATE')
        for table in TABLES:
            if table != 'codex_entry_accounts':
                require(dst.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0, 'Target journal must be empty: ' + table)
            columns = [r['name'] for r in src.execute(f'PRAGMA table_info({table})')]
            target_columns = {r['name'] for r in dst.execute(f'PRAGMA table_info({table})')}
            require(set(columns) <= target_columns, 'Incompatible target schema: ' + table)
            quoted = ','.join('"'+c+'"' for c in columns)
            insert = 'INSERT OR IGNORE' if table == 'codex_entry_accounts' else 'INSERT'
            dst.executemany(f'{insert} INTO {table} ({quoted}) VALUES ({",".join("?" for _ in columns)})',
                            [tuple(row) for row in src.execute(f'SELECT {quoted} FROM {table}')])
        for event in events:
            dst.execute('INSERT INTO codex_events(task_id,turn_id,kind,text,at,truncated) VALUES(?,?,?,?,?,?)',
                        (task['id'], event['turn'], event['kind'], event['text'], event['at'], int(event['truncated'])))
        if events:
            latest = max(e['at'] for e in events)
            dst.execute('UPDATE codex_tasks SET updated_at=MAX(updated_at,?) WHERE id=?', (latest, task['id']))
            dst.execute('UPDATE codex_installations SET updated_at=MAX(updated_at,?) WHERE id=?', (latest, task['installation_id']))
        require(not dst.execute('PRAGMA foreign_key_check').fetchall(), 'Recovery violates journal integrity')
        require(read_json(target / 'active.json').get('userId') == args.owner, 'Account changed during recovery')
        dst.commit()
        receipt = {**plan, 'mode': 'applied', 'at': int(time.time()*1000), 'hooksChanged': False}
        (audit / 'applied.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)); os.chmod(audit / 'applied.json', 0o600)
        return receipt
    except Exception:
        dst.rollback()
        raise
    finally:
        dst.close(); src.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'target', 'session', 'rollout', 'audit'):
        parser.add_argument('--'+name, required=True)
    parser.add_argument('--owner', type=int, required=True)
    parser.add_argument('--apply', action='store_true')
    print(json.dumps(recover(parser.parse_args()), ensure_ascii=False, indent=2))
