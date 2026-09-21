# 벨르뮤네일 비주얼 관리자 — 자동 마커 방식

이 버전은 별도의 `editor-manifest.json` 또는 `site-content.json`을 사용하지 않습니다.
공개 HTML 자체가 편집 대상과 현재 값을 가진 유일한 원본입니다.

## 관리자 사용법

1. `/admin/`에서 GitHub 로그인
2. 상단에서 홈 / 네일 디자인 / 시술 과정 / 포트폴리오 / 방문 안내 / FAQ 선택
3. 왼쪽 실제 화면에서 주황 점선 문구 또는 파란 점선 사진 클릭
4. 오른쪽에 선택한 항목 편집기가 즉시 표시됨
5. 여러 문구/사진을 수정
6. `전체 저장 및 배포` 한 번 클릭
7. GitHub 한 번의 커밋 → Cloudflare 자동 재배포

## 문구 자동 발견 규칙

HTML에 아래처럼 `data-edit-key`만 있으면 관리자에 자동 등록됩니다.

```html
<h2 data-edit-key="home.event.title" data-edit-label="이벤트 제목">
  이달의 네일
</h2>
```

- `data-edit-key`: 고유한 키
- `data-edit-label`: 관리자에 표시될 이름
- `data-edit-max`: 선택 사항. 최대 글자 수. 없으면 1200자
- `data-edit-section`: 선택 사항. 사용 위치를 더 친절하게 표시하고 싶을 때 사용

별도 manifest 등록은 필요 없습니다.

## 사진 자동 발견 규칙

```html
<img
  src="/assets/images/event-banner.webp"
  data-media-slot="event-banner"
  data-media-context="홈 · 이벤트 배너"
  alt="이달의 네일 이벤트"
>
```

보안을 위해 사진은 반드시 아래 규칙을 만족해야 자동 편집 대상으로 인정됩니다.

- slot: 영문 소문자/숫자/하이픈
- 파일 경로: `/assets/images/{slot}.webp`

예: `data-media-slot="nail-03"`이면 파일은 `/assets/images/nail-03.webp`

같은 slot이 마퀴 때문에 4번, 다른 페이지에 3번 있어도 관리자는 한 번만 수정합니다. 관리자는 전체 사용 위치와 반복 횟수를 자동 계산해서 보여줍니다.

## 보안 구조

관리자 미리보기는 공개 페이지 DOM을 직접 조작하지 않습니다.

- GitHub 저장소의 HTML을 서버에서 읽음
- 원래 `<script>` / iframe / object / embed 제거
- sandbox iframe (`allow-scripts`만 허용)으로 표시
- `allow-same-origin` 사용 안 함
- 클릭 정보는 nonce가 포함된 `postMessage`로만 전달
- 부모 페이지는 `event.source`와 nonce를 모두 확인
- 저장 시 Worker가 GitHub의 최신 HTML을 다시 읽어 marker 존재 여부 재검증
- 문구는 `HTMLRewriter.setInnerContent()`로 plain text 저장
- 사진은 실제 WebP magic bytes/해상도/용량 재검증
- 이미지 경로는 실제 HTML marker에서 자동 발견하되 `/assets/images/{slot}.webp` 규칙만 허용
- 편집 시작 SHA와 저장 직전 GitHub main SHA가 다르면 저장 중단
- installation token은 해당 repo 하나로 제한하고 작업 후 즉시 revoke 시도

## 공개 사이트 트래픽

`wrangler.jsonc`의 `run_worker_first`는 `/admin`, `/admin/*`뿐입니다.
일반 방문자의 HTML/CSS/JS/이미지는 Cloudflare Static Assets로 직접 제공됩니다.
