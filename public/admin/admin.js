const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 4096;
const TARGET_WIDTH = 1920;
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

let slots = {};
let csrfToken = "";

bootstrap().catch(showFatal);

async function bootstrap() {
  const meRes = await fetch("/admin/api/me", { credentials: "same-origin", cache: "no-store" });
  const me = await meRes.json().catch(() => ({}));

  if (meRes.status === 401 || me.loginRequired) {
    showLogin(me.error || "GitHub 로그인이 필요합니다.");
    return;
  }
  if (!meRes.ok) {
    showLogin(me.error || "관리자 설정을 확인할 수 없습니다.");
    return;
  }

  csrfToken = me.csrfToken || "";
  const user = me.user || {};
  document.querySelector("[data-admin-user]").textContent = user.login ? `@${user.login}` : "관리자";
  document.querySelector("[data-repository]").textContent = me.repository || "-";
  const avatar = document.querySelector("[data-avatar]");
  if (user.avatarUrl) {
    avatar.src = user.avatarUrl;
    avatar.alt = `${user.login || "관리자"} 프로필`;
    avatar.hidden = false;
  }

  document.querySelector("[data-authenticated]").hidden = false;
  document.querySelector("[data-admin-panel]").hidden = false;
  document.querySelector("[data-login-panel]").hidden = true;

  const slotsRes = await fetch("/admin/api/slots", { credentials: "same-origin", cache: "no-store" });
  const data = await slotsRes.json().catch(() => ({}));
  if (!slotsRes.ok) throw new Error(data.error || "사진 목록을 불러오지 못했습니다.");
  slots = data.slots || {};
  render();
}

function showLogin(message) {
  document.querySelector("[data-login-panel]").hidden = false;
  document.querySelector("[data-admin-panel]").hidden = true;
  document.querySelector("[data-authenticated]").hidden = true;
  const error = document.querySelector("[data-login-error]");
  if (message && !/로그인이 필요/.test(message)) {
    error.textContent = message;
    error.hidden = false;
  }
}

function render() {
  const grid = document.querySelector("[data-grid]");
  grid.innerHTML = "";

  Object.entries(slots).forEach(([slot, info]) => {
    const card = document.createElement("article");
    card.className = "card";
    const currentSrc = info.publicUrl;
    card.innerHTML = `
      <div class="preview"><img src="${escapeHtml(currentSrc)}?v=${Date.now()}" alt="${escapeHtml(info.label)} 현재 이미지" decoding="async"></div>
      <div class="body">
        <h2>${escapeHtml(info.label)}</h2>
        <div class="meta">GitHub 정적 이미지 · 저장 시 자동 커밋/재배포</div>
        <label class="picker">JPG / PNG / WebP · 원본 10MB 이하 · 최대 4096px
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" data-file>
        </label>
        <div class="actions"><button class="upload" type="button" disabled data-upload>변환 후 저장</button></div>
        <div class="status" data-status aria-live="polite">파일을 선택하면 1920px WebP 변환 결과를 먼저 확인합니다.</div>
      </div>`;
    grid.appendChild(card);

    const input = card.querySelector("[data-file]");
    const button = card.querySelector("[data-upload]");
    const status = card.querySelector("[data-status]");
    const preview = card.querySelector(".preview img");
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
      preview.src = `${currentSrc}?v=${Date.now()}`;
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
        status.textContent = `${prepared.originalWidth}×${prepared.originalHeight}px · ${beforeKb}KB → ${prepared.width}×${prepared.height}px · ${kb}KB WebP`;
        status.classList.add("ok");
        button.disabled = false;
      } catch (err) {
        preview.src = `${currentSrc}?v=${Date.now()}`;
        status.textContent = err.message || "이미지를 처리할 수 없습니다.";
        status.classList.add("bad");
      }
    });

    button.addEventListener("click", async () => {
      if (!prepared) return;
      button.disabled = true;
      status.className = "status";
      status.textContent = "GitHub에 저장 중입니다…";
      try {
        const form = new FormData();
        form.set("slot", slot);
        form.set("file", new File([prepared.blob], `${slot}.webp`, { type: "image/webp" }));
        const res = await fetch("/admin/api/upload", {
          method: "POST",
          body: form,
          credentials: "same-origin",
          headers: { "X-CSRF-Token": csrfToken }
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          window.location.reload();
          return;
        }
        if (!res.ok) throw new Error(data.error || "저장에 실패했습니다.");
        clearPreviewUrl();
        preview.src = `${currentSrc}?pending=${Date.now()}`;
        card.classList.remove("is-prepared");
        status.textContent = "GitHub 저장 완료. Cloudflare 자동 배포가 끝나면 공개 사이트에 반영됩니다.";
        status.classList.add("ok");
        input.value = "";
        prepared = null;
      } catch (err) {
        status.textContent = err.message || "저장에 실패했습니다.";
        status.classList.add("bad");
        button.disabled = false;
      }
    });
  });
}

document.querySelector("[data-logout]")?.addEventListener("click", async () => {
  if (!csrfToken) return;
  const res = await fetch("/admin/api/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrfToken }
  });
  if (res.ok) window.location.reload();
});

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

  const blob = await canvasToBlob(canvas, "image/webp", .82);
  if (!blob || blob.type !== "image/webp") throw new Error("이 브라우저에서는 WebP 변환을 지원하지 않습니다. 최신 Chrome에서 다시 시도해 주세요.");
  if (blob.size > MAX_BYTES) throw new Error("변환 후 이미지가 10MB를 초과합니다. 다른 이미지를 선택해 주세요.");
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
  const loginPanel = document.querySelector("[data-login-panel]");
  const adminPanel = document.querySelector("[data-admin-panel]");
  if (adminPanel && !adminPanel.hidden) {
    document.querySelector("[data-grid]").innerHTML = `<div class="notice bad">${escapeHtml(err.message || "관리자 페이지를 불러오지 못했습니다.")}</div>`;
  } else if (loginPanel) {
    loginPanel.hidden = false;
    const error = document.querySelector("[data-login-error]");
    error.textContent = err.message || "관리자 페이지를 불러오지 못했습니다.";
    error.hidden = false;
  }
}
