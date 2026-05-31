# Auto Write Design System

## Direction

Auto Write의 화면은 회의록을 빠르게 읽고 공유하기 위한 조용한 생산성 도구를 지향한다. 기본은 미니멀하고 정돈된 정보 구조이며, AI 처리 상태와 녹음 인터랙션에 부드러운 모션을 집중한다.

## Visual Tokens

- Canvas: warm off-white background
- Surface: white cards with subtle hairline borders
- Primary: vivid orange for recording, share, main action
- Ink: near-black text for meeting titles and generated notes
- Muted: warm gray for metadata, timestamps, secondary labels
- Status colors:
  - queued/thinking: warm peach
  - transcribing/reading: calm blue
  - summarizing/editing: soft violet
  - completed: gold
  - failed: crimson

## Typography

- Display: large, regular weight, tight tracking
- Title: semibold for card titles and section headers
- Body: 16pt regular with increased line spacing for summaries
- Caption: 11-13pt for status, timestamps, metadata
- Code: monospaced for timestamps

## Components

- Meeting card: rounded white surface, hairline stroke, status pill
- Recording bar: fixed bottom action with high-contrast primary button
- Summary card: grouped sections for abstract, decisions, action items
- Transcript segment: timestamp + speaker label + text block
- Share/export controls: compact action row in meeting detail

## Motion

- Recording indicator pulses while active.
- New meeting cards enter with slight fade and upward movement.
- Processing status changes animate with spring timing.
- Summary/detail tab changes use subtle opacity and movement.
- Export success should use a short confirmation animation once GUI sharing is connected.

## Accessibility

- All primary actions must expose readable text labels.
- Status colors must never be the only status indicator; use text labels too.
- Tap targets should remain at least 44x44pt.
- Summary and export documents must be readable without animations or color.
