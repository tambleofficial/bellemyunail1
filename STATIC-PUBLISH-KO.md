# Static Publish 구조

공개 사이트는 완전 정적입니다.

관리자 저장 시에만 Worker가 GitHub HTML/이미지를 수정하고 한 번의 커밋을 생성합니다.
Cloudflare 자동 배포가 완료된 이후 일반 고객은 완성된 정적 파일만 받습니다.

- 공개 `/`, `/nail-design/`, `/process/`, `/portfolio/`, `/visit/`, `/faq/`: Static Assets
- `/admin`, `/admin/*`: Worker
- R2 / KV / D1 / Zero Trust Access: 사용하지 않음


## GitHub 인증 변경

이 버전은 GitHub App Private Key를 사용하지 않습니다. GitHub OAuth 로그인에서 발급되는 만료형 user access token을 AES-GCM으로 암호화한 HttpOnly/Secure/SameSite=Strict 세션 쿠키에 저장하고, 해당 토큰으로 현재 GitHub App과 관리자 사용자 모두 접근 가능한 저장소에만 작업합니다. 로그아웃 시 토큰 revoke를 best-effort로 수행합니다.
