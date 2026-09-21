# 모바일 최적화 적용 사항

이 빌드는 공개 사이트 6개 페이지와 관리자 화면을 모바일 우선으로 재점검한 버전입니다.

- 320 / 360 / 390 / 430px 가로폭에서 수평 오버플로우 검사 완료
- iPhone/Android notch 대응 `viewport-fit=cover` + safe-area 적용
- 모바일 메뉴: 44px 이상 터치영역, 배경 잠금, 바깥 클릭/Esc 닫기, 현재 페이지 강조
- 히어로/제목/본문/섹션 여백을 360~390px 기준 재조정
- CTA 버튼 44~50px 이상 터치영역 및 소형 화면 1열 전환
- 포트폴리오 2열 4:5 썸네일로 모바일 스크롤 길이와 크롭 균형 개선
- Process/FAQ/Visit 카드 모바일 레이아웃 재구성
- 모바일 footer 링크를 2열 터치형 메뉴로 변경
- `prefers-reduced-motion`, `focus-visible`, tap highlight 대응
- 첫 히어로 이미지 `fetchpriority=high`, 하단 이미지 lazy loading + async decode
- 관리자: 1열 카드, 큰 업로드 버튼, 모바일 파일 입력, 업로드 전 변환 이미지 미리보기
- 관리자 이미지 디코딩 시 `createImageBitmap` 미지원 브라우저 fallback 추가

코드/정적 파일은 기존 Workers + R2 + Cloudflare Access 구조를 그대로 유지합니다.
