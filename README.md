# BELLEMYUNAIL

청주 네일 SEO 중심의 Cloudflare Workers Static Assets 사이트입니다.

## 최종 운영 구조
- Cloudflare Worker 1개
- GitHub 저장소 `tambleofficial/bellemyunail1`
- Cloudflare Access: `/admin*`만 보호
- 관리자 이미지 변경: GitHub Contents API -> 자동 Worker 재배포
- Cloudflare Secret: `GITHUB_TOKEN` 하나
- R2 / Pages / KV / D1 미사용

최초 설정은 `SETUP-KO.md`, 빠른 순서는 `QUICKSTART-KO.txt`를 보세요.
