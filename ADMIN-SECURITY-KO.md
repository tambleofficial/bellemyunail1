# 관리자 보안 요약

이 버전은 Cloudflare Access나 R2를 사용하지 않습니다.

관리자 인증은 GitHub App OAuth로 처리하며, OAuth state + PKCE(S256) 이후 GitHub API `/user`의 숫자 User ID가 `ADMIN_GITHUB_USER_ID`와 정확히 일치할 때만 8시간짜리 서명 세션 쿠키를 발급합니다.

이미지 저장 시 브라우저의 GitHub 토큰을 사용하지 않습니다. Worker가 GitHub App Private Key로 짧은 JWT를 만들고, 해당 App이 실제 `tambleofficial/bellemyunail1`에 설치됐는지 API로 확인한 뒤 그 저장소 하나 + Contents write 권한으로 제한된 설치 토큰을 발급받아 커밋합니다. 설치 토큰은 GitHub에서 1시간 만료됩니다.

업로드 API는 세션, CSRF, Origin, 슬롯 whitelist, WebP magic bytes, 용량, 실제 해상도를 다시 검증합니다.
