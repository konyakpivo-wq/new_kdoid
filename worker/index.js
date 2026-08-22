const GH = "https://api.github.com";
const REPO = "konyakpivo-wq/new_kdord";
const BRANCH = "main";

function corsHeaders(origin) {
  const allowed = origin === "https://konyakpivo-wq.github.io" || (origin && origin.endsWith(".github.io"));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://konyakpivo-wq.github.io",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}

function response(body, status, request) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request.headers.get("Origin")) }
  });
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function keyFromSecret(secret) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(value, secret) {
  const key = await keyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const out = new Uint8Array(iv.length + encrypted.byteLength);
  out.set(iv, 0); out.set(new Uint8Array(encrypted), iv.length);
  return b64url(out);
}
async function open(value, secret) {
  try {
    const raw = unb64url(value);
    const key = await keyFromSecret(secret);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

async function github(path, token, options = {}) {
  const r = await fetch(GH + path, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!r.ok) throw new Error(data.message || `GitHub API ${r.status}`);
  return data;
}

function isAdmin(login, env) {
  return (env.ADMIN_GITHUB_USERS || "konyakpivo-wq").split(",").map(x => x.trim().toLowerCase()).includes(login.toLowerCase());
}

async function sessionUser(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)nkd_session=([^;]+)/);
  if (!match) return null;
  const token = await open(decodeURIComponent(match[1]), env.SESSION_SECRET);
  if (!token) return null;
  try {
    const payload = JSON.parse(token);
    if (!payload.exp || payload.exp < Date.now() || !payload.access_token) return null;
    const user = await github("/user", payload.access_token);
    if (!isAdmin(user.login, env)) return null;
    return { ...user, access_token: payload.access_token };
  } catch { return null; }
}

function cookie(value, maxAge = 3600) {
  return `nkd_session=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function login(request, env) {
  const state = await seal(JSON.stringify({ nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 }), env.SESSION_SECRET);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GITHUB_CALLBACK_URL);
  url.searchParams.set("scope", "read:user public_repo");
  url.searchParams.set("state", state);
  return Response.redirect(url.toString(), 302);
}

async function callback(request, env) {
  const u = new URL(request.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state || !(await open(state, env.SESSION_SECRET))) return new Response("Invalid OAuth state", { status: 400 });

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: env.GITHUB_CALLBACK_URL })
  });
  const token = await tokenResponse.json();
  if (!token.access_token) return new Response("GitHub authorization failed", { status: 401 });

  const user = await github("/user", token.access_token);
  if (!isAdmin(user.login, env)) return new Response("Этот GitHub-аккаунт не является администратором New KDroid.", { status: 403 });

  const session = await seal(JSON.stringify({ access_token: token.access_token, exp: Date.now() + 8 * 60 * 60 * 1000 }), env.SESSION_SECRET);
  const headers = new Headers({ Location: `${env.SITE_URL}/admin-panel.html`, "Set-Cookie": cookie(session, 8 * 60 * 60) });
  return new Response(null, { status: 302, headers });
}

async function addRepository(request, env) {
  const user = await sessionUser(request, env);
  if (!user) return response(JSON.stringify({ error: "Unauthorized" }), 401, request);
  const body = await request.json();
  const name = String(body.name || "").trim();
  const repoUrl = String(body.url || "").trim();
  const category = String(body.category || "").trim();
  const description = String(body.description || "").trim();
  const m = repoUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/?$/i);
  if (!name || !m || !category || !description) return response(JSON.stringify({ error: "Заполните все поля и укажите GitHub URL вида https://github.com/owner/repo" }), 400, request);

  const token = user.access_token;
  const ref = await github(`/repos/${REPO}/git/ref/heads/${BRANCH}`, token);
  const parentSha = ref.object.sha;
  const parentCommit = await github(`/repos/${REPO}/git/commits/${parentSha}`, token);
  const currentTree = await github(`/repos/${REPO}/git/trees/${parentCommit.tree.sha}?recursive=1`, token);

  const findBlob = path => currentTree.tree.find(x => x.path === path);
  const repoBlob = findBlob("repo.txt");
  const decaBlob = findBlob("deca.txt");
  const repoText = repoBlob ? (await github(`/repos/${REPO}/git/blobs/${repoBlob.sha}`, token)).content : "";
  const decaText = decaBlob ? (await github(`/repos/${REPO}/git/blobs/${decaBlob.sha}`, token)).content : "";
  const decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0)));
  const existingRepos = repoText ? decode(repoText).trim().split(/\r?\n/).filter(Boolean) : [];
  if (existingRepos.some(x => x.trim().toLowerCase() === repoUrl.toLowerCase())) return response(JSON.stringify({ error: "Этот репозиторий уже есть в каталоге" }), 409, request);

  const newRepoText = (existingRepos.concat(repoUrl)).join("\n") + "\n";
  const newDecaText = ((decaText ? decode(decaText).trim().split(/\r?\n/).filter(Boolean) : []).concat(`${name}|${category}|${description}`)).join("\n") + "\n";

  const blob1 = await github(`/repos/${REPO}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content: newRepoText, encoding: "utf-8" }) });
  const blob2 = await github(`/repos/${REPO}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content: newDecaText, encoding: "utf-8" }) });
  const tree = await github(`/repos/${REPO}/git/trees`, token, { method: "POST", body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: [{ path: "repo.txt", mode: "100644", type: "blob", sha: blob1.sha }, { path: "deca.txt", mode: "100644", type: "blob", sha: blob2.sha }] }) });
  const commit = await github(`/repos/${REPO}/git/commits`, token, { method: "POST", body: JSON.stringify({ message: `Add repository: ${name}`, tree: tree.sha, parents: [parentSha] }) });
  await github(`/repos/${REPO}/git/refs/heads/${BRANCH}`, token, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return response(JSON.stringify({ ok: true, commit: commit.sha, repository: repoUrl }), 200, request);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request.headers.get("Origin")) });
    const path = new URL(request.url).pathname;
    try {
      if (path === "/login") return login(request, env);
      if (path === "/callback") return callback(request, env);
      if (path === "/api/me") {
        const user = await sessionUser(request, env);
        return response(JSON.stringify(user ? { loggedIn: true, login: user.login, name: user.name } : { loggedIn: false }), 200, request);
      }
      if (path === "/api/add" && request.method === "POST") return addRepository(request, env);
      return response(JSON.stringify({ service: "New KDroid OAuth Worker", ok: true }), 200, request);
    } catch (e) {
      return response(JSON.stringify({ error: e.message || "Server error" }), 500, request);
    }
  }
};
