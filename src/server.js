import express from "express";
import crypto from "node:crypto";
import { openDb } from "./db.js";

const COOKIE_NAME = "session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === check.length && crypto.timingSafeEqual(expected, check);
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function makeSessionCookieValue(userId, secret) {
  return `${userId}.${sign(String(userId), secret)}`;
}

function verifySessionCookieValue(value, secret) {
  if (!value) return null;
  const [userId, sig] = value.split(".");
  if (!userId || !sig) return null;
  const expected = sign(userId, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Number(userId);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}

function layout(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#222}
input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:8px;font-size:1rem}
button{padding:8px 16px;font-size:1rem;cursor:pointer}
li{display:flex;align-items:center;gap:8px;margin:6px 0}
li.done span{text-decoration:line-through;color:#888}
li span{flex:1}
form.inline{display:inline}
.error{color:#b00020}
nav{display:flex;justify-content:space-between;margin-bottom:16px}
</style></head><body>${body}</body></html>`;
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.redirect("/login");
  next();
}

export function createApp({
  dbPath = process.env.DATABASE_PATH || "data.sqlite",
  sessionSecret = process.env.SESSION_SECRET,
} = {}) {
  if (!sessionSecret) {
    // ponytail: no persistent secret store for a single-instance MVP; restarts
    // invalidate existing sessions. Set SESSION_SECRET to keep sessions alive across deploys.
    console.warn("SESSION_SECRET not set; generating an ephemeral one for this process.");
    sessionSecret = crypto.randomBytes(32).toString("hex");
  }

  const db = openDb(dbPath);
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    req.userId = verifySessionCookieValue(cookies[COOKIE_NAME], sessionSecret);
    next();
  });

  function setSessionCookie(res, userId, secure) {
    const value = makeSessionCookieValue(userId, sessionSecret);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_MS / 1000}${secure ? "; Secure" : ""}`,
    );
  }

  function clearSessionCookie(res, secure) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
    );
  }

  app.get("/healthz", (req, res) => res.json({ status: "ok" }));

  app.get("/signup", (req, res) => {
    if (req.userId) return res.redirect("/");
    res.send(layout("Sign up", signupPage()));
  });

  app.post("/signup", (req, res) => {
    if (req.userId) return res.redirect("/");
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).send(layout("Sign up", signupPage("Enter a valid email address.")));
    }
    if (password.length < 8) {
      return res.status(400).send(layout("Sign up", signupPage("Password must be at least 8 characters.")));
    }
    try {
      const { lastInsertRowid } = db
        .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
        .run(email, hashPassword(password));
      setSessionCookie(res, lastInsertRowid, req.secure);
      res.redirect("/");
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return res.status(400).send(layout("Sign up", signupPage("That email is already registered.")));
      }
      throw err;
    }
  });

  app.get("/login", (req, res) => {
    if (req.userId) return res.redirect("/");
    res.send(layout("Log in", loginPage()));
  });

  app.post("/login", (req, res) => {
    if (req.userId) return res.redirect("/");
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(400).send(layout("Log in", loginPage("Invalid email or password.")));
    }
    setSessionCookie(res, user.id, req.secure);
    res.redirect("/");
  });

  app.post("/logout", (req, res) => {
    clearSessionCookie(res, req.secure);
    res.redirect("/login");
  });

  app.get("/", requireAuth, (req, res) => {
    const todos = db.prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY id").all(req.userId);
    res.send(layout("My todos", todoPage(todos)));
  });

  app.post("/todos", requireAuth, (req, res) => {
    const text = String(req.body.text || "").trim();
    if (text) {
      db.prepare("INSERT INTO todos (user_id, text) VALUES (?, ?)").run(req.userId, text);
    }
    res.redirect("/");
  });

  app.post("/todos/:id/toggle", requireAuth, (req, res) => {
    db.prepare("UPDATE todos SET done = 1 - done WHERE id = ? AND user_id = ?").run(
      req.params.id,
      req.userId,
    );
    res.redirect("/");
  });

  app.post("/todos/:id/edit", requireAuth, (req, res) => {
    const text = String(req.body.text || "").trim();
    if (text) {
      db.prepare("UPDATE todos SET text = ? WHERE id = ? AND user_id = ?").run(
        text,
        req.params.id,
        req.userId,
      );
    }
    res.redirect("/");
  });

  app.post("/todos/:id/delete", requireAuth, (req, res) => {
    db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
    res.redirect("/");
  });

  return app;
}

function signupPage(error) {
  return `<h1>Sign up</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/signup">
<input name="email" type="email" placeholder="Email" required>
<input name="password" type="password" placeholder="Password (min 8 chars)" required minlength="8">
<button type="submit">Sign up</button>
</form>
<p><a href="/login">Already have an account? Log in</a></p>`;
}

function loginPage(error) {
  return `<h1>Log in</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/login">
<input name="email" type="email" placeholder="Email" required>
<input name="password" type="password" placeholder="Password" required>
<button type="submit">Log in</button>
</form>
<p><a href="/signup">Need an account? Sign up</a></p>`;
}

function todoPage(todos) {
  const items = todos
    .map(
      (t) => `<li class="${t.done ? "done" : ""}">
<form class="inline" method="post" action="/todos/${t.id}/toggle"><button title="toggle">${t.done ? "☐" : "☑"}</button></form>
<form class="inline" method="post" action="/todos/${t.id}/edit">
<input name="text" value="${escapeHtml(t.text)}" size="20">
<button type="submit" title="save">Save</button>
</form>
<form class="inline" method="post" action="/todos/${t.id}/delete"><button title="delete">✕</button></form>
</li>`,
    )
    .join("\n");
  return `<nav><h1>My todos</h1><form method="post" action="/logout"><button>Log out</button></form></nav>
<form method="post" action="/todos">
<input name="text" placeholder="New todo" required>
<button type="submit">Add</button>
</form>
<ul>${items}</ul>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`listening on ${port}`));
}
