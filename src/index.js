import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS_CACHE = new Map();

const SLOTS = Object.freeze({
  space: { label: "매장 공간", fallback: "/assets/images/space.webp" },
  "nail-01": { label: "네일 포트폴리오 01", fallback: "/assets/images/nail-01.webp" },
  "nail-02": { label: "네일 포트폴리오 02", fallback: "/assets/images/nail-02.webp" },
  "nail-03": { label: "네일 포트폴리오 03", fallback: "/assets/images/nail-03.webp" },
  "nail-04": { label: "네일 포트폴리오 04", fallback: "/assets/images/nail-04.webp" },
  "nail-05": { label: "네일 포트폴리오 05", fallback: "/assets/images/nail-05.webp" },
  "nail-06": { label: "네일 포트폴리오 06", fallback: "/assets/images/nail-06.webp" },
  "nail-07": { label: "네일 포트폴리오 07", fallback: "/assets/images/nail-07.webp" },
  "nail-08": { label: "네일 포트폴리오 08", fallback: "/assets/images/nail-08.webp" }
});

const MANIFEST_KEY = "meta/media-manifest.json";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 4096;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/robots.txt") return robotsResponse(url.origin);
      if (path === "/sitemap.xml") return sitemapResponse(url.origin);
      if (path === "/api/media-manifest") return getPublicManifest(env);
      if (path.startsWith("/media/")) return getMedia(request, env, ctx);

      if (path === "/admin" || path.startsWith("/admin/")) {
        const access = await requireAccess(request, env);
        if (access instanceof Response) return access;

        if (path === "/admin/api/me") {
          if (request.method !== "GET") return methodNotAllowed();
          return json({ ok: true, email: access.email }, 200, { "Cache-Control": "no-store" });
        }
        if (path === "/admin/api/manifest") {
          if (request.method !== "GET") return methodNotAllowed();
          const manifest = await readManifest(env);
          return json({ ok: true, manifest, slots: SLOTS }, 200, { "Cache-Control": "no-store" });
        }
        if (path === "/admin/api/upload") {
          if (request.method !== "POST") return methodNotAllowed();
          return uploadMedia(request, env, access.email);
        }

        const assetResponse = await env.ASSETS.fetch(request);
        return withHeaders(assetResponse, {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow, noarchive"
        });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled error", error);
      return json({ ok: false, error: "서버 처리 중 오류가 발생했습니다." }, 500, { "Cache-Control": "no-store" });
    }
  }
};

async function requireAccess(request, env) {
  const teamDomain = normalizeTeamDomain(env.TEAM_DOMAIN);
  const audience = String(env.POLICY_AUD || "").trim();
  if (!teamDomain || !audience) {
    return json({ ok: false, error: "관리자 인증 환경변수가 설정되지 않았습니다." }, 403, {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    });
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return json({ ok: false, error: "Cloudflare Access 인증 토큰이 없습니다." }, 403, {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    });
  }

  try {
    let jwks = JWKS_CACHE.get(teamDomain);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
      JWKS_CACHE.set(teamDomain, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience
    });
    const email = String(payload.email || "").trim().toLowerCase();
    if (!email) throw new Error("missing email claim");

    const allowList = String(env.ADMIN_EMAILS || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (allowList.length && !allowList.includes(email)) {
      return json({ ok: false, error: "관리자 권한이 없는 계정입니다." }, 403, { "Cache-Control": "no-store" });
    }
    return { email };
  } catch (error) {
    console.warn("Access JWT validation failed", error instanceof Error ? error.message : error);
    return json({ ok: false, error: "Cloudflare Access 인증 검증에 실패했습니다." }, 403, {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    });
  }
}

function normalizeTeamDomain(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  return raw.startsWith("https://") ? raw : `https://${raw}`;
}

async function uploadMedia(request, env, email) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (origin && origin !== url.origin) {
    return json({ ok: false, error: "허용되지 않은 Origin입니다." }, 403, { "Cache-Control": "no-store" });
  }
  if (secFetchSite && !["same-origin", "none"].includes(secFetchSite)) {
    return json({ ok: false, error: "교차 사이트 업로드는 허용되지 않습니다." }, 403, { "Cache-Control": "no-store" });
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return json({ ok: false, error: "업로드 요청이 너무 큽니다." }, 413, { "Cache-Control": "no-store" });
  }

  const form = await request.formData();
  const slot = String(form.get("slot") || "");
  const file = form.get("file");

  if (!Object.prototype.hasOwnProperty.call(SLOTS, slot)) {
    return json({ ok: false, error: "허용되지 않은 이미지 슬롯입니다." }, 400, { "Cache-Control": "no-store" });
  }
  if (!(file instanceof File)) {
    return json({ ok: false, error: "이미지 파일이 필요합니다." }, 400, { "Cache-Control": "no-store" });
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: "이미지는 10MB 이하여야 합니다." }, 413, { "Cache-Control": "no-store" });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) {
    return json({ ok: false, error: "실제 파일 형식이 JPG, PNG, WebP 중 하나가 아닙니다." }, 415, { "Cache-Control": "no-store" });
  }

  const dimensions = readImageDimensions(bytes, type);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    return json({ ok: false, error: "이미지 해상도를 확인할 수 없습니다." }, 415, { "Cache-Control": "no-store" });
  }
  if (dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE) {
    return json({ ok: false, error: `저장 이미지의 가로/세로는 ${MAX_IMAGE_EDGE}px 이하여야 합니다.` }, 400, { "Cache-Control": "no-store" });
  }

  const key = `slots/${slot}`;
  const version = Date.now().toString(36);
  const now = new Date().toISOString();

  await env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType: type,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      slot,
      uploadedBy: email,
      uploadedAt: now,
      width: String(dimensions.width),
      height: String(dimensions.height)
    }
  });

  const manifest = await readManifest(env);
  manifest[slot] = {
    version,
    updatedAt: now,
    contentType: type,
    width: dimensions.width,
    height: dimensions.height
  };
  await writeManifest(env, manifest);

  return json({
    ok: true,
    slot,
    version,
    updatedAt: now,
    width: dimensions.width,
    height: dimensions.height,
    mediaUrl: `/media/${encodeURIComponent(slot)}?v=${encodeURIComponent(version)}`
  }, 200, { "Cache-Control": "no-store" });
}

async function getMedia(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();

  const url = new URL(request.url);
  const slot = decodeURIComponent(url.pathname.slice("/media/".length));
  if (!Object.prototype.hasOwnProperty.call(SLOTS, slot)) {
    return new Response("Not found", { status: 404 });
  }

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return request.method === "HEAD" ? headOnly(hit) : hit;

  const object = await env.MEDIA.get(`slots/${slot}`);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  const response = new Response(object.body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return request.method === "HEAD" ? headOnly(response) : response;
}

async function getPublicManifest(env) {
  const manifest = await readManifest(env);
  const publicManifest = {};
  for (const slot of Object.keys(SLOTS)) {
    if (manifest[slot]?.version) publicManifest[slot] = { version: manifest[slot].version };
  }
  return json(publicManifest, 200, {
    "Cache-Control": "no-cache, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff"
  });
}

async function readManifest(env) {
  const object = await env.MEDIA.get(MANIFEST_KEY);
  if (!object) return {};
  try {
    const parsed = await object.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeManifest(env, manifest) {
  await env.MEDIA.put(MANIFEST_KEY, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" }
  });
}

function detectImageType(bytes) {
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return null;
}

function readImageDimensions(bytes, type) {
  if (type === "image/png") {
    return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
  }
  if (type === "image/jpeg") return readJpegDimensions(bytes);
  if (type === "image/webp") return readWebpDimensions(bytes);
  return null;
}

function readJpegDimensions(bytes) {
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    while (bytes[i] === 0xff) i++;
    const marker = bytes[i++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (i + 1 >= bytes.length) break;
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (len < 2 || i + len > bytes.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (i + 7 >= bytes.length) break;
      return { height: (bytes[i + 3] << 8) | bytes[i + 4], width: (bytes[i + 5] << 8) | bytes[i + 6] };
    }
    i += len;
  }
  return null;
}

function readWebpDimensions(bytes) {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    for (let i = 20; i + 9 < Math.min(bytes.length, 40); i++) {
      if (bytes[i] === 0x9d && bytes[i + 1] === 0x01 && bytes[i + 2] === 0x2a) {
        return {
          width: ((bytes[i + 4] << 8) | bytes[i + 3]) & 0x3fff,
          height: ((bytes[i + 6] << 8) | bytes[i + 5]) & 0x3fff
        };
      }
    }
  }
  return null;
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}
function readU32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function robotsResponse(origin) {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin/\n\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }
  });
}

function sitemapResponse(origin) {
  const paths = ["/", "/nail-design/", "/process/", "/portfolio/", "/visit/", "/faq/"];
  const urls = paths.map((p) => `  <url><loc>${escapeXml(origin + p)}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

function escapeXml(value) {
  return value.replace(/[<>&'\"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  return new Response(JSON.stringify(data), { status, headers });
}

function methodNotAllowed() {
  return json({ ok: false, error: "허용되지 않은 메서드입니다." }, 405, { "Cache-Control": "no-store", "Allow": "GET, HEAD, POST" });
}

function withHeaders(response, entries) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(entries)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function headOnly(response) {
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}
