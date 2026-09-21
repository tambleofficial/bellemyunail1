# bellemyunail 관리자 설정 — 카드 등록 없는 GitHub App 방식

이 프로젝트는 아래 기능을 사용하지 않습니다.

- R2 사용 안 함
- Cloudflare Zero Trust / Access 사용 안 함
- Workers Paid 사용 안 함
- GitHub Marketplace 유료 앱 사용 안 함
- GitHub PAT 사용 안 함

현재 이미 배포 중인 Cloudflare Workers Free + 본인이 직접 만드는 GitHub App만 사용합니다.

---

## 0. 먼저 코드 배포

이 ZIP의 파일을 GitHub 저장소 `tambleofficial/bellemyunail1` 루트에 그대로 덮어쓰고 `main`에 push 합니다.

Cloudflare에 이미 GitHub 자동 배포가 연결돼 있으므로 배포 성공만 확인합니다.

관리자 설정 전에도 공개 홈페이지는 정상 동작합니다. `/admin/`에 들어가면 GitHub 로그인 버튼이 보입니다.

---

## 1. GitHub App 만들기 — Chrome에서 가능

GitHub 로그인 후 오른쪽 상단 프로필 → **Settings** → 맨 아래 **Developer settings** → **GitHub Apps** → **New GitHub App**으로 들어갑니다.

다음처럼 입력합니다.

### GitHub App name

전 세계에서 중복되지 않는 이름이어야 합니다. 예:

`bellemyunail-admin-tambleofficial`

### Homepage URL

현재 실제 Worker 주소를 넣습니다.

예:

`https://bellemyunail.tambleofficial.workers.dev`

### Callback URL

Worker 주소 뒤에 아래 경로를 정확히 붙입니다.

`https://bellemyunail.tambleofficial.workers.dev/admin/auth/callback`

### Webhook

**Active 체크 해제**. 이 프로젝트는 webhook을 사용하지 않습니다.

### Repository permissions

`Contents` → **Read and write**

나머지는 추가 권한을 주지 않습니다. Metadata의 Read는 GitHub가 기본으로 부여합니다.

### Where can this GitHub App be installed?

가능하면 **Only on this account**를 선택합니다.

설정을 저장해서 GitHub App을 생성합니다.

---

## 2. GitHub App을 bellemyunail1 저장소 하나에만 설치

생성한 GitHub App 설정 화면에서 **Install App**을 누릅니다.

설치 대상 계정을 선택하고:

**Only select repositories** → `bellemyunail1` 하나만 선택 → Install

이 앱을 다른 저장소에는 설치하지 않습니다.

---

## 3. GitHub App 값 3개 확보

GitHub App 설정 화면에서 다음 값을 준비합니다.

### A. Client ID

GitHub App 화면에 표시되는 `Client ID`.

예: `Iv1.xxxxxxxxxxxxxxxx`

### B. Client Secret

GitHub App 설정에서 **Generate a new client secret**을 눌러 생성합니다.

화면에 표시되는 값을 복사합니다.

### C. Private Key

GitHub App 설정의 **Private keys**에서 **Generate a private key**를 누릅니다.

`.pem` 파일이 다운로드됩니다. Chrome으로 다운로드한 파일을 메모장/텍스트 편집기로 열면 아래처럼 생긴 내용이 있습니다.

`-----BEGIN RSA PRIVATE KEY-----`

또는

`-----BEGIN PRIVATE KEY-----`

부터 끝의 `-----END ... PRIVATE KEY-----`까지 **전부** Cloudflare Secret에 붙여넣습니다.

이 파일은 GitHub 저장소에 올리면 안 됩니다.

---

## 4. 관리자 GitHub 숫자 User ID 확인 — Chrome에서 가능

본인의 GitHub 사용자명이 예를 들어 `tambleofficial`이면 Chrome 주소창에:

`https://api.github.com/users/tambleofficial`

을 입력합니다.

나오는 JSON에서 아래 숫자를 찾습니다.

`"id": 12345678`

이 숫자가 `ADMIN_GITHUB_USER_ID`입니다. 사용자명 문자열이 아니라 **숫자 ID**를 사용합니다.

---

## 5. Cloudflare Worker Secret 4개 등록 — Chrome에서 가능

Cloudflare Dashboard → **Workers & Pages** → `bellemyunail` → **Settings** → **Variables and Secrets**로 이동합니다.

다음 4개를 추가합니다. 가능하면 모두 **Secret** 타입으로 넣습니다.

### `GITHUB_APP_CLIENT_ID`

1단계에서 확인한 Client ID

### `GITHUB_APP_CLIENT_SECRET`

생성한 Client Secret

### `GITHUB_APP_PRIVATE_KEY`

다운로드한 `.pem` 파일의 전체 내용

### `ADMIN_GITHUB_USER_ID`

본인 GitHub의 숫자 User ID

저장합니다.

`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`는 이미 `wrangler.jsonc`에 다음 값으로 들어 있습니다.

- `tambleofficial`
- `bellemyunail1`
- `main`

---

## 6. Cloudflare를 한 번 다시 배포

Secret 저장 후 현재 Worker의 최신 Deployment를 다시 배포하거나, GitHub에 작은 커밋을 하나 push합니다.

---

## 7. 관리자 로그인 테스트

Chrome에서:

`https://bellemyunail.tambleofficial.workers.dev/admin/`

접속 → **GitHub로 로그인** → GitHub 승인 → `/admin/`으로 돌아오면 성공입니다.

등록된 `ADMIN_GITHUB_USER_ID`와 다른 GitHub 계정으로 로그인하면 관리자 세션을 발급하지 않습니다.

---

## 8. 사진 변경 테스트

관리자에서 사진 하나 선택 → 변환 결과 확인 → **변환 후 저장**.

흐름:

1. 브라우저가 원본 확장자/MIME/10MB/4096px 검사
2. 최대 폭 1920px WebP로 재인코딩
3. EXIF/GPS 메타데이터 제거
4. Worker가 세션 + CSRF + Origin 확인
5. Worker가 WebP 실제 시그니처/해상도 재검사
6. GitHub App 설치 토큰을 그때그때 생성
7. `bellemyunail1`의 지정 이미지 파일만 커밋
8. Cloudflare Git 자동 배포

GitHub App 설치 토큰은 GitHub에서 1시간 후 만료되는 단기 토큰을 사용하며 브라우저에 노출되지 않습니다.

---

## 보안 구조

- GitHub OAuth `state` 검증
- PKCE S256
- GitHub 숫자 User ID 고정
- 세션 8시간 만료
- Secure + HttpOnly + SameSite=Strict 관리자 세션
- 관리자 API CSRF 토큰 검증
- same-origin Origin 검증
- 업로드 가능한 GitHub 경로는 코드의 9개 슬롯으로 고정
- GitHub App은 저장소 `bellemyunail1` 하나만 설치
- 설치 토큰 요청 시에도 repository=`bellemyunail1`, contents=`write`로 다시 축소
- Private Key / Client Secret은 Cloudflare Secret에만 저장
- 관리자 경로 noindex
- 관리자 CSP / frame-ancestors none

---

## 결제 화면이 나오면

이 설정 과정에서 필요한 메뉴는 Workers Free와 GitHub App 설정뿐입니다. R2, Zero Trust, Access, Marketplace 구매 화면으로 들어갈 필요가 없습니다.

카드/PayPal/결제수단 입력 화면이 보이면 입력하지 말고 그 화면을 닫습니다. 이 프로젝트 구성에서는 그 유료 기능을 사용할 필요가 없습니다.
