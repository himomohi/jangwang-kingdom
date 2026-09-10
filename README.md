# 잔광왕국 (Jangwang Kingdom)

늦을 90년대 한국 2D 탑다운 판타지 MMO **감성**의 오리지널 단편 액션 RPG.

Actoz Soft《마지막왕국1》의 **공식 명칭·맵·스킬명·캐릭터·UI 아트·자산을 쓰지 않습니다.** 리메이크/리마스터/클론이 아닙니다.

마을 허브 **잔광성 외곽(Embergate)** 에서 평민으로 시작해, 들판 사냥 → 룻/장착 → 레벨 5 이후 성문 교관에게 전직합니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 Vite가 안내하는 주소(기본 `http://localhost:5173/jangwang-kingdom/`)로 엽니다. `base`가 `/jangwang-kingdom/` 이라 루트(`/`)가 아니라 해당 경로로 접속해야 합니다.

```bash
npm run build
npm run preview
```

GitHub Pages 배포 경로: `https://<user>.github.io/jangwang-kingdom/`

```bash
npm run deploy
```

## 조작

| 키 | 동작 |
|----|------|
| WASD / 방향키 | 이동 |
| Shift | 조금 더 빠르게 |
| Space / 클릭 | 기본 공격 |
| E | 상호작용 (교관, 여관, 우물) |
| 1 | 기본 공격 |
| 2 | 전직기 (전직 후) |
| 3–5 | 소모품 |
| I | 가방 |
| H / Esc | 도움말·대화 닫기 |

## 콘텐츠 (A–B 선적 + D 방향 스트레치)

- 고정 타임스텝 시뮬레이션, 입력, 카메라
- 시드 청크 들판 + 손배치 마을/석실
- 평민 → 왕국기사 / 검객 / 비전술사 / 성소무녀 (`knight` `blader` `arcanist` `shrine`)
- 적: 들판 슬라임, 들늑대, 길목 도적, 석실 그늘 + 엘리트 **철갑감시자**
- 코드젠 픽셀 본체(관절·재료·망토/투구/무기) + 캐시. 16색은 `docs/palette-v1.md`(main `d972d54`)와 `src/art/palette.ts`에 동일 hex로 잠금, `#000` 아웃라인 없음
- `public/sprites/` 기사·슬라임 PNG는 선택 오버레이(α≤0.32). 실루엣을 PNG로 대체하지 않음
- 세계만 WebGL 블룸/CRT. HUD는 DOM
- Web Audio 효과음·짧은 잔광 모티프
- 의뢰: 왕국 외곽 들판에서 슬라임·도적 처치 후 성문 교관 찾기

## 스택

TypeScript + Vite + Canvas 2D 세계 + WebGL 후처리 + DOM UI + Web Audio.

Phaser / Pixi / Three / 런타임 생성형 아트 API 없음. `public/sprites/` 는 선택 오버레이 자리만 둡니다.

## 알려진 한계 (H 완성 아님)

이 선적은 **A–B 플레이 루프**입니다. 멀티맵 던전, 파티, 거래소, 풀 스킬트리, 컷신, 사운드트랙, 스팀 업적급 콘텐츠는 없습니다.

## 법적

호모지(감성 오마주)만. 원작 IP를 사칭하지 않습니다.
