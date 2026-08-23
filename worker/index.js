const ADMIN_LOGIN = "konyakpivo-wq";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (url.pathname === "/login") {
      return githubLogin(env);
    }

    if (url.pathname === "/callback") {
      return githubCallback(request, env);
    }

    if (url.pathname === "/api/me") {
      return checkSession(request, env);
    }

    if (url.pathname === "/logout") {
      return logout();
    }

    if (url.pathname === "/api/add" && request.method === "POST") {
      return addRepository(request, env);
    }

    return new Response("New KDroid Worker", {
      status: 200
    });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      "https://konyakpivo-wq.github.io",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Content-Type",
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS"
  };
}

function githubLogin(env) {

  const redirect =
    "https://new-kdoid.konyakpivo.workers.dev/callback";

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirect,
    scope: "repo read:user"
  });

  return Response.redirect(
    "https://github.com/login/oauth/authorize?" +
    params.toString(),
    302
  );
}

async function githubCallback(request, env) {

  const url = new URL(request.url);

  const code = url.searchParams.get("code");

  if (!code) {
    return new Response(
      "GitHub authorization code missing",
      { status: 400 }
    );
  }

  // Получаем access token
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",

      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code
      })
    }
  );

  const tokenData =
    await tokenResponse.json();

  if (!tokenData.access_token) {
    return new Response(
      "GitHub authorization failed",
      { status: 401 }
    );
  }

  // Получаем GitHub аккаунт
  const userResponse = await fetch(
    "https://api.github.com/user",
    {
      headers: {
        "Authorization":
          `Bearer ${tokenData.access_token}`,

        "Accept":
          "application/vnd.github+json",

        "User-Agent":
          "New-KDroid"
      }
    }
  );

  const user = await userResponse.json();

  // Проверяем администратора
  if (user.login !== ADMIN_LOGIN) {

    return new Response(
      "Доступ запрещён. Этот GitHub аккаунт не является администратором.",
      { status: 403 }
    );
  }

  // Сохраняем токен в зашифрованном cookie.
  // Для простоты здесь используется подписанная
  // сессия через SESSION_SECRET.
  const session = await createSession(
    user.login,
    tokenData.access_token,
    env.SESSION_SECRET
  );

  return new Response(null, {
    status: 302,

    headers: {
      "Location":
        "https://konyakpivo-wq.github.io/new_kdord/admin.html",

      "Set-Cookie":
        `new_kdroid_session=${session}; ` +
        `HttpOnly; Secure; SameSite=None; Path=/; Max-Age=86400`
    }
  });
}

async function checkSession(request, env) {

  const cookies =
    request.headers.get("Cookie") || "";

  const session =
    getCookie(cookies, "new_kdroid_session");

  if (!session) {
    return json({
      authenticated: false
    }, 401);
  }

  const data =
    await verifySession(
      session,
      env.SESSION_SECRET
    );

  if (!data || data.login !== ADMIN_LOGIN) {
    return json({
      authenticated: false
    }, 401);
  }

  return json({
    authenticated: true,
    login: data.login
  });
}

async function logout() {

  return new Response(
    JSON.stringify({
      authenticated: false
    }),

    {
      status: 200,

      headers: {
        "Content-Type":
          "application/json",

        "Set-Cookie":
          "new_kdroid_session=; " +
          "HttpOnly; Secure; SameSite=None; " +
          "Path=/; Max-Age=0",

        ...corsHeaders()
      }
    }
  );
}

async function addRepository(request, env) {

  const cookies =
    request.headers.get("Cookie") || "";

  const session =
    getCookie(
      cookies,
      "new_kdroid_session"
    );

  if (!session) {
    return json({
      error: "Unauthorized"
    }, 401);
  }

  const data =
    await verifySession(
      session,
      env.SESSION_SECRET
    );

  if (!data || data.login !== ADMIN_LOGIN) {
    return json({
      error: "Forbidden"
    }, 403);
  }

  // Здесь позже подключим GitHub API
  // для изменения repo.txt и deca.txt.

  return json({
    success: true,
    message:
      "Администратор подтверждён."
  });
}

async function createSession(
  login,
  token,
  secret
) {

  const payload = {
    login,
    token,
    exp:
      Date.now() +
      86400000
  };

  const encoded =
    btoa(JSON.stringify(payload));

  const signature =
    await sign(encoded, secret);

  return encoded + "." + signature;
}

async function verifySession(
  session,
  secret
) {

  try {

    const parts =
      session.split(".");

    if (parts.length !== 2)
      return null;

    const payload =
      parts[0];

    const signature =
      parts[1];

    const expected =
      await sign(
        payload,
        secret
      );

    if (signature !== expected)
      return null;

    const data =
      JSON.parse(
        atob(payload)
      );

    if (data.exp < Date.now())
      return null;

    return data;

  } catch {
    return null;
  }
}

async function sign(
  text,
  secret
) {

  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(text)
    );

  return btoa(
    String.fromCharCode(
      ...new Uint8Array(signature)
    )
  );
}

function getCookie(
  cookies,
  name
) {

  const match =
    cookies.match(
      new RegExp(
        "(?:^|; )" +
        name +
        "=([^;]*)"
      )
    );

  return match
    ? match[1]
    : null;
}

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),

    {
      status,

      headers: {
        "Content-Type":
          "application/json",

        ...corsHeaders()
      }
    }
  );
}
