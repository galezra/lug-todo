import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.js";

function client(base) {
  let cookie = "";
  async function request(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      redirect: "manual",
      headers: {
        ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
  }
  return request;
}

async function withServer(fn) {
  const server = createApp({ dbPath: ":memory:", sessionSecret: "test-secret" }).listen(0);
  const { port } = server.address();
  try {
    await fn(`http://localhost:${port}`);
  } finally {
    server.close();
  }
}

test("GET /healthz returns ok", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

test("signup, add/edit/toggle/delete todos, logout", async () => {
  await withServer(async (base) => {
    const req = client(base);

    let res = await req("POST", "/signup", { email: "a@example.com", password: "password1" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");

    res = await req("POST", "/todos", { text: "buy milk" });
    assert.equal(res.status, 302);

    res = await req("GET", "/");
    let html = await res.text();
    assert.match(html, /buy milk/);

    const idMatch = html.match(/\/todos\/(\d+)\/toggle/);
    const id = idMatch[1];

    res = await req("POST", `/todos/${id}/toggle`);
    assert.equal(res.status, 302);
    html = await (await req("GET", "/")).text();
    assert.match(html, /class="done"/);

    res = await req("POST", `/todos/${id}/edit`, { text: "buy oat milk" });
    assert.equal(res.status, 302);
    html = await (await req("GET", "/")).text();
    assert.match(html, /buy oat milk/);

    res = await req("POST", `/todos/${id}/delete`);
    assert.equal(res.status, 302);
    html = await (await req("GET", "/")).text();
    assert.doesNotMatch(html, /buy oat milk/);

    res = await req("POST", "/logout");
    assert.equal(res.status, 302);
    res = await req("GET", "/");
    assert.equal(res.headers.get("location"), "/login");
  });
});

test("users only see their own todos", async () => {
  await withServer(async (base) => {
    const alice = client(base);
    const bob = client(base);

    await alice("POST", "/signup", { email: "alice@example.com", password: "password1" });
    await alice("POST", "/todos", { text: "alice secret task" });

    await bob("POST", "/signup", { email: "bob@example.com", password: "password1" });
    let html = await (await bob("GET", "/")).text();
    assert.doesNotMatch(html, /alice secret task/);

    // Bob can't delete/edit Alice's todo by guessing its id (id=1).
    await bob("POST", "/todos/1/delete");
    html = await (await alice("GET", "/")).text();
    assert.match(html, /alice secret task/);
  });
});

test("rejects duplicate email and weak password", async () => {
  await withServer(async (base) => {
    const req = client(base);
    let res = await req("POST", "/signup", { email: "dup@example.com", password: "password1" });
    assert.equal(res.status, 302);

    const other = client(base);
    res = await other("POST", "/signup", { email: "dup@example.com", password: "password2" });
    assert.equal(res.status, 400);

    res = await other("POST", "/signup", { email: "weak@example.com", password: "short" });
    assert.equal(res.status, 400);
  });
});

test("rejects wrong password on login", async () => {
  await withServer(async (base) => {
    const req = client(base);
    await req("POST", "/signup", { email: "user@example.com", password: "password1" });
    await req("POST", "/logout");

    const res = await req("POST", "/login", { email: "user@example.com", password: "wrongpass" });
    assert.equal(res.status, 400);
  });
});
