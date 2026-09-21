const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 4096;
const TARGET_WIDTH = 1920;
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const state = {
  csrf: "",
  repository: "",
  baseSha: "",
  pages: [],
  text: {},
  images: {},
  originalText: {},
  pendingImages: new Map(),
  pageId: "home",
  selected: null,
  highlight: true,
  saving: false,
  previewNonce: "",
  previewReady: false
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const frame = $("[data-preview-frame]");
const shell = $("[data-preview-shell]");

bootstrap().catch(showFatal);

async function bootstrap() {
  const res = await fetch("/admin/api/editor-state", { credentials: "same-origin", cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || data.loginRequired) {
    showLogin(data.error || "GitHub 로그인이 필요합니다.");
    return;
  }
  if (!res.ok) {
    showLogin(data.error || "관리자 설정을 확인할 수 없습니다.");
    return;
  }

  state.csrf = data.csrfToken || "";
  state.repository = data.repository || "";
  state.baseSha = data.baseSha || "";
  state.pages = Array.isArray(data.pages) ? data.pages : [];
  state.text = data.text && typeof data.text === "object" ? data.text : {};
  state.images = data.images && typeof data.images === "object" ? data.images : {};
  state.originalText = Object.fromEntries(Object.entries(state.text).map(([key, meta]) => [key, String(meta.value ?? "")]));

  const user = data.user || {};
  $("[data-admin-user]").textContent = user.login ? `@${user.login}` : "관리자";
  $("[data-repository]").textContent = state.repository || "-";
  $("[data-auto-stats]").textContent = `${data.stats?.textKeys || Object.keys(state.text).length}개 문구 · ${data.stats?.imageSlots || Object.keys(state.images).length}개 사진 슬롯 자동 발견`;
  const avatar = $("[data-avatar]");
  if (user.avatarUrl) {
    avatar.src = user.avatarUrl;
    avatar.alt = `${user.login || "관리자"} 프로필`;
    avatar.hidden = false;
  }

  $("[data-authenticated]").hidden = false;
  $("[data-admin-panel]").hidden = false;
  $("[data-login-panel]").hidden = true;

  renderPageTabs();
  bindGlobalActions();
  loadPage(state.pageId);
  updateDirtyUI();
}

function showLogin(message) {
  $("[data-login-panel]").hidden = false;
  $("[data-admin-panel]").hidden = true;
  $("[data-authenticated]").hidden = true;
  const box = $("[data-login-error]");
  if (message && !/로그인이 필요/.test(message)) {
    box.textContent = message;
    box.hidden = false;
  }
}

function renderPageTabs() {
  const nav = $("[data-page-tabs]");
  nav.innerHTML = "";
  for (const page of state.pages) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = page.label;
    btn.dataset.pageId = page.id;
    btn.classList.toggle("is-active", page.id === state.pageId);
    btn.addEventListener("click", () => loadPage(page.id));
    nav.appendChild(btn);
  }
}

function bindGlobalActions() {
  window.addEventListener("message", onPreviewMessage);

  $$('[data-device]').forEach((btn) => btn.addEventListener("click", () => {
    $$('[data-device]').forEach((b) => b.classList.toggle("is-active", b === btn));
    shell.classList.toggle("is-mobile", btn.dataset.device === "mobile");
  }));

  $("[data-highlight]").addEventListener("change", (e) => {
    state.highlight = e.target.checked;
    postPreview({ type: "bellemyu:highlight", enabled: state.highlight });
  });

  $("[data-refresh-preview]").addEventListener("click", () => loadPage(state.pageId, true));
  $("[data-close-inspector]").addEventListener("click", clearSelection);
  $("[data-reset-current]").addEventListener("click", resetSelectedText);
  $("[data-reset-image]").addEventListener("click", resetSelectedImage);
  $("[data-text-input]").addEventListener("input", onTextInput);
  $("[data-image-input]").addEventListener("change", onImageInput);
  $("[data-reset-all]").addEventListener("click", resetAllChanges);
  $("[data-save-all]").addEventListener("click", saveAllChanges);
  $("[data-logout]").addEventListener("click", logout);
}

function currentPage() {
  return state.pages.find((p) => p.id === state.pageId) || state.pages[0];
}

function loadPage(pageId, force = false) {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return;
  state.pageId = pageId;
  state.selected = null;
  state.previewReady = false;
  state.previewNonce = randomNonce();
  $$('[data-page-id]').forEach((b) => b.classList.toggle("is-active", b.dataset.pageId === pageId));
  $$('[data-page-tabs] button').forEach((b) => b.classList.toggle("is-active", b.dataset.pageId === pageId));
  $("[data-open-public]").href = page.path;
  $("[data-preview-loading]").hidden = false;
  $("[data-current-page-summary]").textContent = `${page.label} · 클릭해서 편집`;
  clearSelection(false);
  const params = new URLSearchParams({ page: page.id, nonce: state.previewNonce, t: String(Date.now()) });
  if (force) params.set("force", Math.random().toString(36).slice(2));
  frame.src = `/admin/api/preview?${params.toString()}`;
}

function onPreviewMessage(event) {
  if (event.source !== frame.contentWindow) return;
  const data = event.data || {};
  if (data.nonce !== state.previewNonce) return;

  if (data.type === "bellemyu:ready") {
    state.previewReady = true;
    $("[data-preview-loading]").hidden = true;
    hydratePreview();
    return;
  }

  if (data.type === "bellemyu:select") {
    if (data.kind === "text" && state.text[data.id]) selectText(data.id, false);
    else if (data.kind === "image" && state.images[data.id]) selectImage(data.id, false);
  }
}

function postPreview(message) {
  if (!frame.contentWindow || !state.previewNonce) return;
  frame.contentWindow.postMessage({ ...message, nonce: state.previewNonce }, "*");
}

function hydratePreview() {
  const text = Object.fromEntries(Object.entries(state.text).map(([key, meta]) => [key, String(meta.value ?? "")]));
  const images = {};
  for (const [slot, item] of state.pendingImages.entries()) if (item.dataUrl) images[slot] = item.dataUrl;
  postPreview({ type: "bellemyu:hydrate", text, images, highlight: state.highlight });
  if (state.selected) postPreview({ type: "bellemyu:selectFromParent", kind: state.selected.type, id: state.selected.type === "text" ? state.selected.key : state.selected.slot });
}

function selectText(key, scroll = true) {
  const meta = state.text[key];
  if (!meta) return;
  state.selected = { type: "text", key };
  showInspectorEditor();
  $("[data-inspector-type]").textContent = "문구";
  $("[data-inspector-kicker]").textContent = usageBreadcrumb(meta.usages);
  $("[data-inspector-title]").textContent = meta.label || "문구 수정";
  renderUsage(meta.usages || [], false, meta.inconsistent ? "같은 키의 문구 값이 위치별로 달랐습니다. 저장하면 하나의 문구로 통일됩니다." : "");
  $("[data-text-editor]").hidden = false;
  $("[data-image-editor]").hidden = true;
  const input = $("[data-text-input]");
  input.maxLength = Number(meta.maxLength || 1200);
  input.value = String(meta.value ?? "");
  updateTextCount();
  if (scroll) postPreview({ type: "bellemyu:selectFromParent", kind: "text", id: key });
}

function selectImage(slot, scroll = true) {
  const meta = state.images[slot];
  if (!meta) return;
  state.selected = { type: "image", slot };
  showInspectorEditor();
  $("[data-inspector-type]").textContent = "사진";
  $("[data-inspector-kicker]").textContent = `사진 슬롯 · ${meta.totalUses || usageTotal(meta.usages)}곳 자동 연동`;
  $("[data-inspector-title]").textContent = meta.label || slot;
  renderUsage(meta.usages || [], true, `이 슬롯은 ${meta.totalUses || usageTotal(meta.usages)}곳에서 자동 재사용됩니다. 마퀴 복제본도 한 번만 바꾸면 전부 함께 변경됩니다.`);
  $("[data-text-editor]").hidden = true;
  $("[data-image-editor]").hidden = false;
  $("[data-image-input]").value = "";
  const pending = state.pendingImages.get(slot);
  $("[data-image-preview]").src = pending?.dataUrl || `${meta.publicUrl}?admin=${Date.now()}`;
  $("[data-reset-image]").hidden = !pending?.dirty;
  const status = $("[data-image-status]");
  status.className = "image-status";
  status.textContent = pending?.dirty
    ? "새 사진이 미리보기에 적용되어 있습니다. ‘전체 저장 및 배포’를 누르면 모든 사용 위치가 한 번에 변경됩니다."
    : `현재 ${meta.totalUses || usageTotal(meta.usages)}곳에서 사용 중입니다. 새 사진 한 장만 선택하면 중복 위치까지 모두 변경됩니다.`;
  if (scroll) postPreview({ type: "bellemyu:selectFromParent", kind: "image", id: slot });
}

function showInspectorEditor() {
  $("[data-inspector-empty]").hidden = true;
  $("[data-inspector-editor]").hidden = false;
}

function clearSelection(clearPreview = true) {
  state.selected = null;
  $("[data-inspector-empty]").hidden = false;
  $("[data-inspector-editor]").hidden = true;
  if (clearPreview) postPreview({ type: "bellemyu:clearSelection" });
}

function usageBreadcrumb(usages = []) {
  const first = usages.find((u) => u.pageId === state.pageId) || usages[0];
  return first ? `${first.page} · ${first.section}` : `${currentPage()?.label || "페이지"} · 본문`;
}

function usageTotal(usages = []) {
  return usages.reduce((sum, item) => sum + Number(item.count || 1), 0);
}

function renderUsage(usages, isImage, note = "") {
  const box = $("[data-usage-box]");
  const total = usageTotal(usages);
  const rows = usages.map((u) => {
    const count = Number(u.count || 1);
    const repeated = count > 1 ? ` · ${count}회 반복` : "";
    const marquee = /마퀴|자동 반복/.test(u.section || "") ? " · 자동 복제" : "";
    return `<div class="usage-item"><b>${escapeHtml(u.page || "페이지")}</b><span>${escapeHtml(u.section || "본문")}${repeated}${marquee}</span></div>`;
  }).join("");
  const lead = isImage
    ? `<div class="usage-title">사용 위치 ${total}곳 · 한 번 수정하면 전부 변경</div>`
    : `<div class="usage-title">이 문구가 표시되는 위치 ${total}곳</div>`;
  box.innerHTML = `${lead}<div class="usage-list">${rows || '<div class="usage-item"><b>현재 페이지</b><span>본문</span></div>'}</div>${note ? `<p class="helper">${escapeHtml(note)}</p>` : ""}`;
}

function onTextInput(event) {
  if (state.selected?.type !== "text") return;
  const key = state.selected.key;
  state.text[key].value = event.target.value;
  postPreview({ type: "bellemyu:setText", id: key, value: event.target.value });
  updateTextCount();
  updateDirtyUI();
}

function updateTextCount() {
  const input = $("[data-text-input]");
  $("[data-text-count]").textContent = `${input.value.length} / ${input.maxLength || 1200}자`;
}

async function onImageInput(event) {
  if (state.selected?.type !== "image") return;
  const slot = state.selected.slot;
  const file = event.target.files?.[0];
  if (!file) return;
  const status = $("[data-image-status]");
  status.className = "image-status";
  status.textContent = "사진을 검사하고 WebP로 변환 중입니다…";
  try {
    const prepared = await prepareImage(file);
    const previous = state.pendingImages.get(slot);
    if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
    const objectUrl = URL.createObjectURL(prepared.blob);
    const dataUrl = await blobToDataUrl(prepared.blob);
    state.pendingImages.set(slot, { ...prepared, objectUrl, dataUrl, dirty: true, fileName: file.name });
    $("[data-image-preview]").src = dataUrl;
    $("[data-reset-image]").hidden = false;
    postPreview({ type: "bellemyu:setImage", id: slot, url: dataUrl });
    const beforeKb = Math.max(1, Math.round(file.size / 1024));
    const afterKb = Math.max(1, Math.round(prepared.blob.size / 1024));
    status.classList.add("ok");
    status.textContent = `${prepared.originalWidth}×${prepared.originalHeight}px · ${beforeKb}KB → ${prepared.width}×${prepared.height}px · ${afterKb}KB WebP. 모든 사용 위치에 미리보기 적용했습니다.`;
    updateDirtyUI();
  } catch (error) {
    status.classList.add("bad");
    status.textContent = error.message || "이미지를 처리하지 못했습니다.";
  }
}

function resetSelectedText() {
  if (state.selected?.type !== "text") return;
  const key = state.selected.key;
  state.text[key].value = state.originalText[key] ?? "";
  $("[data-text-input]").value = state.text[key].value;
  postPreview({ type: "bellemyu:setText", id: key, value: state.text[key].value });
  updateTextCount();
  updateDirtyUI();
}

function resetSelectedImage() {
  if (state.selected?.type !== "image") return;
  const slot = state.selected.slot;
  const pending = state.pendingImages.get(slot);
  if (pending?.objectUrl) URL.revokeObjectURL(pending.objectUrl);
  state.pendingImages.delete(slot);
  const meta = state.images[slot];
  const src = `${meta.publicUrl}?admin=${Date.now()}`;
  $("[data-image-preview]").src = src;
  $("[data-reset-image]").hidden = true;
  postPreview({ type: "bellemyu:setImage", id: slot, url: src });
  $("[data-image-status]").className = "image-status";
  $("[data-image-status]").textContent = "사진 변경을 취소했습니다.";
  updateDirtyUI();
}

function resetAllChanges() {
  if (!hasDirtyChanges()) return;
  if (!confirm("저장하지 않은 모든 문구와 사진 변경을 취소할까요?")) return;
  for (const [key, value] of Object.entries(state.originalText)) if (state.text[key]) state.text[key].value = value;
  for (const item of state.pendingImages.values()) if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  state.pendingImages.clear();
  clearSelection();
  loadPage(state.pageId, true);
  updateDirtyUI();
}

function dirtyTextKeys() {
  return Object.keys(state.text).filter((key) => String(state.text[key].value ?? "") !== String(state.originalText[key] ?? ""));
}
function dirtyImageSlots() {
  return [...state.pendingImages.entries()].filter(([, item]) => item.dirty).map(([slot]) => slot);
}
function hasDirtyChanges() { return dirtyTextKeys().length > 0 || dirtyImageSlots().length > 0; }

function updateDirtyUI() {
  const textCount = dirtyTextKeys().length;
  const imageCount = dirtyImageSlots().length;
  const total = textCount + imageCount;
  $("[data-reset-all]").disabled = !total || state.saving;
  $("[data-save-all]").disabled = !total || state.saving;
  $("[data-save-state]").textContent = total ? `미저장 변경 ${total}개` : "저장된 상태";
  $("[data-save-state]").style.color = total ? "#8a6117" : "";
  $("[data-change-summary]").textContent = total ? `변경사항 ${total}개 · 문구 ${textCount} · 사진 ${imageCount}` : "변경사항 없음";
  if (!state.saving) $("[data-save-message]").textContent = total ? "여러 변경을 한 번의 GitHub 커밋으로 저장합니다." : "왼쪽 실제 화면에서 수정할 문구나 사진을 클릭하세요.";
}

async function saveAllChanges() {
  if (!hasDirtyChanges() || state.saving) return;
  state.saving = true;
  updateDirtyUI();
  const saveBtn = $("[data-save-all]");
  saveBtn.disabled = true;
  saveBtn.textContent = "저장 중…";
  $("[data-save-message]").textContent = "현재 GitHub 버전을 확인하고 변경 파일을 준비하고 있습니다…";

  try {
    const changedText = Object.fromEntries(dirtyTextKeys().map((key) => [key, String(state.text[key].value ?? "")]));
    const form = new FormData();
    form.set("changes", JSON.stringify({ baseSha: state.baseSha, text: changedText }));
    for (const [slot, item] of state.pendingImages.entries()) {
      if (!item.dirty) continue;
      form.append(`image:${slot}`, new File([item.blob], `${slot}.webp`, { type: "image/webp" }));
    }

    const res = await fetch("/admin/api/save", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": state.csrf },
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.reload(); return; }
    if (!res.ok) {
      if (data.code === "STALE_EDITOR") showToast("저장소가 다른 곳에서 변경되어 저장을 중단했습니다. 새로고침 후 다시 수정해 주세요.", "bad");
      throw new Error(data.error || "저장에 실패했습니다.");
    }

    for (const key of dirtyTextKeys()) state.originalText[key] = String(state.text[key].value ?? "");
    for (const item of state.pendingImages.values()) item.dirty = false;
    if (data.baseSha) state.baseSha = data.baseSha;
    showToast(data.noChanges ? "변경된 내용이 없습니다." : "저장 완료. Cloudflare가 자동 재배포 중입니다.", "ok");
    $("[data-save-message]").textContent = data.commitSha ? `GitHub 커밋 ${String(data.commitSha).slice(0, 7)} 생성 완료 · 자동 배포 대기 중` : data.message || "저장 완료";
    if (state.selected?.type === "image") $("[data-reset-image]").hidden = true;
  } catch (error) {
    showToast(error.message || "저장에 실패했습니다.", "bad");
    $("[data-save-message]").textContent = "저장에 실패했습니다. 현재 관리자 화면의 변경사항은 그대로 남아 있습니다.";
  } finally {
    state.saving = false;
    saveBtn.textContent = "전체 저장 및 배포";
    updateDirtyUI();
  }
}

async function logout() {
  if (!state.csrf) return;
  const res = await fetch("/admin/api/logout", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": state.csrf } });
  if (res.ok) location.reload();
}

async function prepareImage(file) {
  if (!ACCEPTED_EXT.test(file.name) || !ACCEPTED_MIME.has(file.type)) throw new Error("JPG, JPEG, PNG, WebP 파일만 선택할 수 있습니다.");
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error("원본 파일은 10MB 이하여야 합니다.");
  const source = await decodeImage(file);
  const ow = source.width, oh = source.height;
  if (!ow || !oh) { source.close?.(); throw new Error("이미지 해상도를 확인할 수 없습니다."); }
  if (ow > MAX_EDGE || oh > MAX_EDGE) { source.close?.(); throw new Error("원본 이미지의 가로/세로는 4096px 이하여야 합니다."); }
  const scale = ow > TARGET_WIDTH ? TARGET_WIDTH / ow : 1;
  const width = Math.max(1, Math.round(ow * scale));
  const height = Math.max(1, Math.round(oh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) { source.close?.(); throw new Error("브라우저 이미지 변환 기능을 사용할 수 없습니다."); }
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height); ctx.drawImage(source.image, 0, 0, width, height); source.close?.();
  let blob = await canvasToBlob(canvas, "image/webp", .82);
  if (!blob || blob.type !== "image/webp") throw new Error("WebP 변환을 지원하는 최신 Chrome에서 다시 시도해 주세요.");
  if (blob.size > 6 * 1024 * 1024) blob = await canvasToBlob(canvas, "image/webp", .72);
  if (!blob || blob.size > MAX_BYTES) throw new Error("변환 후 이미지 용량이 너무 큽니다. 다른 사진을 선택해 주세요.");
  return { blob, width, height, originalWidth: ow, originalHeight: oh };
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch (_) {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("이미지를 열 수 없습니다.")); el.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) { URL.revokeObjectURL(url); throw err; }
}

function canvasToBlob(canvas, type, quality) { return new Promise((resolve) => canvas.toBlob(resolve, type, quality)); }
function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("이미지 미리보기를 만들지 못했습니다.")); reader.readAsDataURL(blob); }); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function randomNonce() { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }

function showToast(message, kind = "") {
  const toast = $("[data-toast]");
  toast.textContent = message;
  toast.className = `toast ${kind}`.trim();
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5200);
}

function showFatal(error) {
  console.error(error);
  const panel = $("[data-login-panel]");
  panel.hidden = false;
  $("[data-admin-panel]").hidden = true;
  const box = $("[data-login-error]");
  box.textContent = error.message || "관리자 페이지를 불러오지 못했습니다.";
  box.hidden = false;
}
