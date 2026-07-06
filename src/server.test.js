import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.js";

test("GET /healthz returns ok", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(`http://localhost:${port}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
  server.close();
});
