import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { runInNewContext } from "node:vm";

let preview;
let closed;
let origin;

before(async () => {
  preview = spawn(process.execPath, [
    fileURLToPath(new URL("./node_modules/astro/bin/astro.mjs", import.meta.url)),
    "preview", "--host", "127.0.0.1", "--port", "0",
  ], { cwd: new URL(".", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
  closed = new Promise((resolve) => preview.once("close", resolve));
  origin = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Preview did not start: ${output}`)), 15000);
    const finish = (error, url) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(url);
    };
    preview.once("error", (error) => finish(error));
    preview.once("close", (code) => finish(new Error(`Preview exited (${code}): ${output}`)));
    const inspect = (chunk) => {
      output += stripVTControlCharacters(chunk.toString());
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      if (url) finish(null, url);
    };
    preview.stdout.on("data", inspect);
    preview.stderr.on("data", inspect);
  });
});

after(async () => {
  if (preview && preview.exitCode === null && preview.signalCode === null) preview.kill("SIGTERM");
  if (closed) await closed;
});

test("production root serves the greeting, official assets and inline health", async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /Hello\./);
  assert.match(html, /Astro sample for App Service Builder/);
  assert.match(html, /https:\/\/docs\.astro\.build\//);
  assert.match(html, /https:\/\/builder\.appservice\.azure\.com\/docs\//);
  assert.match(html, /data-health-check/);
  assert.match(html, /id="health-status" role="status"/);
  assert.match(html, /src\/pages\/index\.astro/);
  assert.doesNotMatch(html, /href="\/health"|\/demo|Interaction count/);
  for (const [asset, type] of [
    ["/assets/builder.svg", /image\/svg/],
    ["/assets/astro.svg", /image\/svg/],
    ["/assets/health.js", /javascript/],
  ]) {
    assert.ok(asset);
    const result = await fetch(new URL(asset, origin));
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type"), type);
    assert.ok((await result.arrayBuffer()).byteLength > 0);
  }
  assert.match(html, /focus-visible/);
  const health = await fetch(new URL("/health", origin));
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "OK\n");
  for (const path of ["/demo", "/missing"]) {
    assert.equal((await fetch(new URL(path, origin))).status, 404);
  }
});

test("static health reports failures and permits a real retry", async () => {
  const script = await readFile(new URL("./public/assets/health.js", import.meta.url), "utf8");
  for (const failure of [
    () => new Response("Unavailable", { status: 503 }),
    () => new Response("<html>Wrong route</html>"),
    () => { throw new TypeError("Network unavailable"); },
  ]) {
    let click;
    let attempt = 0;
    const button = { addEventListener: (_event, callback) => { click = callback; } };
    const status = { textContent: "" };
    runInNewContext(script, {
      document: { querySelector: (selector) => selector === "[data-health-check]" ? button : status },
      AbortSignal,
      fetch: async (path, options) => {
        assert.equal(path, "/health");
        assert.equal(options.cache, "no-store");
        return attempt++ === 0 ? failure() : new Response("OK\n");
      },
    });
    await click();
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /failed.*Retry/);
    await click();
    assert.equal(button.disabled, false);
    assert.match(status.textContent, /responded successfully.*not a server or dependency readiness check/);
  }
});
