const SLOTS = Object.freeze({
  space: { label: "매장 공간", path: "public/assets/images/space.webp", publicUrl: "/assets/images/space.webp" },
  "nail-01": { label: "네일 포트폴리오 01", path: "public/assets/images/nail-01.webp", publicUrl: "/assets/images/nail-01.webp" },
  "nail-02": { label: "네일 포트폴리오 02", path: "public/assets/images/nail-02.webp", publicUrl: "/assets/images/nail-02.webp" },
  "nail-03": { label: "네일 포트폴리오 03", path: "public/assets/images/nail-03.webp", publicUrl: "/assets/images/nail-03.webp" },
  "nail-04": { label: "네일 포트폴리오 04", path: "public/assets/images/nail-04.webp", publicUrl: "/assets/images/nail-04.webp" },
  "nail-05": { label: "네일 포트폴리오 05", path: "public/assets/images/nail-05.webp", publicUrl: "/assets/images/nail-05.webp" },
  "nail-06": { label: "네일 포트폴리오 06", path: "public/assets/images/nail-06.webp", publicUrl: "/assets/images/nail-06.webp" },
  "nail-07": { label: "네일 포트폴리오 07", path: "public/assets/images/nail-07.webp", publicUrl: "/assets/images/nail-07.webp" },
  "nail-08": { label: "네일 포트폴리오 08", path: "public/assets/images/nail-08.webp", publicUrl: "/assets/images/nail-08.webp" }
});

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 4096;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const SESSION_COOKIE = "__Secure-bellemyu_admin";
const OAUTH_COOKIE = "__Secure-bellemyu_oauth";
const GITHUB_API_VERSION = "2022-11-28";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/robots.txt") return robotsResponse(url.origin);
      if (path === "/sitemap.xml") return sitemapResponse(url.origin);

      if (path === "/admin/auth/start") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return startGitHubLogin(request, env);
      }

      if (path === "/admin/auth/callback") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        return finishGitHubLogin(request, env);
      }

      if (path === "/admin/api/me") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const session = await requireAdminSession(request, env);
        if (session instanceof Response) return session;
        return adminJson({
          ok: true,
          user: { id: session.uid, login: session.login, avatarUrl: session.avatarUrl || "" },
          csrfToken: session.csrf,
          repository: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`
        });
      }

      if (path === "/admin/api/slots") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const session = await requireAdminSession(request, env);
        if (session instanceof Response) return session;
        return adminJson({ ok: true, slots: SLOTS });
      }

      if (path === "/admin/api/upload") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const session = await requireAdminSession(request, env);
        if (session instanceof Response) return session;
        const csrfError = validateCsrfAndOrigin(request, session.csrf);
        if (csrfError) return csrfError;
        return uploadMediaToGitHub(request, env, session);
      }

      if (path === "/admin/api/logout") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const session = await requireAdminSession(request, env);
        if (session instanceof Response) return session;
        const csrfError = validateCsrfAndOrigin(request, session.csrf);
        if (csrfError) return csrfError;
        return adminJson({ ok: true }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE, "/admin") });
      }

      if (path === "/admin" || path.startsWith("/admin/")) {
        const assetResponse = await env.ASSETS.fetch(request);
        return withAdminHeaders(assetResponse);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled error", error);
      if (path.startsWith("/admin")) {
        return adminJson({ ok: false, error: "서버 처리 중 오류가 발생했습니다." }, 500);
      }
      return json({ ok: false, error: "서버 처리 중 오류가 발생했습니다." }, 500);
    }
  }
};

async function startGitHubLogin(request, env) {
  const configError = validateAuthConfig(env);
  if (configError) return adminErrorPage("관리자 로그인 설정이 필요합니다", configError, 503);

  const url = new URL(request.url);
  const state = randomBase64Url(24);
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const now = Math.floor(Date.now() / 1000);
  const oauthState = await signPayload({ state, verifier, iat: now, exp: now + OAUTH_TTL_SECONDS }, sessionSigningSecret(env));

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", String(env.GITHUB_APP_CLIENT_ID));
  authorize.searchParams.set("redirect_uri", `${url.origin}/admin/auth/callback`);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  return new Response(null, {
    status: 302,
    headers: adminHeaders({
      Location: authorize.toString(),
      "Set-Cookie": makeCookie(OAUTH_COOKIE, oauthState, {
        path: "/admin/auth",
        maxAge: OAUTH_TTL_SECONDS,
        sameSite: "Lax"
      })
    })
  });
}

async function finishGitHubLogin(request, env) {
  const configError = validateAuthConfig(env);
  if (configError) return adminErrorPage("관리자 로그인 설정이 필요합니다", configError, 503);

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return adminErrorPage("GitHub 로그인이 취소되었습니다", "GitHub 인증을 다시 시도해 주세요.", 401, clearCookie(OAUTH_COOKIE, "/admin/auth"));
  }

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthCookie = getCookie(request, OAUTH_COOKIE);
  if (!code || !state || !oauthCookie) {
    return adminErrorPage("로그인 요청을 확인할 수 없습니다", "관리자 페이지에서 다시 로그인해 주세요.", 400, clearCookie(OAUTH_COOKIE, "/admin/auth"));
  }

  const oauthState = await verifyPayload(oauthCookie, sessionSigningSecret(env));
  const now = Math.floor(Date.now() / 1000);
  if (!oauthState || oauthState.exp < now || !timingSafeEqualString(state, String(oauthState.state || ""))) {
    return adminErrorPage("로그인 요청이 만료되었거나 올바르지 않습니다", "관리자 페이지에서 다시 로그인해 주세요.", 401, clearCookie(OAUTH_COOKIE, "/admin/auth"));
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "bellemyunail-admin-worker"
    },
    body: new URLSearchParams({
      client_id: String(env.GITHUB_APP_CLIENT_ID),
      client_secret: String(env.GITHUB_APP_CLIENT_SECRET),
      code,
      redirect_uri: `${url.origin}/admin/auth/callback`,
      code_verifier: String(oauthState.verifier || "")
    })
  });

  const tokenData = await tokenResponse.json().catch(() => ({}));
  const userToken = String(tokenData?.access_token || "");
  if (!tokenResponse.ok || !userToken) {
    console.warn("GitHub OAuth token exchange failed", tokenResponse.status, tokenData?.error || tokenData?.error_description || "");
    return adminErrorPage("GitHub 인증에 실패했습니다", "GitHub App의 Client ID/Secret과 Callback URL을 확인해 주세요.", 401, clearCookie(OAUTH_COOKIE, "/admin/auth"));
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: githubHeaders(userToken)
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user?.id || !user?.login) {
    return adminErrorPage("GitHub 사용자 정보를 확인하지 못했습니다", "다시 로그인해 주세요.", 401, clearCookie(OAUTH_COOKIE, "/admin/auth"));
  }

  if (String(user.id) !== String(env.ADMIN_GITHUB_USER_ID)) {
    console.warn("Rejected non-admin GitHub user", user.id, user.login);
    return adminErrorPage("관리자 계정이 아닙니다", "등록된 GitHub 관리자 계정만 사용할 수 있습니다.", 403, clearCookie(OAUTH_COOKIE, "/admin/auth"));
  }

  const csrf = randomBase64Url(24);
  const sessionPayload = {
    uid: String(user.id),
    login: String(user.login),
    avatarUrl: String(user.avatar_url || ""),
    csrf,
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  };
  const sessionToken = await signPayload(sessionPayload, sessionSigningSecret(env));

  const headers = adminHeaders({
    Location: "/admin/"
  });
  headers.append("Set-Cookie", makeCookie(SESSION_COOKIE, sessionToken, {
    path: "/admin",
    maxAge: SESSION_TTL_SECONDS,
    sameSite: "Strict"
  }));
  headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE, "/admin/auth"));

  return new Response(null, { status: 302, headers });
}

async function requireAdminSession(request, env) {
  const configError = validateSessionConfig(env);
  if (configError) return adminJson({ ok: false, error: configError, loginRequired: true }, 503);

  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return adminJson({ ok: false, error: "로그인이 필요합니다.", loginRequired: true, loginUrl: "/admin/auth/start" }, 401);

  const payload = await verifyPayload(token, sessionSigningSecret(env));
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.exp < now || String(payload.uid) !== String(env.ADMIN_GITHUB_USER_ID)) {
    return adminJson({ ok: false, error: "관리자 세션이 만료되었습니다.", loginRequired: true, loginUrl: "/admin/auth/start" }, 401, {
      "Set-Cookie": clearCookie(SESSION_COOKIE, "/admin")
    });
  }
  if (!payload.csrf || !payload.login) {
    return adminJson({ ok: false, error: "관리자 세션이 올바르지 않습니다.", loginRequired: true }, 401, {
      "Set-Cookie": clearCookie(SESSION_COOKIE, "/admin")
    });
  }
  return payload;
}

function validateCsrfAndOrigin(request, expectedCsrf) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  const csrf = request.headers.get("X-CSRF-Token") || "";

  if (!origin || origin !== url.origin) {
    return adminJson({ ok: false, error: "허용되지 않은 Origin입니다." }, 403);
  }
  if (secFetchSite && !["same-origin", "none"].includes(secFetchSite)) {
    return adminJson({ ok: false, error: "교차 사이트 요청은 허용되지 않습니다." }, 403);
  }
  if (!csrf || !timingSafeEqualString(csrf, String(expectedCsrf || ""))) {
    return adminJson({ ok: false, error: "CSRF 검증에 실패했습니다. 페이지를 새로고침해 주세요." }, 403);
  }
  return null;
}

async function uploadMediaToGitHub(request, env, session) {
  const configError = validateGitHubWriteConfig(env);
  if (configError) return adminJson({ ok: false, error: configError }, 503);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return adminJson({ ok: false, error: "업로드 요청이 너무 큽니다." }, 413);
  }

  const form = await request.formData();
  const slot = String(form.get("slot") || "");
  const file = form.get("file");
  const slotInfo = SLOTS[slot];

  if (!slotInfo) return adminJson({ ok: false, error: "허용되지 않은 이미지 슬롯입니다." }, 400);
  if (!(file instanceof File)) return adminJson({ ok: false, error: "이미지 파일이 필요합니다." }, 400);
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return adminJson({ ok: false, error: "이미지는 10MB 이하여야 합니다." }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (type !== "image/webp") return adminJson({ ok: false, error: "관리자 업로드 결과는 WebP 이미지여야 합니다." }, 415);

  const dimensions = readImageDimensions(bytes, type);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    return adminJson({ ok: false, error: "이미지 해상도를 확인할 수 없습니다." }, 415);
  }
  if (dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE) {
    return adminJson({ ok: false, error: `저장 이미지의 가로/세로는 ${MAX_IMAGE_EDGE}px 이하여야 합니다.` }, 400);
  }

  const installationToken = await createInstallationToken(env);
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH || "main").trim();
  const githubPath = slotInfo.path;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${githubPath.split("/").map(encodeURIComponent).join("/")}`;
  const headers = githubHeaders(installationToken);

  const currentRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!currentRes.ok) {
    const detail = await safeGitHubError(currentRes);
    return adminJson({ ok: false, error: `GitHub에서 현재 파일을 확인하지 못했습니다. ${detail}` }, 502);
  }
  const current = await currentRes.json();
  if (!current?.sha) return adminJson({ ok: false, error: "GitHub 파일 SHA를 확인하지 못했습니다." }, 502);

  const updateRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `chore(images): update ${slot} via bellemyunail admin (${session.login})`,
      content: bytesToBase64(bytes),
      sha: current.sha,
      branch
    })
  });

  if (!updateRes.ok) {
    const detail = await safeGitHubError(updateRes);
    return adminJson({ ok: false, error: `GitHub에 이미지를 저장하지 못했습니다. ${detail}` }, 502);
  }

  const updated = await updateRes.json();
  return adminJson({
    ok: true,
    slot,
    updatedAt: new Date().toISOString(),
    width: dimensions.width,
    height: dimensions.height,
    publicUrl: `${slotInfo.publicUrl}?v=${encodeURIComponent(updated?.commit?.sha || Date.now())}`,
    commitUrl: updated?.commit?.html_url || null,
    message: "GitHub 저장 완료. Cloudflare 자동 재배포가 끝나면 공개 사이트에 반영됩니다."
  });
}

async function createInstallationToken(env) {
  const jwt = await createGitHubAppJwt(env.GITHUB_APP_CLIENT_ID, env.GITHUB_APP_PRIVATE_KEY);
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const appHeaders = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${jwt}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "bellemyunail-admin-worker"
  };

  const installationResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`, {
    headers: appHeaders
  });
  const installation = await installationResponse.json().catch(() => ({}));
  if (!installationResponse.ok || !installation?.id) {
    console.warn("Failed to find GitHub App installation", installationResponse.status, installation?.message || "");
    throw new Error("GitHub App이 bellemyunail1 저장소에 설치되어 있는지 확인해 주세요.");
  }

  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(String(installation.id))}/access_tokens`, {
    method: "POST",
    headers: {
      ...appHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      repositories: [repo],
      permissions: { contents: "write" }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) {
    console.warn("Failed to create GitHub installation token", response.status, data?.message || "");
    throw new Error("GitHub App 설치 토큰을 만들지 못했습니다. App 설치 범위와 Private Key를 확인해 주세요.");
  }
  return String(data.token);
}

async function createGitHubAppJwt(clientId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncodeText(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(clientId) }));
  const unsigned = `${header}.${payload}`;

  const keyData = pemPrivateKeyToPkcs8(String(privateKeyPem || ""));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function pemPrivateKeyToPkcs8(pem) {
  const normalized = pem.replace(/\\n/g, "\n").trim();
  if (!normalized) throw new Error("GitHub App Private Key가 설정되지 않았습니다.");

  if (normalized.includes("BEGIN PRIVATE KEY")) {
    return pemBodyToBytes(normalized, "PRIVATE KEY");
  }
  if (normalized.includes("BEGIN RSA PRIVATE KEY")) {
    const pkcs1 = pemBodyToBytes(normalized, "RSA PRIVATE KEY");
    return wrapPkcs1AsPkcs8(pkcs1);
  }
  throw new Error("지원하지 않는 GitHub App Private Key 형식입니다.");
}

function pemBodyToBytes(pem, label) {
  const base64 = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function wrapPkcs1AsPkcs8(pkcs1) {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00
  ]);
  const privateKeyOctet = concatBytes(new Uint8Array([0x04]), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithmIdentifier, privateKeyOctet);
  return concatBytes(new Uint8Array([0x30]), derLength(body.length), body);
}

function derLength(length) {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function validateAuthConfig(env) {
  const missing = [];
  if (!String(env.GITHUB_APP_CLIENT_ID || "").trim()) missing.push("GITHUB_APP_CLIENT_ID");
  if (!String(env.GITHUB_APP_CLIENT_SECRET || "").trim()) missing.push("GITHUB_APP_CLIENT_SECRET");
  if (!String(env.ADMIN_GITHUB_USER_ID || "").trim()) missing.push("ADMIN_GITHUB_USER_ID");
  return missing.length ? `Worker Secret 설정이 필요합니다: ${missing.join(", ")}` : "";
}

function validateSessionConfig(env) {
  const missing = [];
  if (!String(env.GITHUB_APP_CLIENT_SECRET || "").trim()) missing.push("GITHUB_APP_CLIENT_SECRET");
  if (!String(env.ADMIN_GITHUB_USER_ID || "").trim()) missing.push("ADMIN_GITHUB_USER_ID");
  return missing.length ? `Worker Secret 설정이 필요합니다: ${missing.join(", ")}` : "";
}

function validateGitHubWriteConfig(env) {
  const missing = [];
  if (!String(env.GITHUB_APP_CLIENT_ID || "").trim()) missing.push("GITHUB_APP_CLIENT_ID");
  if (!String(env.GITHUB_APP_PRIVATE_KEY || "").trim()) missing.push("GITHUB_APP_PRIVATE_KEY");
  if (!String(env.GITHUB_OWNER || "").trim()) missing.push("GITHUB_OWNER");
  if (!String(env.GITHUB_REPO || "").trim()) missing.push("GITHUB_REPO");
  return missing.length ? `GitHub App 업로드 설정이 필요합니다: ${missing.join(", ")}` : "";
}

function sessionSigningSecret(env) {
  const clientSecret = String(env.GITHUB_APP_CLIENT_SECRET || "").trim();
  if (!clientSecret) throw new Error("GITHUB_APP_CLIENT_SECRET이 설정되지 않았습니다.");
  return `bellemyunail-session-v1:${clientSecret}`;
}

async function signPayload(payload, secret) {
  const body = base64UrlEncodeText(JSON.stringify(payload));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function verifyPayload(token, secret) {
  try {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;
    const key = await importHmacKey(secret);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecodeBytes(signature),
      new TextEncoder().encode(body)
    );
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(body)));
  } catch {
    return null;
  }
}

function importHmacKey(secret) {
  const value = String(secret || "");
  if (value.length < 24) throw new Error("세션 서명용 비밀값이 올바르지 않습니다.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function base64UrlEncodeText(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeBytes(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqualString(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

function makeCookie(name, value, { path = "/", maxAge, sameSite = "Strict" } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    "HttpOnly",
    "Secure",
    `SameSite=${sameSite}`
  ];
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join("; ");
}

function clearCookie(name, path) {
  return `${name}=; Path=${path}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "bellemyunail-admin-worker"
  };
}

async function safeGitHubError(response) {
  try {
    const data = await response.json();
    const message = String(data?.message || "").slice(0, 180);
    return message ? `(${response.status}: ${message})` : `(${response.status})`;
  } catch {
    return `(${response.status})`;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function detectImageType(bytes) {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return "";
}

function readImageDimensions(bytes, type) {
  try {
    if (type === "image/webp") return readWebpDimensions(bytes);
    if (type === "image/png" && bytes.length >= 24) return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
    if (type === "image/jpeg") return readJpegDimensions(bytes);
  } catch {}
  return null;
}

function readWebpDimensions(b) {
  const chunk = ascii(b, 12, 16);
  if (chunk === "VP8X" && b.length >= 30) {
    return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  }
  if (chunk === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function readJpegDimensions(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    i += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (i + 1 >= b.length) return null;
    const length = (b[i] << 8) | b[i + 1];
    if (length < 2 || i + length > b.length) return null;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { height: (b[i + 3] << 8) | b[i + 4], width: (b[i + 5] << 8) | b[i + 6] };
    }
    i += length;
  }
  return null;
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}
function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
function u24le(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }
function u32be(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

function robotsResponse(origin) {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }
  });
}

function sitemapResponse(origin) {
  const urls = ["/", "/nail-design/", "/process/", "/portfolio/", "/visit/", "/faq/"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((p) => `\n  <url><loc>${escapeXml(origin + p)}</loc></url>`).join("")}\n</urlset>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" }
  });
}

function escapeXml(value) {
  return String(value).replace(/[<>&'\"]/g, (c) => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", '"':"&quot;" }[c]));
}

function methodNotAllowed(allow = "GET, POST") {
  return adminJson({ ok: false, error: "허용되지 않은 요청 방식입니다." }, 405, { Allow: allow });
}

function withAdminHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of adminHeaders()) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function adminHeaders(extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob: https://avatars.githubusercontent.com; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com"
  });
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

function adminJson(data, status = 200, extraHeaders = {}) {
  const headers = adminHeaders({ "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  return new Response(JSON.stringify(data), { status, headers });
}

function adminErrorPage(title, message, status = 400, setCookie = "") {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${safeTitle}</title><link rel="stylesheet" href="/admin/admin.css"></head><body><div class="wrap"><main><section class="login-card"><p class="eyebrow">BELLEMYU NAIL ADMIN</p><h1>${safeTitle}</h1><p>${safeMessage}</p><a class="github-login" href="/admin/">관리자 페이지로 돌아가기</a></section></main></div></body></html>`;
  const headers = adminHeaders({ "Content-Type": "text/html; charset=utf-8" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(html, { status, headers });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
}
