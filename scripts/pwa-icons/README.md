# Ícones PWA

Logótipo final A «Parafuso pentalobe» (aprovado a 2026-10-07). Os ficheiros
mestre e o gerador estão no design system do projeto
(`design-system/logos/final-a/`, gerador `src/logo_final_a.py`); aqui ficam só
as fontes que a app precisa:

- `logo-square.svg` — símbolo a toda a área (`rx="0"`), sem cantos
  transparentes: `apple-touch-icon.png`.
- `logo-maskable.svg` — o mesmo, com a cabeça do parafuso reduzida a 80 %
  para caber no círculo seguro do Android: `icon-maskable-512.png`.
- `public/logo-mark.svg` — símbolo com cantos arredondados: `icon-192.png`,
  `icon-512.png`, `favicon-32.png`.
- `public/favicon.svg` — versão simplificada para 16 px (sem bisel,
  encaixe mais grosso); `public/favicon.ico` tem 16/32/48.

Para regenerar à mão (sem dependência no projeto):

```bash
cd public/icons
bunx sharp-cli -i ../logo-mark.svg -o icon-192.png resize 192 192
bunx sharp-cli -i ../logo-mark.svg -o icon-512.png resize 512 512
bunx sharp-cli -i ../../scripts/pwa-icons/logo-maskable.svg -o icon-maskable-512.png resize 512 512
bunx sharp-cli -i ../../scripts/pwa-icons/logo-square.svg -o apple-touch-icon.png resize 180 180
bunx sharp-cli -i ../favicon.svg -o favicon-32.png resize 32 32
```
