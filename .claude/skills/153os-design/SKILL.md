---
name: 153os-design
description: 153복싱짐 153-boxing-os CRM의 화면·UI·스타일·컴포넌트를 만들거나 다듬을 때 반드시 사용. "디자인", "UI", "화면", "예쁘게", "아이폰처럼", "레이아웃", "스타일", "컴포넌트", "버튼", "카드", "색상" 같은 키워드 또는 React/Tailwind 화면 작업이 등장하면 무조건 트리거. 애플 HIG에서 영감받은 아이폰풍 디자인 시스템 — 절제된 색, 넉넉한 여백, 부드러운 모서리·그림자, 명료한 위계를 강제한다. globals.css의 디자인 토큰을 정본으로 삼고 새 색·반경 하드코딩을 금지한다. 153-boxing-os UI 작업에만 사용 — game-fit-quests에는 쓰지 말 것.
---

# 153 BOXING OS — 아이폰풍 디자인 시스템

153-boxing-os CRM의 UI를 만들거나 다듬을 때 적용하는 디자인 가이드다. 목표는 애플 HIG의 느낌 — **명료함, 절제, 부드러운 깊이**. 화면을 새로 만들거나 기존 화면을 손볼 때 아래 규칙을 통과시킨다.

## 0. 정본 토큰 — 새 색을 만들지 말 것

색·반경·그림자는 `apps/crm/src/styles/globals.css`의 CSS 변수가 정본이다. `tailwind.config.ts`가 이를 Tailwind 클래스로 노출한다. **`#hex`나 임의 `hsl()`을 하드코딩하지 않는다.** 항상 토큰 클래스를 쓴다.

- 면: `bg-background`(페이지) · `bg-card`(카드, 흰색) · `bg-muted`(보조면)
- 글자: `text-foreground`(주) · `text-muted-foreground`(보조)
- 강조: `bg-primary`/`text-primary` (브랜드 레드) · `border-border` · `ring-ring`
- 상태: `success`(녹색) · `warning`(주황) · `danger`(빨강)
- 폰트: Pretendard (SF Pro 대응) — 이미 적용됨. 숫자는 `tabular`로 자릿수 정렬.

## 1. 핵심 원칙

1. **절제된 색.** 화면의 90%는 중립색(흰 카드 + 연회색 배경 + 회색 글자)이다. 브랜드 레드는 1차 버튼·활성 상태·중요 강조에만 점으로 쓴다. 넓은 빨강 면은 만들지 않는다.
2. **넉넉한 여백.** 빽빽함은 아이폰풍의 반대다. 카드 안팎으로 공간을 충분히 둔다.
3. **부드러운 형태.** 큰 모서리와 옅은 그림자. 날카로운 직각·진한 그림자·두꺼운 테두리를 피한다.
4. **명료한 위계.** 제목 → 본문 → 보조 텍스트가 크기·굵기·색으로 분명히 구분되게.
5. **얕은 깊이.** 그림자는 "살짝 떠 있는" 정도. 입체감을 과하게 주지 않는다.

## 2. 레이아웃 · 여백

- 페이지 루트: `space-y-6` (섹션 간), 필요 시 `max-w-5xl` 등으로 폭 제한.
- 카드 내부 패딩: `p-5` 기본, 여유가 필요하면 `p-6`. 좁은 칩·행은 예외.
- 요소 간 간격: `space-y-3` ~ `space-y-5`. 한 화면에서 간격 스케일을 일관되게.
- 간격은 Tailwind 스케일(4의 배수)만 사용. 임의 `px` 금지.
- 모바일 우선: `grid-cols-1` → `sm:grid-cols-2` → `lg:grid-cols-*` 순으로 확장.

## 3. 모서리 · 그림자

- 카드·패널·모달: `rounded-2xl`. 작은 카드는 `rounded-xl`.
- 버튼·인풋·select: `rounded-lg` ~ `rounded-xl`.
- 뱃지·상태칩·아바타: `rounded-full`.
- 그림자: 카드는 `shadow-card` 하나만. 떠 있는 요소(모달·팝오버)는 `shadow-card-md`.
- **금지**: 한 화면에서 모서리 크기를 뒤죽박죽 섞기, 진하거나 여러 겹인 그림자, `border-2` 이상의 두꺼운 테두리.

## 4. 색 규율

- 기본 면은 `bg-card`(흰색), 그 위 보조 영역은 `bg-muted/40` ~ `bg-muted/60`.
- 테두리는 `border-border` 한 종류. 옅게 유지.
- 브랜드 레드(`bg-primary`)는 1차 액션 버튼, 활성 탭 밑줄/표시, 핵심 숫자 강조에만.
- 상태 표현은 "연한 배경 + 진한 글자" 칩으로: `bg-success/10 text-success`, `bg-warning/10 text-warning`, `bg-danger/10 text-danger`. 꽉 찬 상태색 배경은 피한다.
- 사이드바는 의도적으로 다크(`bg-sidebar`) — 본문 영역과 대비를 준다.

## 5. 타이포그래피

- 페이지 제목: `text-2xl font-black text-foreground`.
- 섹션 제목: `text-sm font-bold` 또는 `text-base font-bold`.
- 본문: `text-sm text-foreground`. 보조 설명: `text-xs text-muted-foreground`.
- 라벨(폼 필드 위): `text-xs font-medium text-muted-foreground`. 대문자 트래킹 라벨(`uppercase tracking-wide`)은 섹션 구분용으로만 절제해서.
- 큰 숫자(통계): `text-2xl font-black` + `tabular`. 단위는 작게 `text-xs text-muted-foreground`.
- 한 화면에 글자 크기 단계를 너무 많이 쓰지 않는다 — 3~4단계로.

## 6. 컴포넌트 패턴 (iOS풍)

- **카드**: `rounded-2xl border border-border bg-card p-5 shadow-card`. 제목 + 내용 + 액션 순.
- **버튼**: 1차 `bg-primary text-primary-foreground` / 2차 `variant="outline"` / 3차 `variant="ghost"`. 높이는 넉넉하게(터치 타깃 44px 지향), 아이콘+텍스트는 `gap-2`.
- **인풋·select**: `rounded-lg border border-border bg-background px-3`, 높이 `h-10`, 포커스 `focus:ring-2 focus:ring-ring focus:outline-none`.
- **리스트**: iOS 설정앱식 — 카드 하나 안에 행들을 넣고 행 사이는 `divide-y divide-border/60`. 행 패딩 넉넉히, 우측에 chevron·토글.
- **탭/세그먼트**: 밑줄 탭(`border-b-2`, 활성만 `border-primary text-primary`) 또는 pill 세그먼트. 활성 외에는 `text-muted-foreground`.
- **모달/시트**: 배경 `bg-black/40 backdrop-blur-sm`, 본체 `rounded-2xl bg-card shadow-card-md`. 헤더(아이콘+제목+닫기) → 본문 → 액션.
- **상태 칩/뱃지**: `rounded-full px-2 py-0.5 text-xs font-medium` + 연배경·진글자.
- **빈 상태**: 중앙 정렬, 작은 아이콘 + 한 줄 안내(`text-sm text-muted-foreground`). 과한 일러스트 없이 담백하게.
- **로딩**: `animate-pulse` 스켈레톤(`rounded-xl bg-muted`)으로 레이아웃을 미리 보여준다.

## 7. 모션

- 전환은 짧고 부드럽게: `transition-colors`/`transition-all` 150~200ms.
- 등장 효과는 기존 키프레임 `animate-fade-in`(0.2s)·`animate-slide-in`(0.15s)을 재사용.
- 과한 애니메이션·튀는 효과·긴 지연은 피한다.

## 8. 절대 금지

- `#hex`·임의 `hsl()` 하드코딩 — 토큰 클래스만.
- 넓은 면적의 브랜드 레드 배경.
- 진한·다중 그림자, `border-2`+ 두꺼운 테두리.
- 빽빽한 레이아웃(여백 부족), 일관성 없는 모서리 크기.
- 한 화면에 글자 크기 단계 남발.

## 9. 작업 체크리스트

UI를 만들거나 고치기 전에 빠르게 통과시킨다.

1. 색을 토큰 클래스로만 썼는가? (`#hex` 없음)
2. 카드 `rounded-2xl` + `shadow-card`, 버튼·인풋 `rounded-lg`+ 로 모서리가 일관적인가?
3. 빨강을 액션·강조에만 점으로 썼는가? (넓은 빨강 면 없음)
4. 카드 패딩·요소 간격이 넉넉하고 일관적인가?
5. 제목/본문/보조 텍스트 위계가 분명한가?
6. 상태는 "연배경+진글자" 칩으로 표현했는가?
7. 빈 상태·로딩 상태를 담백하게 처리했는가?

하나라도 어긋나면 고친 뒤 진행한다.
