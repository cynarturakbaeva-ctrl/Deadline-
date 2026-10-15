# Embedded fonts

The delivered PPTX is editable, so slide text uses Office fonts present in every PowerPoint / Google Slides:
**Calibri** (text) and **Times New Roman** (display serif). The internal HTML renderer measures and draws with
their metric-compatible open clones, registered under the Office names in design/style.js:

- `Text-Regular.ttf`, `Text-Bold.ttf` — Carlito (SIL OFL 1.1), metric-compatible with Calibri.
- `Serif-Regular.ttf`, `Serif-Bold.ttf`, `Serif-Italic.ttf` — Liberation Serif (SIL OFL 1.1), metric-compatible with Times New Roman.
- `Arial-Regular.ttf`, `Arial-Bold.ttf`, `Arial-Italic.ttf` — Liberation Sans 2.1 (SIL OFL 1.1), metric-compatible with Arial.
- `Mono-Regular.ttf`, `Mono-Bold.ttf` — Liberation Mono 2.1 (SIL OFL 1.1), metric-compatible with Courier New (labels only).

Subset to Latin, Latin-1, Latin Extended-A, Cyrillic (full Kazakh: Ә Ғ Қ Ң Ө Ұ Ү Һ І), punctuation, ₸ and №.
`DisplaySerif.ttf` (Lora) is kept for the legacy builder only.
