# BELLEMYU NAIL — Cloudflare Workers 배포 설정

이 프로젝트는 **Workers 1개 + R2 1개 + Cloudflare Access**만 사용합니다. Pages 프로젝트는 필요하지 않습니다.

## 1) 준비

- Cloudflare 계정
- GitHub 저장소(선택: Git 자동배포를 쓸 경우)
- Node.js 20+ 권장

## 2) R2 버킷 생성

버킷 이름은 코드에 이미 `bellemyunail-media`로 설정되어 있습니다.

CLI:

```bash
npm install
npx wrangler login
npm run r2:create
```

또는 Cloudflare Dashboard > R2에서 `bellemyunail-media`를 생성하세요.

## 3) 최초 배포

```bash
npm install
npm run deploy
```

배포 후 주소는 대략 아래 형태입니다.

```text
https://bellemyunail.<내-workers-dev-subdomain>.workers.dev
```

`wrangler.jsonc`의 Worker 이름은 `bellemyunail`입니다.

## 4) Cloudflare Access — 관리자만 보호

**Worker 전체를 Access로 잠그면 홈페이지까지 로그인해야 하므로 그렇게 설정하면 안 됩니다.**

Cloudflare Zero Trust > Access controls > Applications에서 Self-hosted application을 만들고, 배포된 workers.dev 주소의 `/admin*` 경로만 보호하세요.

예시:

```text
bellemyunail.my-subdomain.workers.dev/admin*
```

정책은 관리자 본인 이메일만 `Allow` 하도록 설정하는 것을 권장합니다.

`/admin*` 안에 관리자 화면과 `/admin/api/*`가 모두 들어 있으므로 한 경로로 같이 보호됩니다.

Worker 코드에서도 Access가 추가하는 JWT의 **서명, issuer, audience**를 다시 검증합니다. Workers Static Assets의 내부 라우터 환경에서도 확실하게 검증하기 위해 `ctx.access`만 믿지 않고 공식 `Cf-Access-Jwt-Assertion` 헤더를 검증합니다.

Access Application을 만든 뒤 아래 2개 값을 확인하세요.

- `TEAM_DOMAIN`: `https://<팀이름>.cloudflareaccess.com`
- `POLICY_AUD`: 해당 Access Application의 Audience (AUD) Tag

CLI로 Secret 등록:

```bash
npx wrangler secret put TEAM_DOMAIN
npx wrangler secret put POLICY_AUD
```

선택적으로 Worker에서도 관리자 이메일을 한 번 더 고정하려면:

```bash
npx wrangler secret put ADMIN_EMAILS
```

값 예시:

```text
owner@example.com
```

여러 명이면 쉼표로 구분합니다. Access 정책을 정확한 관리자 이메일로 제한했다면 `ADMIN_EMAILS`는 생략해도 됩니다.

세 값은 GitHub 코드에 직접 넣지 않는 것을 권장합니다. Access를 설정하지 않았거나 JWT 환경변수가 없으면 `/admin*`은 Worker에서 403으로 거부되는 것이 정상입니다.

## 5) 관리자 사용

```text
https://bellemyunail.<내-subdomain>.workers.dev/admin/
```

사진 업로드 규칙:

- JPG / JPEG / PNG / WebP
- 원본 최대 10MB
- 원본 가로/세로 최대 4096px
- 브라우저에서 최대 폭 1920px로 축소
- WebP 품질 82% 변환(브라우저 미지원 시 JPEG 86%)
- Canvas 재인코딩으로 일반적인 EXIF/GPS 메타데이터 제거
- 업로드 버튼 클릭 후 Worker가 실제 파일 시그니처, 용량, 해상도를 다시 검증
- R2 API 키는 프론트엔드에 노출되지 않음

업로드가 완료되면 R2의 동일 슬롯을 교체하고 새 버전 URL을 사용합니다. 공개 페이지는 새로고침하면 새 사진을 사용합니다.

## 6) GitHub 자동 배포(권장)

Cloudflare Dashboard > Workers & Pages > Create / Import repository에서 이 GitHub 저장소를 연결합니다.

- Worker name: `bellemyunail`
- Root directory: 저장소 루트
- Deploy command: `npx wrangler deploy`

R2 `bellemyunail-media` 버킷은 먼저 만들어 두세요.

이후 `main`에 push하면 Worker 코드 + Static Assets가 같이 자동 배포됩니다.

## 7) SEO 구성

이미 포함된 항목:

- 핵심 키워드: `청주 네일`
- 페이지별 고유 `<title>` / meta description
- Home + 5개 세부페이지
- 시맨틱 H1/H2 구조
- 이미지 alt
- BeautySalon 구조화 데이터
- FAQPage 구조화 데이터
- 동적 `/sitemap.xml`
- 동적 `/robots.txt`
- 관리자 `noindex`
- 모바일 반응형
- 초기 사진은 정적 WebP로 최적화

현재 `workers.dev` 주소로도 동작하지만, 향후 실제 사업용 커스텀 도메인을 연결하면 검색 브랜딩 측면에서는 더 좋습니다. 도메인을 연결해도 코드 변경은 거의 필요 없습니다. sitemap/robots는 요청 도메인을 자동 사용합니다.

## 8) 현재 비워둔 사업 정보

사용자가 정확한 주소, 전화번호, 예약 URL, 인스타그램, 운영시간을 제공하지 않았기 때문에 임의로 만들지 않았습니다. `/visit/`은 허위 정보 없이 배포 가능한 문구로 구성되어 있습니다.

이 정보가 정해지면 Visit 페이지와 구조화 데이터에 실제 값을 추가하는 것이 로컬 SEO에 유리합니다.
