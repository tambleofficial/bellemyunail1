# Static Publish 구조

## 일반 방문자

`HTML / CSS / JS / 이미지 -> Cloudflare Static Assets`

공개 페이지에는 `run_worker_first`를 사용하지 않습니다.

## 관리자

`/admin/* -> Worker -> GitHub App -> GitHub commit -> Cloudflare 자동 재배포`

## 비용/트래픽 관점

공개 페이지와 이미지 요청은 Static Assets로 처리되고 Worker 요청 한도를 사용하지 않도록 구성했습니다.
Worker 실행은 관리자 로그인, 관리자 API, 저장 작업에 집중됩니다.

## 기존 설정에서 추가로 필요한 것

없습니다. 기존에 등록한 GitHub App Secret과 아래 변수 그대로 사용합니다.

- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY`
- `ADMIN_GITHUB_USER_ID`
- `GITHUB_OWNER=tambleofficial`
- `GITHUB_REPO=bellemyunail1`
- `GITHUB_BRANCH=main`
