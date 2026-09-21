const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 4096;
const TARGET_WIDTH = 1920;
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

let manifest = {};
let slots = {};

bootstrap().catch(showFatal);

async function bootstrap() {
  const [meRes, manifestRes] = await Promise.all([
    fetch("/admin/api/me", { credentials: "same-origin", cache: "no-store" }),
    fetch("/admin/api/manifest", { credentials: "same-origin", cache: "no-store" })
  ]);
  if (!meRes.ok || !manifestRes.ok) throw new Error("관리자 인증 또는 초기 데이터를 불러오지 못했습니다.");
  const me = await meRes.json();
  const data = await manifestRes.json();
  document.querySelector("[data-admin-email]").textContent = me.email || "관리자";
  manifest = data.manifest || {};
  slots = data.slots || {};
  render();
}

function render() {
  const grid = document.querySelector("[data-grid]");
  grid.innerHTML = "";
  Object.entries(slots).forEach(([slot, info]) => {
    const card = document.createElement("article");
    card.className = "card";
    const version = manifest?.[slot]?.version;
    const currentSrc = version ? `/media/${encodeURIComponent(slot)}?v=${encodeURIComponent(version)}` : info.fallback;
    const updated = manifest?.[slot]?.updatedAt ? new Date(manifest[slot].updatedAt).toLocaleString("ko-KR") : "기본 이미지 사용 중";
    card.innerHTML = `
      <div class="preview"><img src="${escapeHtml(currentSrc)}" alt="${escapeHtml(info.label)} 현재 이미지" decoding="async"></div>
      <div class="body">
        <h2>${escapeHtml(info.label)}</h2>
        <div class="meta">${escapeHtml(updated)}</div>
        <label class="picker">JPG / PNG / WebP · 원본 10MB 이하 · 최대 4096px
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" data-file>
        </label>
        <div class="actions"><button class="upload" type="button" disabled data-upload>변환 후 업로드</button></div>
        <div class="status" data-status aria-live="polite">파일을 선택하면 변환 결과를 먼저 확인합니다.</div>
      </div>`;
    grid.appendChild(card);

    const input = card.querySelector("[data-file]");
    const button = card.querySelector("[data-upload]");
    const status = card.querySelector("[data-status]");
    const preview = card.querySelector(".preview img");
    const originalPreview = currentSrc;
    let prepared = null;
    let previewUrl = null;

    const clearPreviewUrl = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    };

    input.addEventListener("change", async () => {
      clearPreviewUrl();
      prepared = null;
      card.classList.remove("is-prepared");
      preview.src = originalPreview;
      button.disabled = true;
      status.className = "status";
      const file = input.files?.[0];
      if (!file) { status.textContent = "파일을 선택해 주세요."; return; }
      try {
        status.textContent = "이미지를 확인하고 변환 중입니다…";
        prepared = await prepareImage(file);
        previewUrl = URL.createObjectURL(prepared.blob);
        preview.src = previewUrl;
        card.classList.add("is-prepared");
        const kb = Math.max(1, Math.round(prepared.blob.size / 1024));
        const beforeKb = Math.max(1, Math.round(file.size / 1024));
        status.textContent = `${prepared.originalWidth}×${prepared.originalHeight}px · ${beforeKb}KB → ${prepared.width}×${prepared.height}px · ${kb}KB ${prepared.type === "image/webp" ? "WebP" : "JPEG"}`;
        status.classList.add("ok");
        button.disabled = false;
      } catch (err) {
        preview.src = originalPreview;
        status.textContent = err.message || "이미지를 처리할 수 없습니다.";
        status.classList.add("bad");
      }
    });

    button.addEventListener("click", async () => {
      if (!prepared) return;
      button.disabled = true;
      status.className = "status";
      status.textContent = "R2에 업로드 중입니다…";
      try {
        const form = new FormData();
        form.set("slot", slot);
        form.set("file", new File([prepared.blob], prepared.type === "image/webp" ? `${slot}.webp` : `${slot}.jpg`, { type: prepared.type }));
        const res = await fetch("/admin/api/upload", { method: "POST", body: form, credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "업로드에 실패했습니다.");
        manifest[slot] = { ...(manifest[slot] || {}), version: data.version, updatedAt: data.updatedAt };
        clearPreviewUrl();
        preview.src = `${data.mediaUrl}&t=${Date.now()}`;
        card.classList.remove("is-prepared");
        card.querySelector(".meta").textContent = new Date(data.updatedAt).toLocaleString("ko-KR");
        status.textContent = "업로드 완료. 공개 페이지를 새로고침하면 새 사진이 적용됩니다.";
        status.classList.add("ok");
        input.value = "";
        prepared = null;
      } catch (err) {
        status.textContent = err.message || "업로드에 실패했습니다.";
        status.classList.add("bad");
        button.disabled = false;
      }
    });
  });
}

async function prepareImage(file) {
  if (!ACCEPTED_EXT.test(file.name) || !ACCEPTED_MIME.has(file.type)) throw new Error("JPG, JPEG, PNG, WebP 파일만 선택할 수 있습니다.");
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error("원본 파일은 10MB 이하여야 합니다.");

  const source = await decodeImage(file);
  const ow = source.width;
  const oh = source.height;
  if (!ow || !oh) { source.close?.(); throw new Error("이미지 해상도를 확인할 수 없습니다."); }
  if (ow > MAX_EDGE || oh > MAX_EDGE) { source.close?.(); throw new Error("원본 이미지의 가로/세로는 4096px 이하여야 합니다."); }

  const scale = ow > TARGET_WIDTH ? TARGET_WIDTH / ow : 1;
  const width = Math.max(1, Math.round(ow * scale));
  const height = Math.max(1, Math.round(oh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) { source.close?.(); throw new Error("브라우저에서 이미지 변환 기능을 사용할 수 없습니다."); }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source.image, 0, 0, width, height);
  source.close?.();

  let type = "image/webp";
  let blob = await canvasToBlob(canvas, type, .82);
  if (!blob || blob.type !== "image/webp") {
    type = "image/jpeg";
    blob = await canvasToBlob(canvas, type, .86);
  }
  if (!blob) throw new Error("브라우저에서 이미지를 변환하지 못했습니다.");
  if (blob.size > MAX_BYTES) throw new Error("변환 후 이미지가 10MB를 초과합니다. 다른 이미지를 선택해 주세요.");
  return { blob, type, width, height, originalWidth: ow, originalHeight: oh };
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
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 열 수 없습니다."));
      el.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}
function showFatal(err) {
  document.querySelector("[data-grid]").innerHTML = `<div class="notice">${escapeHtml(err.message || "관리자 페이지를 불러오지 못했습니다.")}</div>`;
}
