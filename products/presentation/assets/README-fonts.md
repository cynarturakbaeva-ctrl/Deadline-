# Embedded fonts

- `InterVariable.woff2` — text face (Inter, SIL OFL 1.1). Loaded by design/style.js when present.
- `DisplaySerif.ttf` — Lora variable (SIL OFL 1.1), display face for the "editorial" tone.
  Full Kazakh Cyrillic coverage (Ә Ғ Қ Ң Ө Ұ Ү Һ І) verified via cmap.

Both are base64-embedded into the generated HTML so output looks identical on any server.
If a file is missing the engine falls back to the system stack defined in design/tokens.js.
