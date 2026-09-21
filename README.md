# BELLEMYU NAIL — Workers Static + GitHub App Visual Editor

Cloudflare Worker Static Assets 기반 벨르뮤네일 사이트입니다.

## 구조

- 공개 사이트: 완전 Static Assets
- 관리자: `/admin/`에서 GitHub App 로그인
- 편집: 실제 화면 클릭 → 오른쪽 즉시 편집
- 편집 항목: HTML marker 자동 발견 (manifest 없음)
- 이미지: 동일 slot의 모든 사용 위치/마퀴 복제 자동 연동
- 저장: 실제 HTML + 변경 이미지 → GitHub 단일 커밋 → Cloudflare 자동 재배포

## 기존 Cloudflare 설정 재사용

필요 Secret / Variable:

- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `ADMIN_GITHUB_USER_ID`
- `GITHUB_OWNER=tambleofficial`
- `GITHUB_REPO=bellemyunail1`
- `GITHUB_BRANCH=main`

기존에 설정되어 있다면 추가 설정은 필요 없습니다. `GITHUB_APP_PRIVATE_KEY`는 이 버전부터 사용하지 않습니다.

## 관리자 보안

자세한 내용은 `VISUAL-EDITOR-KO.md`와 `ADMIN-SECURITY-KO.md` 참고.
