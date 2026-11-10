#!/usr/bin/env python3
"""Run the opt-in local recording circuit without a live account or supplier.

Requires task-only Audio config, loopback MySQL DSN in
MANAGED_AI_TEST_MYSQL_DSN and an explicit Intelligent config. No deployment or
source configuration is changed. Checkouts and evidence paths are arguments.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
for name in ('intelligent', 'audio', 'evidence', 'config'):
    parser.add_argument('--' + name, type=Path, required=True)
args = parser.parse_args()
plugin = Path(__file__).resolve().parents[1]
run = args.evidence.resolve() / ('owner-circuit-' + str(time.time_ns()))
run.mkdir(parents=True)
env = {**os.environ, 'MODEL_EXECUTION_CIRCUIT_DIR': str(run),
       'JOTMO_INTELLIGENT_CONFIG_PATH': str(args.config.resolve())}
children = []
streams = []


def command(argv, cwd, log):
    with (run / log).open('w') as output:
        subprocess.run(argv, cwd=cwd, env=env, stdout=output,
                       stderr=subprocess.STDOUT, check=True)


def start(binary, cwd, name, test):
    output = (run / (name + '.log')).open('w')
    streams.append(output)
    process = subprocess.Popen([str(binary), '-test.run', '^' + test + '$',
                                '-test.v', '-test.timeout=10m'],
                               cwd=cwd, env=env, stdout=output,
                               stderr=subprocess.STDOUT)
    children.append((name, process))


def ready(file):
    deadline = time.monotonic() + 45
    while not (run / file).exists():
        failed = [(name, proc.returncode) for name, proc in children
                  if proc.poll() is not None]
        if failed or time.monotonic() >= deadline:
            raise RuntimeError('fixture not ready: ' + file + '; ' + repr(failed))
        time.sleep(.025)


try:
    builds = [('gateway', args.intelligent, './internal/managedai/runtime', '.test'),
              ('intelligent', args.intelligent, './gin/api', ''),
              ('audio', args.audio, './gin/api', ''),
              ('worker', args.audio, './task/summary', '')]
    binaries = {}
    for name, checkout, package, suffix in builds:
        binary = run / (name + suffix)
        command(['go', 'test', '-c', '-o', str(binary), package], checkout,
                name + '-build.log')
        binaries[name] = binary
    start(binaries['gateway'], args.intelligent / 'internal/managedai/runtime',
          'gateway', 'TestModelExecutionGatewayCircuitFixture')
    ready('gateway.json')
    start(binaries['intelligent'], args.intelligent, 'intelligent',
          'TestModelExecutionIntelligentCircuitFixture')
    ready('intelligent.json')
    start(binaries['audio'], args.audio, 'audio',
          'TestModelExecutionAudioCircuitFixture')
    start(binaries['worker'], args.audio, 'worker',
          'TestModelExecutionWorkerCircuitFixture')
    for file in ('audio.json', 'worker-ready', 'gateway-configured'):
        ready(file)
    command(['pnpm', 'exec', 'vitest', 'run',
             'tests/model-execution-owner-circuit.test.tsx'], plugin, 'frontend.log')
finally:
    (run / 'finish').write_text('done')
    for name, process in children:
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
    for stream in streams:
        stream.close()

codes = {name: process.returncode for name, process in children}
assert all(code == 0 for code in codes.values()), codes
assert (run / 'frontend-result.json').is_file()
(run / 'result.json').write_text(json.dumps({'passed': True, 'processes': codes},
                                         indent=2) + '\n')
print(json.dumps({'passed': True, 'evidence': str(run)}))
