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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/robots.txt") return robotsResponse(url.origin);
      if (path === "/sitemap.xml") return sitemapResponse(url.origin);

      if (path === "/admin" || path.startsWith("/admin/")) {
        const access = await requireAccess(ctx);
        if (access instanceof Response) return access;

        if (path === "/admin/api/me") {
          if (request.method !== "GET") return methodNotAllowed();
          return json({ ok: true, email: access.email }, 200, { "Cache-Control": "no-store" });
        }

        if (path === "/admin/api/slots") {
          if (request.method !== "GET") return methodNotAllowed();
          return json({ ok: true, slots: SLOTS }, 200, { "Cache-Control": "no-store" });
        }

        if (path === "/admin/api/upload") {
          if (request.method !== "POST") return methodNotAllowed();
          return uploadMediaToGitHub(request, env, access.email);
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

async function requireAccess(ctx) {
  if (!ctx.access) {
    return json({ ok: false, error: "관리자 페이지는 Cloudflare Access 설정 후 사용할 수 있습니다." }, 403, {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    });
  }

  try {
    const identity = await ctx.access.getIdentity();
    const email = String(identity?.email || "").trim().toLowerCase();
    if (!email) throw new Error("missing Access identity email");
    return { email };
  } catch (error) {
    console.warn("Access identity validation failed", error instanceof Error ? error.message : error);
    return json({ ok: false, error: "Cloudflare Access 인증 정보를 확인하지 못했습니다." }, 403, {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    });
  }
}

async function uploadMediaToGitHub(request, env, email) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (origin && origin !== url.origin) {
    return json({ ok: false, error: "허용되지 않은 Origin입니다." }, 403, { "Cache-Control": "no-store" });
  }
  if (secFetchSite && !["same-origin", "none"].includes(secFetchSite)) {
    return json({ ok: false, error: "교차 사이트 업로드는 허용되지 않습니다." }, 403, { "Cache-Control": "no-store" });
  }

  const token = String(env.GITHUB_TOKEN || "").trim();
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH || "main").trim();
  if (!token || !owner || !repo || !branch) {
    return json({ ok: false, error: "GitHub 업로드 설정이 아직 완료되지 않았습니다." }, 503, { "Cache-Control": "no-store" });
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return json({ ok: false, error: "업로드 요청이 너무 큽니다." }, 413, { "Cache-Control": "no-store" });
  }

  const form = await request.formData();
  const slot = String(form.get("slot") || "");
  const file = form.get("file");
  const slotInfo = SLOTS[slot];

  if (!slotInfo) {
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
  if (!type || type !== "image/webp") {
    return json({ ok: false, error: "관리자 업로드 결과는 WebP 이미지여야 합니다." }, 415, { "Cache-Control": "no-store" });
  }

  const dimensions = readImageDimensions(bytes, type);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    return json({ ok: false, error: "이미지 해상도를 확인할 수 없습니다." }, 415, { "Cache-Control": "no-store" });
  }
  if (dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE) {
    return json({ ok: false, error: `저장 이미지의 가로/세로는 ${MAX_IMAGE_EDGE}px 이하여야 합니다.` }, 400, { "Cache-Control": "no-store" });
  }

  const githubPath = slotInfo.path;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${githubPath.split("/").map(encodeURIComponent).join("/")}`;
  const headers = githubHeaders(token);

  const currentRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!currentRes.ok) {
    const detail = await safeGitHubError(currentRes);
    return json({ ok: false, error: `GitHub에서 현재 파일을 확인하지 못했습니다. ${detail}` }, 502, { "Cache-Control": "no-store" });
  }
  const current = await currentRes.json();
  if (!current?.sha) {
    return json({ ok: false, error: "GitHub 파일 SHA를 확인하지 못했습니다." }, 502, { "Cache-Control": "no-store" });
  }

  const commitMessage = `chore(images): update ${slot} via admin`;
  const updateRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content: bytesToBase64(bytes),
      sha: current.sha,
      branch
    })
  });

  if (!updateRes.ok) {
    const detail = await safeGitHubError(updateRes);
    return json({ ok: false, error: `GitHub에 이미지를 저장하지 못했습니다. ${detail}` }, 502, { "Cache-Control": "no-store" });
  }

  const updated = await updateRes.json();
  const now = new Date().toISOString();
  return json({
    ok: true,
    slot,
    updatedAt: now,
    width: dimensions.width,
    height: dimensions.height,
    publicUrl: `${slotInfo.publicUrl}?v=${encodeURIComponent(updated?.commit?.sha || Date.now())}`,
    commitUrl: updated?.commit?.html_url || null,
    message: "GitHub 저장 완료. Cloudflare 자동 재배포가 끝나면 공개 사이트에 반영됩니다."
  }, 200, { "Cache-Control": "no-store" });
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
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

function methodNotAllowed() {
  return json({ ok: false, error: "허용되지 않은 요청 방식입니다." }, 405, { Allow: "GET, POST" });
}

function withHeaders(response, values) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(values)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
