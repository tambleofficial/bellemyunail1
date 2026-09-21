# Static Publish 구조

공개 사이트는 완전 정적입니다.

관리자 저장 시에만 Worker가 GitHub HTML/이미지를 수정하고 한 번의 커밋을 생성합니다.
Cloudflare 자동 배포가 완료된 이후 일반 고객은 완성된 정적 파일만 받습니다.

- 공개 `/`, `/nail-design/`, `/process/`, `/portfolio/`, `/visit/`, `/faq/`: Static Assets
- `/admin`, `/admin/*`: Worker
- R2 / KV / D1 / Zero Trust Access: 사용하지 않음
