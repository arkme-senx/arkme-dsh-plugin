#!/usr/bin/env python3
"""Opt-in local fixture -> installed DSH -> real BYOK -> usage/points checks.

Credentials are read from a private local profile, never argv or artifacts.
Requires account-model-dsh-acceptance.mjs and the Go acceptance bridge.
"""
import argparse
from datetime import datetime, timedelta
from decimal import Decimal
import json
import ssl
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser()
for name in ("bridge", "secrets", "dsh-ready", "commands", "evidence"):
    parser.add_argument("--" + name, type=Path, required=True)
args = parser.parse_args()
args.evidence.mkdir(parents=True, exist_ok=True)
bridge = json.loads(args.bridge.read_text())
assert urllib.parse.urlparse(bridge["origin"]).hostname == "127.0.0.1"
assert args.secrets.stat().st_mode & 0o077 == 0, "private credential profile required"
secrets = json.loads(args.secrets.read_text())
tls = ssl.create_default_context(cafile=bridge["caFile"]) if bridge.get("caFile") else None


def request(path, body, token=None, headers=None, expected=200):
    req = urllib.request.Request(
        bridge["origin"] + path, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + (token or bridge["token"]),
                 "Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=100, context=tls) as response:
            status, data = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, data = error.code, json.load(error)
    if expected is None:
        assert status != 200, "unauthorized model call was accepted"
        return status
    assert status == expected, f"unexpected HTTP {status} at {path}"
    if "code" in data:
        assert data["code"] == 200, f"owner rejected {path}"
        return data["data"]
    return data


def wait(path, timeout, predicate=lambda value: True):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            value = json.loads(path.read_text())
            if predicate(value):
                return value
        time.sleep(.2)
    raise RuntimeError("acceptance deadline exceeded: " + path.name)


wait(args.dsh_ready, 90)
points_before = request("/api/v1/managed-ai/points/query", {})
assert Decimal(points_before["purchased_points"]) > 0
assert Decimal(points_before["granted_points"]) > 0
foreign = bridge["foreignToken"]
zero_before = request("/api/v1/managed-ai/points/query", {}, foreign)
assert Decimal(zero_before["available_points"]) == 0


def save(name, key_name, base, model, protocol, token=None):
    settings = request("/api/v1/user-models/settings/query", {}, token)
    saved = request("/api/v1/user-models/settings/save", {
        "expected_revision": settings["revision"], "name": name,
        "execution": "cloud", "protocol": protocol, "base_url": base,
        "model_key": model, "api_key": secrets[key_name],
        "capabilities": {"text": True, "tools": True, "json": True,
                         "stream": True, "images": False,
                         "context_tokens": 32768, "output_tokens": 512}}, token)
    result = next(m for m in saved["models"] if m["name"] == name)
    assert "api_key" not in result and result["key_configured"]
    return result


zero = save("零积分自备模型实测", "JOTMO_MANAGED_AI_TEST_DEEPSEEK_API_KEY",
            "https://api.deepseek.com", "deepseek-flash", "openai-chat", foreign)
call_id = str(uuid4())
body = {"model": zero["version_route"], "messages": [
    {"role": "user", "content": "只回复 OK。"}], "max_tokens": 512,
    "thinking": {"type": "disabled"}}
headers = {"X-Arkme-Call-Id": call_id}
first = request("/api/v1/user-models/chat/completions", body, foreign, headers)
assert first["choices"][0]["finish_reason"] == "stop"
assert first["usage"]["completion_tokens"] > 0
for _ in range(2):
    assert request("/api/v1/user-models/chat/completions", body, foreign, headers) == first
foreign_status = request("/api/v1/user-models/chat/completions", body,
                         headers={"X-Arkme-Call-Id": str(uuid4())}, expected=None)

vectors = [
    ("白链 Chat 实测", "JOTMO_MANAGED_AI_TEST_BAILIAN_API_KEY", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-flash", "openai-chat"),
    ("DeepSeek Chat 实测", "JOTMO_MANAGED_AI_TEST_DEEPSEEK_API_KEY", "https://api.deepseek.com", "deepseek-flash", "openai-chat"),
    ("DeepSeek Responses 实测", "JOTMO_MANAGED_AI_TEST_DEEPSEEK_API_KEY", "https://api.deepseek.com", "deepseek-flash", "openai-responses"),
    ("DeepSeek Messages 实测", "JOTMO_MANAGED_AI_TEST_DEEPSEEK_API_KEY", "https://api.deepseek.com/anthropic/v1", "deepseek-flash", "anthropic-messages"),
    ("白链 Messages 实测", "JOTMO_MANAGED_AI_TEST_BAILIAN_API_KEY", "https://dashscope.aliyuncs.com/apps/anthropic/v1", "qwen-flash", "anthropic-messages"),
]
models = [save(*vector) for vector in vectors]
native_output = args.evidence.resolve() / "native-results.json"
native_output.unlink(missing_ok=True)
(args.evidence / "admission.json").write_text(json.dumps({
    "points_before": points_before, "zero_points_before": zero_before,
    "models": models, "foreign_model_status": foreign_status,
    "zero_points_call": True, "zero_points_replays": 2,
}, ensure_ascii=False, indent=2) + "\n")
args.commands.write_text(json.dumps({"routes": [m["route"] for m in models],
                                    "output": str(native_output)}))
native = wait(native_output, 480, lambda value: len(value["results"]) == len(models))

now = datetime.now(ZoneInfo("Asia/Shanghai"))
query = {"start": (now - timedelta(days=1)).date().isoformat(),
         "end": (now + timedelta(days=1)).date().isoformat(),
         "mode": "statistics", "source": "user-api"}
usage = request("/api/v1/user-models/usage/query", query)
zero_usage = request("/api/v1/user-models/usage/query", query, foreign)
assert zero_usage["totals"]["calls"] == 1, "replay double-counted usage"
assert usage["totals"]["calls"] == len(models) + 1
assert usage["totals"]["unknown_calls"] == 1  # existing no-usage supplier fixture
assert usage["totals"]["input_known_calls"] == len(models)
assert usage["totals"]["output_known_calls"] == len(models)
assert usage["totals"]["input_tokens"] == sum(
    r["usage"]["inputTokens"] + r["usage"].get("cacheReadTokens", 0) +
    r["usage"].get("cacheWriteTokens", 0) for r in native["results"])
assert usage["totals"]["output_tokens"] == sum(
    r["usage"]["outputTokens"] for r in native["results"])
operations = request("/api/v1/user-models/usage/query", {**query, "mode": "operations"})
call_count = 0
for operation in operations["operations"]:
    key = operation["key"]
    detail = request("/api/v1/user-models/usage/query", {
        **query, "mode": "calls", "operation_uid": key["operation"],
        "model_uid": key["model"], "scene": key["scene"],
        "cursor": operation["calls_cursor"]})
    assert len(detail["calls"]) == operation["calls"] and not detail.get("next_cursor")
    call_count += len(detail["calls"])
assert call_count == len(models) + 1
points_after = request("/api/v1/managed-ai/points/query", {})
zero_after = request("/api/v1/managed-ai/points/query", {}, foreign)
for key in ("available_points", "reserved_points", "granted_points", "purchased_points", "account_version", "grants"):
    assert points_before[key] == points_after[key], "BYOK changed points: " + key
    assert zero_before[key] == zero_after[key], "zero-balance BYOK changed points: " + key
result = {"native_adapter_calls": len(models), "zero_points_call": True,
          "zero_points_replays": 2, "foreign_model_status": foreign_status,
          "points_before": points_before, "points_after": points_after,
          "zero_points_before": zero_before, "zero_points_after": zero_after,
          "usage": usage, "zero_usage": zero_usage,
          "operations": operations, "call_drilldown_count": call_count,
          "models": models, "provider_calls_capped": 6}
serialized = json.dumps(result, ensure_ascii=False, indent=2)
assert not any(key in serialized for key in secrets.values())
(args.evidence / "result.json").write_text(serialized + "\n")
print(json.dumps({"native_adapter_calls": len(models), "zero_points_succeeded": True,
                  "points_unchanged": True, "usage_matches_native_receipts": True}))
