# PWA icon sources

`logo-square.svg` = `public/logo-mark.svg` with `rx="0"` (full-bleed square) —
maskable icons and apple-touch-icon must not have transparent corners.

Regenerate the PNGs in `public/icons/` with sharp-cli (no project dependency):

```bash
cd public/icons
bunx sharp-cli -i ../logo-mark.svg -o icon-192.png resize 192 192
bunx sharp-cli -i ../logo-mark.svg -o icon-512.png resize 512 512
bunx sharp-cli -i ../../scripts/pwa-icons/logo-square.svg -o icon-maskable-512.png resize 512 512
bunx sharp-cli -i ../../scripts/pwa-icons/logo-square.svg -o apple-touch-icon.png resize 180 180
bunx sharp-cli -i ../logo-mark.svg -o favicon-32.png resize 32 32
```

If the logo changes, regenerate `logo-square.svg` first:
`sed 's/rx="11"/rx="0"/' public/logo-mark.svg > scripts/pwa-icons/logo-square.svg`
