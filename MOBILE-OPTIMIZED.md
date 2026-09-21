# 모바일 최적화

320 / 360 / 390 / 430px급 화면을 고려해 공개 페이지와 관리자 페이지를 모바일 우선으로 조정했습니다.

- 모바일 메뉴 / 스크롤 잠금 / ESC·외부 클릭 닫기
- 44px 이상 주요 터치 영역
- 작은 화면 타이포 및 CTA 재배치
- 포트폴리오 모바일 2열
- Visit / Process / FAQ 모바일 레이아웃
- Safe Area 대응
- 이미지 lazy loading / async decode
- prefers-reduced-motion 대응
- 관리자 1열 및 업로드 미리보기

저장 구조는 Cloudflare Worker + GitHub App + GitHub 저장소이며 R2와 Cloudflare Access는 사용하지 않습니다.
