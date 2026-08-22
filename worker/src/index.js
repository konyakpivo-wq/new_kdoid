const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://konyakpivo-wq.github.io",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
});

function cookie(name, value, maxAge, httpOnly = true) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; Secure; SameSite=None${httpOnly ? "; HttpOnly" : ""}`;
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

async function keyFromSecret(secret) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
function bytesToB64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64ToBytes(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); return Uint8Array.from(bin, c => c.charCodeAt(0)); }

async function encryptSession(env, data) {
  const key = await keyFromSecret(env.SESSION_SECRET);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(iv.length + cipher.length); out.set(iv, 0); out.set(cipher, iv.length); return bytesToB64(out);
}
async function decryptSession(env, value) {
  if (!value) return null;
  try { const raw = b64ToBytes(value); const iv = raw.slice(0, 12), cipher = raw.slice(12); const key = await keyFromSecret(env.SESSION_SECRET); const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher); const data = JSON.parse(new TextDecoder().decode(plain)); return data.exp && Date.now() <= data.exp ? data : null; } catch (_) { return null; }
}
async function githubFetch(url, token, options = {}) {
  return fetch(url, { ...options, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(options.headers || {}) } });
}
async function requireAdmin(request, env) { const session = await decryptSession(env, readCookie(request, "nka_session")); return session && session.login.toLowerCase() === env.ADMIN_GITHUB_LOGIN.toLowerCase() ? session : null; }
async function getFile(env, token, path) { const r = await githubFetch(`https://api.github.com/repos/${env.CATALOG_OWNER}/${env.CATALOG_REPO}/contents/${path}`, token); if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status}`); return r.json(); }
function decodeBase64(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0))); }
function encodeBase64(s) { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }

async function addRepository(request, env) {
  const session = await requireAdmin(request, env); if (!session) return json({ error: "unauthorized" }, 401);
  const body = await request.json();
  const name = String(body.name || "").trim(), repository = String(body.repository || "").trim(), category = String(body.category || "").trim(), description = String(body.description || "").trim();
  if (!name || !repository || !category || !description) return json({ error: "Заполните все поля" }, 400);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(repository)) return json({ error: "Неверная ссылка GitHub" }, 400);
  const repoFile = await getFile(env, session.token, "repo.txt"), decaFile = await getFile(env, session.token, "deca.txt");
  const repoText = decodeBase64(repoFile.content).replace(/\r/g, "").trim(), decaText = decodeBase64(decaFile.content).replace(/\r/g, "").trim();
  const normalizedUrl = repository.replace(/\/$/, "");
  if (repoText.split("\n").some(x => x.trim().replace(/\/$/, "") === normalizedUrl)) return json({ error: "Этот репозиторий уже есть в каталоге" }, 409);
  const nextRepo = repoText ? `${repoText}\n${normalizedUrl}` : normalizedUrl, nextDeca = decaText ? `${decaText}\n${name}|${category}|${description}` : `${name}|${category}|${description}`;
  const commit = async (path, content, sha, message) => {
    const r = await githubFetch(`https://api.github.com/repos/${env.CATALOG_OWNER}/${env.CATALOG_REPO}/contents/${path}`, session.token, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, content: encodeBase64(content), sha, branch: env.CATALOG_BRANCH }) });
    if (!r.ok) throw new Error(`GitHub PUT ${path}: ${r.status}`); return r.json();
  };
  await commit("repo.txt", nextRepo + "\n", repoFile.sha, `Add ${name} to repository catalog`);
  try { await commit("deca.txt", nextDeca + "\n", decaFile.sha, `Add metadata for ${name}`); } catch (_) { return json({ error: "repo.txt обновлён, но deca.txt не удалось обновить." }, 502); }
  return json({ ok: true, message: `${name} добавлен в каталог` });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    if (url.pathname === "/login") {
      const state = bytesToB64(crypto.getRandomValues(new Uint8Array(24))), redirect = new URL("https://github.com/login/oauth/authorize");
      redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID); redirect.searchParams.set("redirect_uri", `${url.origin}/callback`); redirect.searchParams.set("scope", "public_repo read:user"); redirect.searchParams.set("state", state);
      return new Response(null, { status: 302, headers: { Location: redirect.toString(), "Set-Cookie": cookie("nka_state", state, 600) } });
    }
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code"), returnedState = url.searchParams.get("state"), savedState = readCookie(request, "nka_state");
      if (!code || !returnedState || !savedState || returnedState !== savedState) return new Response("OAuth state check failed", { status: 400 });
      const tokenResp = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/callback` }) });
      const tokenData = await tokenResp.json(); if (!tokenData.access_token) return new Response("GitHub OAuth failed", { status: 502 });
      const userResp = await githubFetch("https://api.github.com/user", tokenData.access_token), user = await userResp.json();
      if (!user.login || user.login.toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()) return new Response("Доступ запрещён. Этот GitHub аккаунт не является администратором.", { status: 403 });
      const session = await encryptSession(env, { login: user.login, token: tokenData.access_token, exp: Date.now() + 8 * 60 * 60 * 1000 });
      const headers = new Headers({ Location: `${env.SITE_URL}/admin-panel.html?github=success` }); headers.append("Set-Cookie", cookie("nka_session", session, 8 * 60 * 60)); headers.append("Set-Cookie", cookie("nka_state", "", 0));
      return new Response(null, { status: 302, headers });
    }
    if (url.pathname === "/logout") { const headers = new Headers({ Location: `${env.SITE_URL}/admin.html` }); headers.append("Set-Cookie", cookie("nka_session", "", 0)); return new Response(null, { status: 302, headers }); }
    if (url.pathname === "/api/me") { const session = await requireAdmin(request, env); return session ? json({ loggedIn: true, login: session.login }) : json({ loggedIn: false }, 401); }
    if (url.pathname === "/api/add-repository" && request.method === "POST") return addRepository(request, env);
    return new Response("New KDroid OAuth Worker", { status: 200, headers: CORS_HEADERS });
  }
};
