# 잔광왕국 (Jangwang Kingdom)

90년대 후반 국산 탑다운 판타지 MMO의 **감성**을 오마주한 **오리지널 IP** 브라우저 액션 RPG.
특정 회사의 명칭·맵·에셋·캐릭터·UI를 복제하지 않습니다.

🎮 플레이: https://himomohi.github.io/jangwang-kingdom/

## 게임 소개

- 탐색·전투·전리품·장비·성장·전직의 싱글플레이 탑다운 액션 RPG
- 거점: **엠버게이트**(잔광성 외곽) — 전직관·상인·여관·경비대장
- 직업: 평민 → **왕국기사 / 검객 / 비전술사 / 성소무녀** (Lv.5 전직)
- 적: 슬라임·들늑대·노상강도·잔영 + 정예 **철갑감시자** (북쪽 제단)
- 낮/밤 사이클, 조명, WebGL bloom/CRT 포스트, 절차적 Web Audio BGM·효과음
- 모바일 완벽 지원: 가상 조이스틱 + 공격/스킬/대화/물약 버튼

## 조작법

| 동작 | PC | 모바일 |
|---|---|---|
| 이동 | WASD / 방향키 | 좌측 조이스틱 |
| 공격 | J / Z / 스페이스 | ⚔️ |
| 스킬 | K / X / Shift | ✨ |
| 대화/상호작용 | E / F / Enter | 💬 |
| 물약 | P | 🧪 |
| 가방/상태 | I / C | 우상단 버튼 |
| 음소거/메뉴 | M / Esc | 우상단 버튼 |

## 개발

```bash
npm install
npm run dev      # 개발 서버
npm run smoke    # 헤드리스 시뮬레이션 테스트 (89개)
npm run build    # 타입체크 + 프로덕션 빌드
node scripts/e2e.mjs  # 헤드리스 Chrome E2E (dist 필요)
```

## 스택

TypeScript + Vite + Canvas 2D(월드) + WebGL bloom/CRT(월드 전용) + DOM UI + Web Audio.
Phaser / Pixi / Three 미사용. 런타임 생성형 AI 아트 API 미사용.

- 전투/전리품/XP/장비는 **sim에서만** 결정 (`src/sim/`)
- 16색 고정 팔레트 (`src/art/palette.ts`) — 코드젠 바디가 주, `public/sprites/` 오버레이는 저알파 힌트
- Vite `base: '/jangwang-kingdom/'` (GitHub Pages)

## 배포

```bash
npm run build
# dist/ 를 gh-pages 브랜치에 푸시 → Pages served
```

현재 범위: A→E 완성 (부팅·전투 사이클·마을+필드·조명/포스트·모바일 UI) + F(세이브).
