# 박현민 AI 오피스

현민님 전용 모바일 PWA. 나리·달이·혜민·뮤즈·키링과 한 화면에서 지시하고 현황을 보는 오피스입니다.
2차 버전부터 **Supabase 공용 DB(hyunmin-office)** 에 대화·메모가 저장되고, 폰·PC·나리·달이가 같은 방을 실시간으로 봅니다.

- 주소: https://onecutstudio3-lgtm.github.io/hyunmin-office/
- 공용 DB: https://xwylmxghvlvhgizrjhqm.supabase.co (organization `OneCutStudio` / Free, 리전 ap-northeast-2 서울)
- 구성: 정적 파일만 (index.html · app.js · manifest.json · sw.js · 아이콘)

## 설치 (Android 크롬 / 삼성 인터넷)

1. 위 주소를 폰 브라우저로 엽니다.
2. 메뉴에서 **홈 화면에 추가**를 누릅니다. (크롬은 주소창 오른쪽 ⋮ → 홈 화면에 추가)
3. 홈 아이콘으로 실행하면 주소창 없는 앱 화면으로 열립니다.

## 지금 되는 것

- 맵 / 회의실 / 대시보드 / 캘린더 / AI한도 / 메모 6개 탭
- 회의실: 대회의실(3단계 협의 규칙 안내 고정) · 나리·달이·혜민(🌸 보라핑크)·뮤즈(🌿 민트)·키링 1:1, 지시 보내기 → Supabase `messages` 에 저장 + 실시간 반영
- 메모: Supabase `memos` 에 저장, 공용 DB에서도 삭제
- 하단 상태바: **공용 DB 연결됨 · 실시간 동기화** (Realtime 실패 시 5초 폴링으로 자동 전환)
- 오프라인 실행(서비스 워커 캐시) + 연결이 끊기면 이 기기에 보관했다가 다시 올림
- 설정(⚙️ AI 서버) 시트에서 다른 Supabase 프로젝트로 바꿀 수 있음 (anon 공개 키만)

## 구조

| 파일 | 역할 |
| --- | --- |
| index.html | 화면 전체 (CSS + 마크업) |
| app.js | 앱 로직 — Supabase REST·Realtime 어댑터(`OfficeDB`) |
| manifest.json | 앱 이름·아이콘·standalone 설정 |
| sw.js | 오프라인 캐시 (문서·스크립트는 네트워크 우선) |
| sql/schema.sql | 공용 DB 스키마 원본 (테이블·RLS 정책·Realtime) |
| icon*.png / icon.svg | 홈 화면 아이콘 |

## 배포 방법

GitHub Pages가 이 저장소에서 `gh-pages / (root)`로 설정되어 있습니다.
수정 후에는 `./deploy.sh` — `main`을 올리고 `gh-pages`를 `main`에 맞춰 밀어 올립니다.

## 보안 메모

- 프론트엔드에는 **anon(공개) 키만** 넣습니다. `service_role` 비밀 키는 절대 넣지 않습니다.
- `messages`·`memos` 는 RLS를 켜고 anon 역할에 SELECT/INSERT/DELETE 정책을 준 상태입니다(개인·비서 공용 오피스 설계).
  즉 사이트 주소를 아는 사람은 이 방을 읽고 쓸 수 있습니다. 더 조이려면 `room_key` 같은 한 겹을 추가하면 됩니다.
- DB 비밀번호는 프로젝트 생성에만 쓰고 코드·저장소에 넣지 않았습니다.
