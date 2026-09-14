import { createServer } from "node:https";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

const checkout = process.env.ARKME_DSH_CHECKOUT,
  profile = process.env.ARKME_PACKED_PROFILE;
const ownerURL = process.env.JOTMO_RECORDING_BROWSER_E2E_URL;
if (
  !checkout ||
  !profile ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(ownerURL ?? "")
)
  throw new Error(
    "Explicit packed profile and loopback Go owner fixture required",
  );
const importFile = (path) =>
  import(/* @vite-ignore */ pathToFileURL(path).href);
const { launchWebScaffold } = await importFile(
  join(checkout, "apps/web/tests/scaffold.ts"),
);
const { chromium } = createRequire(join(checkout, "apps/web/package.json"))(
  "playwright",
);
const { healProfilesModuleFallback } = await importFile(
  createRequire(join(checkout, "apps/cli/package.json")).resolve(
    "@deepseek-ai/dsh-app-boot",
  ),
);
const manifest = JSON.parse(
  await readFile(join(profile, "package.json"), "utf8"),
);
if (
  !/^file:.*\.tgz$/.test(manifest.dependencies?.["@senguoyun/dsh-arkme"] ?? "")
)
  throw new Error("Immutable tgz installation required");
const { createArkmeSdk, readCompleteRecordingTranscript } = await importFile(
  join(profile, "node_modules/@senguoyun/dsh-arkme/lib/sdk.js"),
);

it("runs browser, packed Host and SDK through Go JWT, Mongo and S3 pack reads", async () => {
  const fixture = await (await fetch(ownerURL + "/fixture")).json();
  expect(fixture.owner).toBe(10001);
  expect(fixture.items).toBe(250);
  const root = await mkdtemp(join(tmpdir(), "arkme real recording owner ")),
    failures = [],
    requests = [];
  let browser, scaffold, page;
  const proxy = createServer(
    {
      key: await readFile(process.env.ARKME_E2E_TLS_KEY),
      cert: await readFile(process.env.NODE_EXTRA_CA_CERTS),
    },
    async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks),
          path = new URL(req.url, "https://localhost").pathname;
        requests.push(path);
        if (path.startsWith("/api/v1/audio/")) {
          const headers = {
            "content-type": req.headers["content-type"] ?? "application/json",
          };
          for (const key of [
            "authorization",
            "range",
            "if-none-match",
            "if-range",
          ])
            if (req.headers[key]) headers[key] = req.headers[key];
          const upstream = await fetch(ownerURL + req.url, {
            method: req.method,
            headers,
            ...(body.length ? { body } : {}),
            redirect: "manual",
          });
          res.statusCode = upstream.status;
          for (const [key, value] of upstream.headers)
            if (
              !["connection", "transfer-encoding", "content-encoding"].includes(
                key,
              )
            )
              res.setHeader(key, value);
          res.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        }
        let data = { items: [], users: [], has_more: false };
        if (path.endsWith("/the-best-api-for-testing"))
          data = {
            access_token: fixture.app_access_token,
            refresh_token: "isolated-refresh",
          };
        if (path.endsWith("/get-user-info"))
          data = {
            user_id: fixture.owner,
            nick_name: "跨仓验收",
            phone: "13800000000",
          };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 200, data }));
      } catch {
        res.statusCode = 500;
        res.end("isolated upstream failure");
      }
    },
  );
  try {
    await healProfilesModuleFallback({
      installAnchor: join(checkout, "apps/cli/package.json"),
      home: resolve(profile, "../.."),
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const origin = `https://127.0.0.1:${proxy.address().port}`;
    const config = {
      environment: "test",
      stateDirectory: join(root, "state"),
      keychainServicePrefix: `com.senqisi.recording-owner-${randomUUID()}`,
      allowProduction: false,
      updateCheckEnabled: false,
      openApiMcpEnabled: false,
      dshRemoteFeatureEnabled: false,
      extensionShareDiscoveryEnabled: false,
      toolProfile: "business",
    };
    for (const name of [
      "auth",
      "subject",
      "record",
      "data",
      "chat",
      "bot",
      "im",
      "webrtc",
      "world",
      "relation",
      "intelligent",
      "audio",
      "openApi",
      "extensionPublish",
      "updateService",
    ])
      config[`${name}BaseUrl`] = origin;
    config.shareWebsite = origin;
    const overlay = join(root, "overlay.json");
    await writeFile(
      overlay,
      JSON.stringify([
        {
          insert: [
            {
              id: "arkme-real-recording-e2e",
              name: "@senguoyun/dsh-arkme",
              config,
            },
          ],
        },
      ]),
    );
    scaffold = await launchWebScaffold({
      extraOverlayPath: overlay,
      extraInstallAnchors: [join(profile, "package.json")],
    });
    expect(
      await scaffold.ctx.get("arkmeData").testLogin(fixture.owner),
    ).toMatchObject({ status: "authenticated", userId: fixture.owner });
    browser = await chromium.launch({
      channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || "chrome",
    });
    const context = await browser.newContext({
      viewport: { width: 1680, height: 1000 },
      acceptDownloads: true,
    });
    page = await context.newPage();
    await page.goto(scaffold.authenticatedUrl, { waitUntil: "load" });
    await page.getByRole("button", { name: "录音", exact: true }).click();
    await expect
      .poll(() => page.locator("[data-recording-transcript-item]").count())
      .toBe(100);
    const sdk = createArkmeSdk({
      fetchImpl: (url, init) => scaffold.hostFetch(String(url), init),
    });
    const initial = await sdk.recordingTranscriptPage(fixture.start_at);
    const first = initial.items[0];
    // Another client edits and restores one sentence while this UI still holds
    // the old first page. The next scroll must recover through the real wire.
    const owner = scaffold.ctx.get("arkmeData");
    const options = await owner.recordingSpeakerOptions();
    const target = options.find(item => item.label === "验收乙");
    const original = options.find(item => item.label === "验收甲");
    const edited = await owner.assignRecordingSpeaker({ itemRef: first.itemRef, speakerRef: target.speakerRef, scope: "item" });
    await owner.assignRecordingSpeaker({ itemRef: edited.day.transcript.items[0].itemRef, speakerRef: original.speakerRef, scope: "item" });
    await page.locator("[data-recording-transcript-item]").nth(99).scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator("[data-recording-transcript-item]").count()).toBeGreaterThanOrEqual(200);
    expect(await page.getByRole("alert").allTextContents()).not.toContain("录音内容正在更新");
    await page.locator("[data-recording-transcript-item]").first().scrollIntoViewIfNeeded();
    const loadedBeforeEdit = await page.locator("[data-recording-transcript-item]").count();
    const originalPlayback = await scaffold.ctx
      .get("arkmeData")
      .recordingPlayback((await sdk.recordingTranscriptPage(fixture.start_at)).items[0].itemRef);
    await page.locator("[data-recording-transcript-item]").first().dblclick();
    await page.getByRole("button", { name: "播放录音", exact: true }).click();
    await page.getByRole("button", { name: "暂停录音", exact: true }).waitFor();
    await page.getByRole("button", { name: "暂停录音", exact: true }).click();
    await page
      .locator("[data-recording-transcript-item]")
      .first()
      .getByRole("button", { name: "编辑说话人 验收甲", exact: true })
      .click();
    const editor = page.getByRole("dialog", {
      name: "编辑说话人",
      exact: true,
    });
    await editor.getByRole("button", { name: /验收乙/ }).click();
    await editor
      .getByRole("checkbox", { name: "批量修改", exact: true })
      .uncheck();
    const assignmentResponse = page.waitForResponse((response) => {
      try {
        return (
          response.request().postDataJSON()?.operation ===
          "recordings.speaker.assign-item"
        );
      } catch {
        return false;
      }
    });
    await editor.getByRole("button", { name: "确认", exact: true }).click();
    const assignmentBody = await (await assignmentResponse).json();
    expect(assignmentBody.ok, JSON.stringify(assignmentBody.error)).toBe(true);
    expect(assignmentBody.value.day.transcript.items[0].speakerLabel).toBe(
      "验收乙",
    );
    await expect
      .poll(() =>
        page.locator("[data-recording-transcript-item]").first().textContent(),
      )
      .toContain("验收乙");
    expect(
      await page
        .locator("[data-recording-transcript-item]")
        .nth(1)
        .textContent(),
    ).toContain("验收甲");
    await expect.poll(() => page.locator("[data-recording-transcript-item]").count()).toBeGreaterThanOrEqual(loadedBeforeEdit);
    const current = await sdk.recordingTranscriptPage(fixture.start_at);
    expect(current.items[0].speakerLabel).toBe("验收乙");
    const nextPlayback = await scaffold.ctx
      .get("arkmeData")
      .recordingPlayback(current.items[0].itemRef);
    expect(nextPlayback.endOffsetMillis).toBe(originalPlayback.endOffsetMillis);
    await expect(
      sdk.recordingTranscriptPage(fixture.start_at, {
        cursor: initial.nextCursor,
      }),
    ).rejects.toThrow();
    await page
      .getByRole("textbox", { name: "搜索当天转写", exact: true })
      .fill("页末唯一命中");
    await expect
      .poll(() =>
        page.getByRole("status", { name: "搜索命中数" }).textContent(),
      )
      .toBe("1/1");
    await expect
      .poll(() => page.locator("[data-recording-transcript-item]").count())
      .toBe(250);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const file = await downloading,
      text = await readFile(await file.path(), "utf8");
    expect(text).toContain("独立原话 0");
    expect(text).toContain("页末唯一命中尾部");
    const complete = await readCompleteRecordingTranscript(current, (cursor) =>
      sdk.recordingTranscriptPage(fixture.start_at, { cursor }),
    );
    expect(complete.items).toHaveLength(250);
    expect(requests.some((path) => path.includes("/clips/"))).toBe(true);
    expect(requests).toContain(
      "/api/v1/audio/recordings/transcript/speaker/assign",
    );
    expect(
      requests.some((path) => /one-day-trans|assign-asr-item/.test(path)),
    ).toBe(false);
    expect(await page.content()).not.toContain(fixture.app_access_token);
    if (process.env.ARKME_E2E_SCREENSHOT)
      await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT });
  } catch (error) {
    failures.push(error);
  } finally {
    const clean = async (fn) => {
      try {
        await fn();
      } catch (error) {
        failures.push(error);
      }
    };
    if (failures.length && page && process.env.ARKME_E2E_SCREENSHOT)
      await clean(() =>
        page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT }),
      );
    await clean(() => browser?.close());
    if (scaffold) await clean(() => scaffold.ctx.get("arkmeData").logout());
    await clean(() => scaffold?.close());
    proxy.closeAllConnections();
    await clean(() => new Promise((resolve) => proxy.close(resolve)));
    await clean(() => rm(root, { recursive: true, force: true }));
    await clean(() => fetch(ownerURL + "/finish", { method: "POST" }));
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Real recording owner or cleanup failed",
    );
}, 120000);
