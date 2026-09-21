const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 4096;
const TARGET_WIDTH = 1920;
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const state = {
  csrf: "",
  repository: "",
  manifest: null,
  content: null,
  originalText: {},
  pendingImages: new Map(),
  pageId: "home",
  selected: null,
  highlight: true,
  saving: false
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
  state.manifest = data.manifest || { pages: [], text: {}, images: {} };
  state.content = data.content || { text: {} };
  state.originalText = structuredClone(state.content.text || {});

  const user = data.user || {};
  $("[data-admin-user]").textContent = user.login ? `@${user.login}` : "관리자";
  $("[data-repository]").textContent = state.repository || "-";
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
  for (const page of state.manifest.pages || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = page.label;
    btn.dataset.pageId = page.id;
    if (page.id === state.pageId) btn.classList.add("is-active");
    btn.addEventListener("click", () => loadPage(page.id));
    nav.appendChild(btn);
  }
}

function bindGlobalActions() {
  frame.addEventListener("load", instrumentPreview);

  $$('[data-device]').forEach((btn) => btn.addEventListener("click", () => {
    $$('[data-device]').forEach((b) => b.classList.toggle("is-active", b === btn));
    shell.classList.toggle("is-mobile", btn.dataset.device === "mobile");
  }));

  $("[data-highlight]").addEventListener("change", (e) => {
    state.highlight = e.target.checked;
    applyHighlightMode();
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
  return (state.manifest.pages || []).find((p) => p.id === state.pageId) || state.manifest.pages?.[0];
}

function loadPage(pageId, force = false) {
  const page = (state.manifest.pages || []).find((p) => p.id === pageId);
  if (!page) return;
  state.pageId = pageId;
  state.selected = null;
  $$('[data-page-id]').forEach((b) => b.classList.toggle("is-active", b.dataset.pageId === pageId));
  $("[data-open-public]").href = page.path;
  $("[data-preview-loading]").hidden = false;
  clearSelection(false);
  renderPageFieldList();
  const url = new URL(page.path, location.origin);
  url.searchParams.set("adminPreview", String(Date.now()));
  if (force) url.searchParams.set("force", Math.random().toString(36).slice(2));
  frame.src = url.toString();
}

function instrumentPreview() {
  $("[data-preview-loading]").hidden = true;
  const doc = frame.contentDocument;
  if (!doc) return;

  let style = doc.getElementById("bellemyu-admin-preview-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "bellemyu-admin-preview-style";
    style.textContent = `
      body.bellemyu-editor-preview [data-edit-key], body.bellemyu-editor-preview img[data-media-slot] { cursor:pointer !important; transition:outline-color .15s ease, box-shadow .15s ease !important; }
      body.bellemyu-editor-preview.bellemyu-editor-highlight [data-edit-key] { outline:1.5px dashed rgba(162,97,43,.68) !important; outline-offset:3px !important; }
      body.bellemyu-editor-preview.bellemyu-editor-highlight img[data-media-slot] { outline:2px dashed rgba(42,97,159,.68) !important; outline-offset:3px !important; }
      body.bellemyu-editor-preview [data-admin-selected="1"] { outline:3px solid #17130f !important; outline-offset:4px !important; box-shadow:0 0 0 6px rgba(255,255,255,.75) !important; }
    `;
    doc.head.appendChild(style);
  }
  doc.body.classList.add("bellemyu-editor-preview");
  applyHighlightMode();
  applyLocalEditsToPreview();

  doc.addEventListener("click", previewClickHandler, true);
}

function previewClickHandler(event) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const editable = target.closest("[data-edit-key], img[data-media-slot]");
  if (editable) {
    event.preventDefault();
    event.stopPropagation();
    selectPreviewElement(editable);
    return;
  }
  if (target.closest("a,button,input,label")) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function applyHighlightMode() {
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  doc.body.classList.toggle("bellemyu-editor-highlight", state.highlight);
}

function applyLocalEditsToPreview() {
  const doc = frame.contentDocument;
  if (!doc) return;
  for (const [key, value] of Object.entries(state.content?.text || {})) {
    for (const el of $$(`[data-edit-key="${cssEscape(key)}"]`, doc)) el.textContent = value;
  }
  for (const [slot, item] of state.pendingImages.entries()) {
    if (!item.url) continue;
    for (const img of $$(`img[data-media-slot="${cssEscape(slot)}"]`, doc)) img.src = item.url;
  }
}

function selectPreviewElement(el) {
  const doc = frame.contentDocument;
  if (!doc) return;
  $$('[data-admin-selected="1"]', doc).forEach((n) => n.removeAttribute("data-admin-selected"));
  el.setAttribute("data-admin-selected", "1");

  const textKey = el.getAttribute("data-edit-key");
  const slot = el.getAttribute("data-media-slot");
  if (textKey) selectText(textKey, el);
  else if (slot) selectImage(slot, el);
}

function selectText(key, el = null) {
  const meta = state.manifest.text?.[key];
  if (!meta) return;
  state.selected = { type: "text", key };
  showInspectorEditor();
  $("[data-inspector-kicker]").textContent = `${meta.page || currentPage()?.label || "페이지"} · ${meta.section || "본문"}`;
  $("[data-inspector-title]").textContent = meta.label || "문구 수정";
  renderUsage(meta.usages || [], false);
  $("[data-text-editor]").hidden = false;
  $("[data-image-editor]").hidden = true;
  const input = $("[data-text-input]");
  input.maxLength = Number(meta.maxLength || 1200);
  input.value = state.content.text?.[key] ?? "";
  updateTextCount();
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

function selectImage(slot, el = null) {
  const meta = state.manifest.images?.[slot];
  if (!meta) return;
  state.selected = { type: "image", slot };
  showInspectorEditor();
  $("[data-inspector-kicker]").textContent = "사진 슬롯 · 모든 사용 위치 자동 연동";
  $("[data-inspector-title]").textContent = meta.label || slot;
  renderUsage(meta.usages || [], true, meta.description || "");
  $("[data-text-editor]").hidden = true;
  $("[data-image-editor]").hidden = false;
  $("[data-image-input]").value = "";

  const pending = state.pendingImages.get(slot);
  const publicUrl = `/assets/images/${slot}.webp?v=${encodeURIComponent(state.content?.version || Date.now())}`;
  $("[data-image-preview]").src = pending?.url || publicUrl;
  const reset = $("[data-reset-image]");
  reset.hidden = !(pending?.dirty);
  const usageCount = (meta.usages || []).reduce((sum, u) => sum + Number(u.count || 1), 0);
  $("[data-image-status]").className = "image-status";
  $("[data-image-status]").textContent = pending?.dirty
    ? "새 사진이 미리보기에 적용되어 있습니다. 아래 ‘전체 저장 및 배포’를 누르면 저장됩니다."
    : `현재 이 사진은 ${usageCount}곳에서 사용됩니다. 새 사진을 선택하면 모든 위치가 함께 변경됩니다.`;
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

function showInspectorEditor() {
  $("[data-inspector-empty]").hidden = true;
  $("[data-inspector-editor]").hidden = false;
}

function clearSelection(clearFrame = true) {
  state.selected = null;
  $("[data-inspector-empty]").hidden = false;
  $("[data-inspector-editor]").hidden = true;
  if (clearFrame) {
    const doc = frame.contentDocument;
    $$('[data-admin-selected="1"]', doc || document).forEach((n) => n.removeAttribute("data-admin-selected"));
  }
}

function renderUsage(usages, isImage, description = "") {
  const box = $("[data-usage-box]");
  const total = usages.reduce((sum, u) => sum + Number(u.count || 1), 0);
  const rows = usages.map((u) => {
    const count = Number(u.count || 1);
    const extra = count > 1 ? ` · ${count}회 반복` : "";
    return `<div class="usage-item"><b>${escapeHtml(u.page || "페이지")}</b> · ${escapeHtml(u.section || "본문")}${extra}</div>`;
  }).join("");
  const lead = isImage
    ? `<div class="usage-title">사용 위치 ${total}곳 · 한 번 수정하면 전부 변경</div>`
    : `<div class="usage-title">이 문구가 표시되는 위치 ${total}곳</div>`;
  box.innerHTML = `${lead}<div class="usage-list">${rows || '<div class="usage-item">현재 페이지</div>'}</div>${description ? `<p class="helper">${escapeHtml(description)}</p>` : ""}`;
}

function onTextInput(event) {
  if (state.selected?.type !== "text") return;
  const key = state.selected.key;
  state.content.text[key] = event.target.value;
  applyTextKeyToPreview(key, event.target.value);
  updateTextCount();
  updateDirtyUI();
}

function updateTextCount() {
  const input = $("[data-text-input]");
  $("[data-text-count]").textContent = `${input.value.length} / ${input.maxLength || 1200}자`;
}

function applyTextKeyToPreview(key, value) {
  const doc = frame.contentDocument;
  if (!doc) return;
  for (const el of $$(`[data-edit-key="${cssEscape(key)}"]`, doc)) el.textContent = value;
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
    if (previous?.url) URL.revokeObjectURL(previous.url);
    const url = URL.createObjectURL(prepared.blob);
    state.pendingImages.set(slot, { ...prepared, url, dirty: true, fileName: file.name });
    $("[data-image-preview]").src = url;
    $("[data-reset-image]").hidden = false;
    applyImageSlotToPreview(slot, url);
    const beforeKb = Math.max(1, Math.round(file.size / 1024));
    const afterKb = Math.max(1, Math.round(prepared.blob.size / 1024));
    status.classList.add("ok");
    status.textContent = `${prepared.originalWidth}×${prepared.originalHeight}px · ${beforeKb}KB → ${prepared.width}×${prepared.height}px · ${afterKb}KB WebP. 미리보기에 반영했습니다.`;
    updateDirtyUI();
  } catch (error) {
    status.classList.add("bad");
    status.textContent = error.message || "이미지를 처리하지 못했습니다.";
  }
}

function applyImageSlotToPreview(slot, url) {
  const doc = frame.contentDocument;
  if (!doc) return;
  for (const img of $$(`img[data-media-slot="${cssEscape(slot)}"]`, doc)) img.src = url;
}

function resetSelectedText() {
  if (state.selected?.type !== "text") return;
  const key = state.selected.key;
  state.content.text[key] = state.originalText[key] ?? "";
  $("[data-text-input]").value = state.content.text[key];
  applyTextKeyToPreview(key, state.content.text[key]);
  updateTextCount();
  updateDirtyUI();
}

function resetSelectedImage() {
  if (state.selected?.type !== "image") return;
  const slot = state.selected.slot;
  const pending = state.pendingImages.get(slot);
  if (pending?.url) URL.revokeObjectURL(pending.url);
  state.pendingImages.delete(slot);
  const src = `/assets/images/${slot}.webp?v=${encodeURIComponent(state.content?.version || Date.now())}`;
  $("[data-image-preview]").src = src;
  $("[data-reset-image]").hidden = true;
  applyImageSlotToPreview(slot, src);
  $("[data-image-status]").className = "image-status";
  $("[data-image-status]").textContent = "사진 변경을 취소했습니다.";
  updateDirtyUI();
}

function resetAllChanges() {
  if (!hasDirtyChanges()) return;
  if (!confirm("저장하지 않은 모든 문구와 사진 변경을 취소할까요?")) return;
  state.content.text = structuredClone(state.originalText);
  for (const item of state.pendingImages.values()) if (item.url) URL.revokeObjectURL(item.url);
  state.pendingImages.clear();
  clearSelection();
  loadPage(state.pageId, true);
  updateDirtyUI();
}

function dirtyTextKeys() {
  return Object.keys(state.content?.text || {}).filter((key) => state.content.text[key] !== state.originalText[key]);
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
  if (!state.saving) $("[data-save-message]").textContent = total ? "여러 변경을 한 번의 GitHub 커밋으로 저장합니다." : "문구와 사진을 여러 개 수정한 뒤 한 번에 저장할 수 있습니다.";
}

async function saveAllChanges() {
  if (!hasDirtyChanges() || state.saving) return;
  state.saving = true;
  updateDirtyUI();
  const saveBtn = $("[data-save-all]");
  saveBtn.disabled = true;
  saveBtn.textContent = "저장 중…";
  $("[data-save-message]").textContent = "GitHub에 변경 파일을 준비하고 있습니다…";
  try {
    const form = new FormData();
    form.set("content", JSON.stringify({ text: state.content.text }));
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
    if (!res.ok) throw new Error(data.error || "저장에 실패했습니다.");

    state.originalText = structuredClone(state.content.text);
    if (data.version) state.content.version = data.version;
    for (const item of state.pendingImages.values()) item.dirty = false;
    showToast(data.noChanges ? "변경된 내용이 없습니다." : "저장 완료. Cloudflare가 자동 재배포 중입니다.", "ok");
    $("[data-save-message]").textContent = data.commitSha ? `GitHub 커밋 ${String(data.commitSha).slice(0, 7)} 생성 완료 · 자동 배포 대기 중` : data.message || "저장 완료";
    if (state.selected?.type === "image") $("[data-reset-image]").hidden = true;
  } catch (error) {
    showToast(error.message || "저장에 실패했습니다.", "bad");
    $("[data-save-message]").textContent = "저장에 실패했습니다. 변경사항은 현재 관리자 화면에 그대로 남아 있습니다.";
  } finally {
    state.saving = false;
    saveBtn.textContent = "전체 저장 및 배포";
    updateDirtyUI();
  }
}

function renderPageFieldList() {
  const wrap = $("[data-page-field-list]");
  if (!state.manifest) return;
  const rows = [];
  for (const [key, meta] of Object.entries(state.manifest.text || {})) {
    if (!(meta.usages || []).some((u) => u.pageId === state.pageId)) continue;
    rows.push({ type: "text", id: key, label: meta.label || key, section: meta.section || "문구" });
  }
  for (const [slot, meta] of Object.entries(state.manifest.images || {})) {
    if (!(meta.usages || []).some((u) => u.pageId === state.pageId)) continue;
    rows.push({ type: "image", id: slot, label: meta.label || slot, section: "사진" });
  }
  rows.sort((a, b) => (a.section + a.label).localeCompare(b.section + b.label, "ko"));
  $("[data-field-count]").textContent = `${rows.length}개`;
  wrap.innerHTML = "";
  for (const row of rows) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "field-jump";
    btn.innerHTML = `<span>${escapeHtml(row.label)}</span><small>${row.type === "image" ? "사진" : "문구"}</small>`;
    btn.addEventListener("click", () => jumpToField(row));
    wrap.appendChild(btn);
  }
}

function jumpToField(row) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const selector = row.type === "image" ? `img[data-media-slot="${cssEscape(row.id)}"]` : `[data-edit-key="${cssEscape(row.id)}"]`;
  const el = doc.querySelector(selector);
  if (!el) {
    showToast("현재 미리보기에서 해당 항목을 찾지 못했습니다. 페이지를 새로고침해 주세요.", "bad");
    return;
  }
  selectPreviewElement(el);
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
function cssEscape(value) { return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }

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
