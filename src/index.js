const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 4096;
const MAX_BATCH_BYTES = 30 * 1024 * 1024;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const SESSION_COOKIE = "__Secure-bellemyu_admin";
const OAUTH_COOKIE = "__Secure-bellemyu_oauth";
const GITHUB_API_VERSION = "2022-11-28";
const EDIT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MEDIA_SLOT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_TEXT_LENGTH = 1200;

const STATIC_PAGES = Object.freeze([
  { id: "home", label: "홈", publicPath: "/", repoPath: "public/index.html" },
  { id: "design", label: "네일 디자인", publicPath: "/nail-design/", repoPath: "public/nail-design/index.html" },
  { id: "process", label: "시술 과정", publicPath: "/process/", repoPath: "public/process/index.html" },
  { id: "portfolio", label: "포트폴리오", publicPath: "/portfolio/", repoPath: "public/portfolio/index.html" },
  { id: "visit", label: "방문 안내", publicPath: "/visit/", repoPath: "public/visit/index.html" },
  { id: "faq", label: "자주 묻는 질문", publicPath: "/faq/", repoPath: "public/faq/index.html" }
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
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
      if (path === "/admin/api/editor-state") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const session = await requireAdminSession(request, env);
        if (session instanceof Response) return session;
        return getEditorState(request, env, session);
      }
      if (path === "/admin/api/preview") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        const session = await requireAdminSession(request, env);
        if (session instanceof Response) return previewLoginExpired();
        return getSecurePreview(request, env);
      }
      if (path === "/admin/api/save") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const session = await requireAdminSession(request, env);
        if (session instanceof Response) return session;
        const csrfError = validateCsrfAndOrigin(request, session.csrf);
        if (csrfError) return csrfError;
        return saveEditorChanges(request, env, session);
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
      if (path.startsWith("/admin")) return adminJson({ ok: false, error: "서버 처리 중 오류가 발생했습니다." }, 500);
      return json({ ok: false, error: "서버 처리 중 오류가 발생했습니다." }, 500);
    }
  }
};

async function getEditorState(request, env, session) {
  const configError = validateGitHubWriteConfig(env);
  if (configError) return adminJson({ ok: false, error: configError }, 503);

  let token = "";
  try {
    token = await createInstallationToken(env);
    const snapshot = await loadRepositorySnapshot(env, token);
    const model = discoverEditorModel(snapshot.pages);
    return adminJson({
      ok: true,
      user: { id: session.uid, login: session.login, avatarUrl: session.avatarUrl || "" },
      csrfToken: session.csrf,
      repository: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      baseSha: snapshot.headSha,
      pages: STATIC_PAGES.map(({ id, label, publicPath }) => ({ id, label, path: publicPath })),
      text: model.text,
      images: model.images,
      stats: model.stats
    });
  } catch (error) {
    console.error("Editor state discovery failed", error);
    return adminJson({ ok: false, error: String(error?.message || "편집 항목을 자동 탐색하지 못했습니다.").slice(0, 500) }, 502);
  } finally {
    if (token) await revokeInstallationToken(token);
  }
}

async function getSecurePreview(request, env) {
  const url = new URL(request.url);
  const pageId = String(url.searchParams.get("page") || "home");
  const bridgeNonce = String(url.searchParams.get("nonce") || "");
  const page = STATIC_PAGES.find((item) => item.id === pageId);
  if (!page || !/^[A-Za-z0-9_-]{16,100}$/.test(bridgeNonce)) {
    return previewError("미리보기 요청이 올바르지 않습니다.", 400);
  }

  let token = "";
  try {
    token = await createInstallationToken(env);
    const headSha = await getRepositoryHeadSha(env, token);
    const html = await getRepositoryTextFile(env, token, page.repoPath, headSha);
    return buildSandboxPreview(html, url.origin, bridgeNonce);
  } catch (error) {
    console.error("Secure preview failed", error);
    return previewError("미리보기를 불러오지 못했습니다. 관리자 화면을 새로고침해 주세요.", 502);
  } finally {
    if (token) await revokeInstallationToken(token);
  }
}

async function saveEditorChanges(request, env, session) {
  const configError = validateGitHubWriteConfig(env);
  if (configError) return adminJson({ ok: false, error: configError }, 503);

  const declaredSize = Number(request.headers.get("Content-Length") || 0);
  if (declaredSize && declaredSize > MAX_BATCH_BYTES + 2 * 1024 * 1024) {
    return adminJson({ ok: false, error: "한 번에 저장하는 변경사항이 너무 큽니다. 사진 수를 나눠 저장해 주세요." }, 413);
  }

  const form = await request.formData();
  const raw = form.get("changes");
  if (typeof raw !== "string") return adminJson({ ok: false, error: "변경 데이터가 필요합니다." }, 400);

  let submitted;
  try { submitted = JSON.parse(raw); } catch { return adminJson({ ok: false, error: "변경 데이터 형식이 올바르지 않습니다." }, 400); }
  const baseSha = String(submitted?.baseSha || "");
  const textChanges = submitted?.text && typeof submitted.text === "object" && !Array.isArray(submitted.text) ? submitted.text : {};
  if (!/^[0-9a-f]{40}$/i.test(baseSha)) return adminJson({ ok: false, error: "편집 기준 커밋을 확인할 수 없습니다. 관리자 페이지를 새로고침해 주세요." }, 409);

  let token = "";
  try {
    token = await createInstallationToken(env);
    const currentHeadSha = await getRepositoryHeadSha(env, token);
    if (!timingSafeEqualString(currentHeadSha, baseSha)) {
      return adminJson({
        ok: false,
        code: "STALE_EDITOR",
        error: "편집을 시작한 뒤 GitHub 저장소가 변경되었습니다. 다른 변경을 덮어쓰지 않도록 저장을 중단했습니다. 관리자 페이지를 새로고침한 뒤 다시 수정해 주세요."
      }, 409);
    }

    const pages = await loadRepositoryPages(env, token, currentHeadSha);
    const model = discoverEditorModel(pages);
    const normalizedTextChanges = {};

    for (const [key, value] of Object.entries(textChanges)) {
      const meta = model.text[key];
      if (!meta || !EDIT_KEY_PATTERN.test(key)) return adminJson({ ok: false, error: `허용되지 않은 문구 키입니다: ${key}` }, 400);
      if (typeof value !== "string") return adminJson({ ok: false, error: `문구 값이 올바르지 않습니다: ${key}` }, 400);
      if (value.length > meta.maxLength) return adminJson({ ok: false, error: `문구가 너무 깁니다: ${meta.label}` }, 400);
      if (value !== meta.value) normalizedTextChanges[key] = value;
    }

    const imageChanges = [];
    let totalImageBytes = 0;
    for (const [name, value] of form.entries()) {
      if (!name.startsWith("image:") || !(value instanceof File)) continue;
      const slot = name.slice("image:".length);
      const meta = model.images[slot];
      if (!meta || !MEDIA_SLOT_PATTERN.test(slot) || !isSafeMediaBinding(slot, meta.publicUrl)) {
        return adminJson({ ok: false, error: `허용되지 않은 이미지 슬롯입니다: ${slot}` }, 400);
      }
      if (value.size <= 0 || value.size > MAX_UPLOAD_BYTES) return adminJson({ ok: false, error: `${meta.label} 이미지는 10MB 이하여야 합니다.` }, 413);
      totalImageBytes += value.size;
      if (totalImageBytes > MAX_BATCH_BYTES) return adminJson({ ok: false, error: "변경할 사진의 총 용량이 너무 큽니다." }, 413);
      const bytes = new Uint8Array(await value.arrayBuffer());
      const type = detectImageType(bytes);
      if (type !== "image/webp") return adminJson({ ok: false, error: `${meta.label} 저장 파일은 WebP여야 합니다.` }, 415);
      const dimensions = readImageDimensions(bytes, type);
      if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return adminJson({ ok: false, error: `${meta.label} 이미지 해상도를 확인할 수 없습니다.` }, 415);
      if (dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE) return adminJson({ ok: false, error: `${meta.label} 이미지의 가로/세로는 ${MAX_IMAGE_EDGE}px 이하여야 합니다.` }, 400);
      imageChanges.push({ slot, path: meta.repoPath, publicUrl: meta.publicUrl, bytes, width: dimensions.width, height: dimensions.height });
    }

    if (Object.keys(normalizedTextChanges).length === 0 && imageChanges.length === 0) {
      return adminJson({ ok: true, noChanges: true, baseSha: currentHeadSha, message: "변경된 내용이 없습니다." });
    }

    const version = String(Date.now());
    const changedSlots = new Set(imageChanges.map((item) => item.slot));
    const files = [];
    for (const page of pages) {
      const html = await applyEditorChangesToHtml(page.html, normalizedTextChanges, changedSlots, model.images, version);
      if (html !== page.html) files.push({ path: page.repoPath, bytes: new TextEncoder().encode(html) });
    }
    for (const image of imageChanges) files.push({ path: image.path, bytes: image.bytes });

    const result = await commitFilesToGitHubWithToken(
      env,
      token,
      files,
      `chore(site): publish visual editor changes (${session.login})`,
      currentHeadSha
    );

    return adminJson({
      ok: true,
      commitSha: result.sha,
      commitUrl: result.url,
      baseSha: result.sha,
      changedTextKeys: Object.keys(normalizedTextChanges),
      changedImages: imageChanges.map(({ slot, width, height }) => ({ slot, width, height })),
      changedPages: files.filter((file) => file.path.endsWith(".html")).map((file) => file.path),
      message: "GitHub에 한 번의 커밋으로 저장했습니다. Cloudflare 자동 배포가 끝나면 공개 사이트에 반영됩니다."
    });
  } catch (error) {
    console.error("Visual editor save failed", error);
    return adminJson({ ok: false, error: String(error?.message || "GitHub 저장에 실패했습니다.").slice(0, 500) }, 502);
  } finally {
    if (token) await revokeInstallationToken(token);
  }
}

async function loadRepositorySnapshot(env, token) {
  const headSha = await getRepositoryHeadSha(env, token);
  const pages = await loadRepositoryPages(env, token, headSha);
  return { headSha, pages };
}

async function loadRepositoryPages(env, token, ref) {
  return Promise.all(STATIC_PAGES.map(async (page) => ({
    ...page,
    html: await getRepositoryTextFile(env, token, page.repoPath, ref)
  })));
}

async function getRepositoryHeadSha(env, token) {
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH || "main").trim();
  const headers = githubHeaders(token);
  const branchPath = branch.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${branchPath}`, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.object?.sha) throw new Error(`GitHub 브랜치 정보를 확인하지 못했습니다. ${await responseDetail(response, data)}`);
  return String(data.object.sha);
}

async function getRepositoryTextFile(env, token, repoPath, ref) {
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
    headers: githubHeaders(token)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.type !== "file" || data?.encoding !== "base64" || typeof data?.content !== "string") {
    throw new Error(`GitHub에서 ${repoPath} 파일을 읽지 못했습니다. ${await responseDetail(response, data)}`);
  }
  return base64ToUtf8(data.content);
}

function discoverEditorModel(pages) {
  const text = Object.create(null);
  const images = Object.create(null);
  let textOccurrences = 0;
  let imageOccurrences = 0;

  for (const page of pages) {
    const textMarkers = extractTextMarkers(page.html);
    for (const marker of textMarkers) {
      if (!EDIT_KEY_PATTERN.test(marker.key)) continue;
      textOccurrences++;
      const label = marker.label || marker.key;
      const section = marker.section || sectionFromLabel(label);
      const maxLength = clampInt(marker.maxLength || MAX_TEXT_LENGTH, 1, 5000);
      if (!text[marker.key]) {
        text[marker.key] = {
          key: marker.key,
          label,
          value: marker.value,
          maxLength,
          usages: [],
          inconsistent: false
        };
      } else if (text[marker.key].value !== marker.value) {
        text[marker.key].inconsistent = true;
      }
      pushUsage(text[marker.key].usages, {
        pageId: page.id,
        page: page.label,
        path: page.publicPath,
        section,
        count: 1
      });
    }

    const imageMarkers = extractImageMarkers(page.html);
    for (const marker of imageMarkers) {
      if (!MEDIA_SLOT_PATTERN.test(marker.slot) || !isSafeMediaBinding(marker.slot, marker.publicUrl)) continue;
      imageOccurrences++;
      const repoPath = `public${stripQueryAndHash(marker.publicUrl)}`;
      const label = getMediaDisplayLabel(marker.slot, marker.label);
      const context = marker.context || "이미지";
      if (!images[marker.slot]) {
        images[marker.slot] = {
          slot: marker.slot,
          label,
          publicUrl: stripQueryAndHash(marker.publicUrl),
          repoPath,
          usages: []
        };
      } else if (images[marker.slot].publicUrl !== stripQueryAndHash(marker.publicUrl)) {
        images[marker.slot].invalidBinding = true;
      }
      pushUsage(images[marker.slot].usages, {
        pageId: page.id,
        page: page.label,
        path: page.publicPath,
        section: context,
        count: 1
      });
    }
  }

  for (const [slot, meta] of Object.entries(images)) {
    if (meta.invalidBinding) delete images[slot];
    else meta.totalUses = meta.usages.reduce((sum, item) => sum + Number(item.count || 1), 0);
  }

  return {
    text,
    images,
    stats: {
      pages: pages.length,
      textKeys: Object.keys(text).length,
      textOccurrences,
      imageSlots: Object.keys(images).length,
      imageOccurrences
    }
  };
}

function extractTextMarkers(html) {
  const out = [];
  const re = /<([a-zA-Z][\w:-]*)\b([^>]*)\bdata-edit-key=([\'"])([^\'"]+)\3([^>]*)>([\s\S]*?)<\/\1\s*>/g;
  let match;
  while ((match = re.exec(html))) {
    const inner = match[6];
    if (/<[a-zA-Z][^>]*>/.test(inner)) continue;
    const attrs = `${match[2]} ${match[5]}`;
    out.push({
      key: match[4].trim(),
      label: getAttr(attrs, "data-edit-label"),
      section: getAttr(attrs, "data-edit-section"),
      maxLength: getAttr(attrs, "data-edit-max"),
      value: decodeHtmlEntities(inner.replace(/<!--[\s\S]*?-->/g, "").trim())
    });
  }
  return out;
}

function extractImageMarkers(html) {
  const out = [];
  const re = /<img\b([^>]*\bdata-media-slot=([\'"])([^\'"]+)\2[^>]*)\/?\s*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    const slot = match[3].trim();
    const src = getAttr(attrs, "src");
    if (!src) continue;
    out.push({
      slot,
      publicUrl: src,
      label: getAttr(attrs, "data-media-label") || getAttr(attrs, "alt"),
      context: getAttr(attrs, "data-media-context")
    });
  }
  return out;
}

function pushUsage(usages, usage) {
  const existing = usages.find((item) => item.pageId === usage.pageId && item.section === usage.section);
  if (existing) existing.count += usage.count;
  else usages.push(usage);
}

function getAttr(attrs, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attrs || "").match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtmlEntities(match[2]) : "";
}

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|#39|nbsp);/g, (all, entity) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos" || lower === "#39") return "'";
    if (lower === "nbsp") return " ";
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return all;
  });
}

function sectionFromLabel(label) {
  const value = String(label || "본문");
  const index = value.indexOf(" · ");
  return index > 0 ? value.slice(0, index) : value;
}


function getMediaDisplayLabel(slot, altLabel) {
  if (slot === "space") return "매장 공간 사진";
  const match = String(slot).match(/^nail-(\d+)$/);
  if (match) return `네일 포트폴리오 ${match[1]}`;
  return altLabel || humanizeMediaSlot(slot);
}
function humanizeMediaSlot(slot) {
  if (slot === "space") return "매장 공간";
  const match = String(slot).match(/^nail-(\d+)$/);
  if (match) return `네일 이미지 ${match[1]}`;
  return String(slot).replace(/-/g, " ");
}

function isSafeMediaBinding(slot, publicUrl) {
  if (!MEDIA_SLOT_PATTERN.test(String(slot || ""))) return false;
  const clean = stripQueryAndHash(publicUrl);
  return clean === `/assets/images/${slot}.webp`;
}

function stripQueryAndHash(value) {
  return String(value || "").split(/[?#]/, 1)[0];
}

function clampInt(value, min, max) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

async function applyEditorChangesToHtml(html, textChanges, changedSlots, imageModel, version) {
  const source = new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  const faqText = { ...collectCurrentTextValues(html), ...textChanges };
  const rewriter = new HTMLRewriter()
    .on("[data-edit-key]", {
      element(element) {
        const key = element.getAttribute("data-edit-key") || "";
        if (Object.prototype.hasOwnProperty.call(textChanges, key)) element.setInnerContent(textChanges[key]);
      }
    })
    .on("img[data-media-slot]", {
      element(element) {
        const slot = element.getAttribute("data-media-slot") || "";
        if (!changedSlots.has(slot)) return;
        const meta = imageModel[slot];
        if (meta && isSafeMediaBinding(slot, meta.publicUrl)) element.setAttribute("src", `${meta.publicUrl}?v=${encodeURIComponent(version)}`);
      }
    })
    .on("script[data-faq-schema]", {
      element(element) {
        const faqItems = [];
        for (let i = 1; i <= 20; i++) {
          const index = String(i).padStart(2, "0");
          const q = faqText[`faq.item${index}.question`];
          const a = faqText[`faq.item${index}.answer`];
          if (typeof q === "string" && typeof a === "string") faqItems.push({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } });
        }
        if (faqItems.length) element.setInnerContent(JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems }));
      }
    });
  return rewriter.transform(source).text();
}

function collectCurrentTextValues(html) {
  const values = {};
  for (const marker of extractTextMarkers(html)) if (!Object.prototype.hasOwnProperty.call(values, marker.key)) values[marker.key] = marker.value;
  return values;
}

async function commitFilesToGitHubWithToken(env, token, files, message, expectedHeadSha) {
  if (!Array.isArray(files) || files.length === 0) return { sha: expectedHeadSha, url: "" };
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH || "main").trim();
  const headers = githubHeaders(token);
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const currentHeadSha = await getRepositoryHeadSha(env, token);
  if (!timingSafeEqualString(currentHeadSha, expectedHeadSha)) throw new Error("저장 직전에 저장소가 변경되었습니다. 관리자 페이지를 새로고침한 뒤 다시 저장해 주세요.");

  const commitRes = await fetch(`${api}/git/commits/${encodeURIComponent(currentHeadSha)}`, { headers });
  const commitData = await commitRes.json().catch(() => ({}));
  if (!commitRes.ok || !commitData?.tree?.sha) throw new Error(`GitHub 현재 커밋 정보를 확인하지 못했습니다. ${await responseDetail(commitRes, commitData)}`);
  const baseTreeSha = String(commitData.tree.sha);

  const treeEntries = [];
  for (const file of files) {
    const blobRes = await fetch(`${api}/git/blobs`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ content: bytesToBase64(file.bytes), encoding: "base64" })
    });
    const blob = await blobRes.json().catch(() => ({}));
    if (!blobRes.ok || !blob?.sha) throw new Error(`GitHub 파일 저장 준비에 실패했습니다 (${file.path}). ${await responseDetail(blobRes, blob)}`);
    treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: String(blob.sha) });
  }

  const treeRes = await fetch(`${api}/git/trees`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
  });
  const tree = await treeRes.json().catch(() => ({}));
  if (!treeRes.ok || !tree?.sha) throw new Error(`GitHub 변경 트리 생성에 실패했습니다. ${await responseDetail(treeRes, tree)}`);

  const newCommitRes = await fetch(`${api}/git/commits`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: tree.sha, parents: [currentHeadSha] })
  });
  const newCommit = await newCommitRes.json().catch(() => ({}));
  if (!newCommitRes.ok || !newCommit?.sha) throw new Error(`GitHub 커밋 생성에 실패했습니다. ${await responseDetail(newCommitRes, newCommit)}`);

  const branchPath = branch.split("/").map(encodeURIComponent).join("/");
  const updateRefRes = await fetch(`${api}/git/refs/heads/${branchPath}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });
  const updatedRef = await updateRefRes.json().catch(() => ({}));
  if (!updateRefRes.ok) throw new Error(`GitHub 브랜치 반영에 실패했습니다. ${await responseDetail(updateRefRes, updatedRef)}`);

  return { sha: String(newCommit.sha), url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(String(newCommit.sha))}` };
}

async function responseDetail(response, data) {
  const message = String(data?.message || "").slice(0, 180);
  return message ? `(${response.status}: ${message})` : `(${response.status})`;
}

function base64ToUtf8(value) {
  const base64 = String(value || "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function revokeInstallationToken(token) {
  try {
    await fetch("https://api.github.com/installation/token", {
      method: "DELETE",
      headers: githubHeaders(token)
    });
  } catch (error) {
    console.warn("GitHub installation token revoke failed", error);
  }
}

function buildSandboxPreview(html, origin, bridgeNonce) {
  const cspNonce = randomBase64Url(18);
  const source = new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  const bridge = previewBridgeScript(bridgeNonce);
  const style = `
    html { scroll-behavior:smooth !important; }
    body.bellemyu-admin-preview [data-edit-key], body.bellemyu-admin-preview img[data-media-slot] { cursor:pointer !important; }
    body.bellemyu-admin-preview.bellemyu-show-markers [data-edit-key] { outline:1.5px dashed rgba(164,95,35,.72) !important; outline-offset:3px !important; }
    body.bellemyu-admin-preview.bellemyu-show-markers img[data-media-slot] { outline:2px dashed rgba(45,91,154,.76) !important; outline-offset:3px !important; }
    body.bellemyu-admin-preview [data-bellemyu-selected="1"] { outline:3px solid #111 !important; outline-offset:4px !important; box-shadow:0 0 0 6px rgba(255,255,255,.88) !important; }
    .portfolio-marquee-track,.ticker-track,.ticker>div { animation-play-state:paused !important; }
  `;
  const rewriter = new HTMLRewriter()
    .on("script", { element(element) { element.remove(); } })
    .on("iframe", { element(element) { element.remove(); } })
    .on("object", { element(element) { element.remove(); } })
    .on("embed", { element(element) { element.remove(); } })
    .on("meta[http-equiv]", { element(element) { element.remove(); } })
    .on("form", { element(element) { element.setAttribute("data-bellemyu-disabled-form", "1"); } })
    .on("head", { element(element) { element.append(`<meta name="robots" content="noindex,nofollow"><style nonce="${cspNonce}">${style}</style>`, { html: true }); } })
    .on("body", { element(element) { element.setAttribute("class", `${element.getAttribute("class") || ""} bellemyu-admin-preview bellemyu-show-markers`.trim()); element.append(`<script nonce="${cspNonce}">${bridge}</script>`, { html: true }); } });

  const response = rewriter.transform(source);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Content-Security-Policy", `default-src 'none'; img-src ${origin} data: blob:; style-src ${origin} 'nonce-${cspNonce}'; font-src ${origin}; script-src 'nonce-${cspNonce}'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}`);
  return new Response(response.body, { status: 200, headers });
}

function previewBridgeScript(bridgeNonce) {
  return `(() => {
    'use strict';
    const NONCE=${JSON.stringify(bridgeNonce)};
    const qs=(s)=>document.querySelector(s), qsa=(s)=>Array.from(document.querySelectorAll(s));
    const safeId=(v)=>String(v||'').replace(/[^A-Za-z0-9._:-]/g,'');
    const selector=(kind,id)=>kind==='text' ? '[data-edit-key="'+CSS.escape(id)+'"]' : 'img[data-media-slot="'+CSS.escape(id)+'"]';
    const clearSelected=()=>qsa('[data-bellemyu-selected="1"]').forEach(el=>el.removeAttribute('data-bellemyu-selected'));
    const markSelected=(kind,id,scroll)=>{ clearSelected(); const all=qsa(selector(kind,id)); all.forEach(el=>el.setAttribute('data-bellemyu-selected','1')); if(scroll&&all[0]) all[0].scrollIntoView({behavior:'smooth',block:'center',inline:'center'}); };
    const applyText=(key,value)=>qsa(selector('text',key)).forEach(el=>{el.textContent=String(value??'')});
    const applyImage=(slot,url)=>qsa(selector('image',slot)).forEach(el=>{el.src=String(url||'')});
    document.addEventListener('click',(event)=>{
      const target=event.target instanceof Element ? event.target : null;
      if(!target) return;
      const editable=target.closest('[data-edit-key],img[data-media-slot]');
      if(editable){
        event.preventDefault(); event.stopPropagation();
        const key=editable.getAttribute('data-edit-key'); const slot=editable.getAttribute('data-media-slot');
        const kind=key?'text':'image'; const id=safeId(key||slot);
        if(!id) return;
        markSelected(kind,id,false);
        parent.postMessage({type:'bellemyu:select',nonce:NONCE,kind,id},'*');
        return;
      }
      if(target.closest('a,button,input,select,textarea,label,form')){event.preventDefault();event.stopPropagation();}
    },true);
    document.addEventListener('submit',(event)=>{event.preventDefault();event.stopPropagation();},true);
    window.addEventListener('message',(event)=>{
      if(event.source!==parent) return;
      const data=event.data||{};
      if(data.nonce!==NONCE) return;
      if(data.type==='bellemyu:hydrate'){
        Object.entries(data.text||{}).forEach(([k,v])=>applyText(safeId(k),v));
        Object.entries(data.images||{}).forEach(([k,v])=>applyImage(safeId(k),v));
        document.body.classList.toggle('bellemyu-show-markers',data.highlight!==false);
      } else if(data.type==='bellemyu:setText') applyText(safeId(data.id),data.value);
      else if(data.type==='bellemyu:setImage') applyImage(safeId(data.id),data.url);
      else if(data.type==='bellemyu:highlight') document.body.classList.toggle('bellemyu-show-markers',data.enabled!==false);
      else if(data.type==='bellemyu:selectFromParent') markSelected(data.kind,safeId(data.id),true);
      else if(data.type==='bellemyu:clearSelection') clearSelected();
    });
    parent.postMessage({type:'bellemyu:ready',nonce:NONCE},'*');
  })();`;
}

function previewLoginExpired() {
  return new Response("<!doctype html><meta charset=utf-8><style>body{font-family:system-ui;padding:40px;background:#f5f1eb;color:#222}</style><h1>관리자 로그인이 만료되었습니다.</h1><p>관리자 페이지를 새로고침해 다시 로그인해 주세요.</p>", {
    status: 401,
    headers: previewHeaders()
  });
}
function previewError(message, status = 500) {
  return new Response(`<!doctype html><meta charset=utf-8><style>body{font-family:system-ui;padding:40px;background:#f5f1eb;color:#222}</style><h1>미리보기 오류</h1><p>${escapeHtmlText(message)}</p>`, { status, headers: previewHeaders() });
}
function previewHeaders() {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'"
  };
}
function escapeHtmlText(value) {
  return String(value || "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

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
    throw new Error("GitHub App이 현재 GITHUB_REPO 저장소에 설치되어 있는지 확인해 주세요.");
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
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob: https://avatars.githubusercontent.com; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com"
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
