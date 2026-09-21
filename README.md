# bellemyunail

청주 네일 벨르뮤네일 공식 사이트 + GitHub App 기반 관리자 사진 교체 기능입니다.

## 고정 구조

- Cloudflare Worker 1개 (Static Assets + Worker API)
- GitHub 저장소 `tambleofficial/bellemyunail1`
- GitHub App 1개
- R2 사용 안 함
- Cloudflare Zero Trust / Access 사용 안 함
- GitHub PAT 사용 안 함
- 카드/결제 기능을 사용하는 구성요소 없음

## 관리자 주소

`https://<현재 Worker 주소>/admin/`

관리자 로그인은 GitHub App OAuth로 처리합니다. 등록된 GitHub 숫자 User ID와 정확히 일치하는 계정만 세션을 발급받습니다.

## 사진 업로드

관리자 브라우저에서 JPG/JPEG/PNG/WebP를 선택하면 최대 폭 1920px WebP로 재인코딩합니다. Worker가 다시 파일 시그니처/용량/해상도를 검사한 뒤 GitHub App 설치 토큰으로 `public/assets/images/*.webp`만 교체합니다. 커밋이 생성되면 기존 Cloudflare Git 연동이 자동 재배포합니다.

설정은 `SETUP-GITHUB-APP-KO.md`를 그대로 따라가면 됩니다.
