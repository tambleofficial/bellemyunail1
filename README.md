# BELLEMYU NAIL — Static Site + GitHub App Visual CMS

청주 네일 벨르뮤네일 공개 사이트와 GitHub App 기반 비주얼 관리자입니다.

## 최종 구조

- Cloudflare Worker 1개
- Workers Static Assets
- GitHub 저장소 1개 (`tambleofficial/bellemyunail1`)
- GitHub App 인증
- 공개 사이트는 완전 Static
- Worker 실행은 `/admin`과 `/admin/*`만
- R2 없음
- Zero Trust / Cloudflare Access 없음
- 별도 DB 없음

## 공개 페이지

- `/`
- `/nail-design/`
- `/process/`
- `/portfolio/`
- `/visit/`
- `/faq/`

## 관리자

`/admin/`

실제 페이지를 iframe으로 미리보고 문구/사진을 클릭해 수정합니다. 여러 변경사항은 한 번의 GitHub 커밋으로 저장되고 Cloudflare가 자동 재배포합니다.

## 중요

관리자 저장 시 공개 HTML 파일 자체가 갱신됩니다. 일반 방문자가 페이지를 열 때 Worker가 JSON을 읽어 문구를 끼워 넣지 않습니다.

자세한 내용:
- `VISUAL-EDITOR-KO.md`
- `STATIC-PUBLISH-KO.md`
- `SETUP-GITHUB-APP-KO.md`
