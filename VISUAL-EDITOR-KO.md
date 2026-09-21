# 벨르뮤네일 비주얼 관리자

## 핵심 구조

공개 페이지는 완전한 정적 파일입니다.

- `/`
- `/nail-design/`
- `/process/`
- `/portfolio/`
- `/visit/`
- `/faq/`

일반 방문자가 위 페이지를 볼 때 Worker 코드는 실행되지 않습니다. HTML/CSS/JS/이미지는 Cloudflare Static Assets에서 바로 제공됩니다.

Worker는 `/admin`과 `/admin/*`에서만 실행됩니다.

## 관리자에서 수정 가능한 것

- 홈 문구/사진
- 네일 디자인 문구/사진
- 시술 과정 문구/사진
- 포트폴리오 문구/사진
- 방문 안내 문구/사진
- FAQ 질문/답변

관리자 화면은 실제 공개 페이지를 iframe으로 보여주며, 수정 가능한 문구와 사진을 클릭하면 오른쪽 편집창이 열립니다.

## 저장 방식

관리자가 여러 항목을 수정한 뒤 `전체 저장 및 배포`를 누르면 Worker가 다음 파일들을 한 번의 GitHub 커밋으로 갱신합니다.

1. 공개 HTML 6개
2. 변경된 WebP 이미지
3. `public/content/site-content.json` 편집 상태 파일

이후 GitHub와 연결된 Cloudflare Workers Build가 자동으로 재배포합니다.

따라서 공개 페이지를 볼 때 문구를 실시간으로 JSON에서 주입하지 않습니다. 배포된 HTML 안에 최종 문구가 이미 들어 있습니다.

## 보안

- 문구는 HTML로 저장하지 않고 plain text로 처리합니다.
- Worker의 HTMLRewriter `setInnerContent()`를 HTML 모드 없이 사용하므로 `<script>` 같은 입력은 실행 코드가 되지 않습니다.
- 이미지 슬롯은 코드에 정의된 9개 경로만 수정 가능합니다.
- 업로드 이미지는 WebP, 10MB 이하, 4096px 이하를 서버에서 다시 검증합니다.
- GitHub App private key와 client secret은 Cloudflare Secret에만 둡니다.
- GitHub App 설치 토큰은 저장할 때만 생성합니다.

## 마퀴 이미지

화면에서는 같은 사진이 여러 번 반복되어도 관리자에서는 슬롯 하나만 관리합니다.
예를 들어 `nail-02`를 한 번 바꾸면 해당 슬롯을 사용하는 마퀴 복제본과 세부 페이지 사진이 모두 함께 변경됩니다.
