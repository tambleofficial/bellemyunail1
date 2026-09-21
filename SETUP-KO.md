# BELLEMYUNAIL — 최종 설정 (R2 없음)

이 구성으로 고정합니다.

- **Cloudflare Worker 1개**
- **GitHub 저장소 1개** (`tambleofficial/bellemyunail1`)
- **Cloudflare Access** (`/admin*`만 보호)
- **Secret 1개** (`GITHUB_TOKEN`)

R2, Pages, KV, D1, 별도 Worker는 사용하지 않습니다. 결제수단 등록도 필요 없습니다.

## 1. GitHub 저장소 교체
이 ZIP의 프로젝트 내용 전체를 `tambleofficial/bellemyunail1` 저장소의 `main` 브랜치 루트에 올립니다.

기존 R2 버전의 `wrangler.jsonc`가 남아 있으면 배포가 다시 실패하므로 반드시 이 ZIP의 파일로 덮어쓰세요.

## 2. Cloudflare Worker 배포
Workers Builds 설정:

- Project name: `bellemyunail`
- Build command: 비움
- Deploy command: `npx wrangler deploy`
- non-production builds: OFF 권장
- 생성 단계의 전체 Worker `Protect with Cloudflare Access`: OFF

이 버전의 `wrangler.jsonc`에는 R2 binding이 없습니다.

## 3. 관리자 경로만 Access 보호
배포에 성공해서 workers.dev 주소가 생기면 Zero Trust > Access > Applications에서 **Self-hosted application**을 만듭니다.

보호할 주소는 Workers 주소의 `/admin*` 경로만 설정합니다.
정책은 본인 이메일만 `Allow` 하세요.

공개 홈페이지 `/`는 Access 대상에 넣지 않습니다.

이 프로젝트는 Workers Static Assets를 사용하므로 `ctx.access` 대신 Access가 넣어주는 `Cf-Access-Jwt-Assertion` JWT를 Worker가 직접 검증합니다. 따라서 `TEAM_DOMAIN`과 `POLICY_AUD`가 필요합니다.

## 4. GitHub Fine-grained token 생성
GitHub의 Fine-grained personal access token을 생성합니다.

권장 최소 권한:
- Repository access: **Only select repositories**
- Repository: `tambleofficial/bellemyunail1`
- Repository permissions > **Contents: Read and write**
- 다른 권한은 추가하지 않음

이 토큰은 관리자 사진을 교체할 때 지정된 이미지 파일을 GitHub Contents API로 업데이트하는 데만 사용합니다.

## 5. Cloudflare 변수/Secret 등록
Worker 설정에서 다음을 추가합니다.

- `TEAM_DOMAIN=https://<팀이름>.cloudflareaccess.com`
- `POLICY_AUD=<Access Application Audience Tag>`
- `ADMIN_EMAILS=<관리자 이메일>` (권장)
- `GITHUB_TOKEN=<방금 만든 fine-grained token>` (Secret)

토큰은 코드나 GitHub 저장소에 넣지 않습니다.

## 6. 관리자 사진 변경
`https://<worker>.workers.dev/admin/` 접속 -> Access 로그인 -> 사진 선택 -> 저장.

브라우저에서:
- JPG/JPEG/PNG/WebP 입력 허용
- 원본 최대 10MB
- 원본 최대 한 변 4096px
- 최대 폭 1920px
- WebP quality 82%
- Canvas 재인코딩으로 EXIF/GPS 제거

Worker에서 다시:
- `Cf-Access-Jwt-Assertion` JWT 서명/issuer/AUD 인증 확인
- same-origin 확인
- 지정된 9개 슬롯만 허용
- 실제 WebP signature 확인
- 10MB / 4096px 재검사

검증 후 `public/assets/images/*.webp` 중 지정된 한 파일만 GitHub API로 교체합니다.

## 7. 반영 방식
사진 저장 시 GitHub 커밋이 하나 생깁니다. 이미 연결된 Workers Builds가 그 커밋을 감지해 Worker + Static Assets를 자동 재배포합니다.
따라서 사진 변경 후에는 별도로 Cloudflare에서 Deploy 버튼을 누를 필요가 없습니다.

## 보안 요약
- 관리자 경로는 Cloudflare Access에서 본인 이메일만 허용
- Worker에서도 `ctx.access` 존재와 신원을 확인
- GitHub Token은 해당 저장소 1개 + Contents read/write만 허용
- 업로드 API는 정해진 9개 WebP 파일 외에는 수정 불가
- 원본 파일은 브라우저에서 재인코딩되어 EXIF/GPS 제거
- GitHub Token은 Secret에만 존재
