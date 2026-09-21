# 관리자 보안 요약

이 버전은 Cloudflare Access, R2, KV, D1을 사용하지 않습니다.

관리자 인증은 GitHub App OAuth로 처리합니다. OAuth `state` + PKCE(S256) 이후 GitHub API `/user`의 숫자 User ID가 `ADMIN_GITHUB_USER_ID`와 정확히 일치할 때만 8시간짜리 서명 세션 쿠키를 발급합니다.

GitHub 자격증명은 브라우저로 보내지지 않습니다. Worker가 GitHub App Private Key로 JWT를 만들고, 현재 `GITHUB_REPO`에 설치된 GitHub App의 installation token을 해당 repo 하나 + Contents write 권한으로 제한해 사용합니다. 작업 후 token revoke도 시도합니다.

관리자 미리보기는 같은-origin DOM 직접 접근 방식이 아닙니다.

- 공개 HTML 원본의 script/iframe/object/embed 제거
- sandbox iframe에서 `allow-scripts`만 사용
- `allow-same-origin` 사용 안 함
- iframe과 부모는 `postMessage`로만 통신
- `event.source` + 매 미리보기마다 새로 만든 nonce를 모두 확인
- 원래 공개 페이지 스크립트는 미리보기에서 실행하지 않음

편집 manifest는 없습니다. Worker가 현재 GitHub HTML의 marker를 매번 자동 발견합니다.

저장 시에는 브라우저가 보낸 key/slot을 신뢰하지 않고 GitHub 최신 HTML을 다시 읽어 실제 marker 존재 여부를 재검증합니다.

문구는 plain text만 허용하고 `HTMLRewriter.setInnerContent()`로 저장합니다. 자유 HTML/JavaScript 저장은 허용하지 않습니다.

사진은 HTML에서 자동 발견된 slot만 허용하며, 보안을 위해 `data-media-slot="abc"`는 반드시 `/assets/images/abc.webp`와 정확히 연결되어야 합니다. 저장 전에 WebP magic bytes, 용량, 실제 해상도를 다시 검증합니다.

편집을 시작한 GitHub commit SHA와 저장 직전 main SHA가 다르면 저장을 거부해 다른 변경을 덮어쓰지 않습니다.


## GitHub 인증 변경

이 버전은 GitHub App Private Key를 사용하지 않습니다. GitHub OAuth 로그인에서 발급되는 만료형 user access token을 AES-GCM으로 암호화한 HttpOnly/Secure/SameSite=Strict 세션 쿠키에 저장하고, 해당 토큰으로 현재 GitHub App과 관리자 사용자 모두 접근 가능한 저장소에만 작업합니다. 로그아웃 시 토큰 revoke를 best-effort로 수행합니다.
