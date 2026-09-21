# 관리자 설정 — 현재 최종 구조

공개 사이트는 그대로 두고 `/admin`과 `/admin/*`만 Cloudflare Access로 보호합니다.

필요한 Cloudflare Worker 값:

- `TEAM_DOMAIN` — 예: `https://내팀이름.cloudflareaccess.com`
- `POLICY_AUD` — Access Application Audience (AUD) Tag
- `ADMIN_EMAILS` — 선택이지만 권장. 예: `me@gmail.com`
- `GITHUB_TOKEN` — GitHub Fine-grained PAT (Secret)

중요: 이 프로젝트는 Workers Static Assets를 사용하므로 `ctx.access`가 user Worker까지 전달되지 않는 현재 Cloudflare 제약을 피하기 위해, `Cf-Access-Jwt-Assertion` 헤더를 `jose`로 직접 검증합니다.

## Access 애플리케이션

Zero Trust > Access controls > Applications > Add application > Self-hosted.

보호 대상은 Worker의 workers.dev hostname에서 다음 두 경로를 모두 추가:

- `/admin`
- `/admin/*`

Allow 정책은 관리자 이메일 1개만 지정.

## GitHub token

GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens.

- Repository access: Only select repositories
- Repository: `tambleofficial/bellemyunail1`
- Repository permissions: Contents = Read and write
- 나머지 추가 권한 없음

Cloudflare Worker > Settings > Variables and Secrets에서 `GITHUB_TOKEN`을 Secret으로 추가.
