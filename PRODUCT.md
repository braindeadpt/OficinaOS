# Product

## Register

product

## Users
Shop owners and technicians at a single-location mobile phone repair shop in Portugal. They use the system on tablets and desktops on a busy shop floor — potentially with greasy hands, under bright fluorescent lighting. EUR currency. Trilingual — European Portuguese is the primary locale (pt, en, fr). The job to be done: track repairs end-to-end (intake → diagnosis → repair → delivery), manage parts inventory, handle customers, and analyze business performance via AI.

## Product Purpose
A precision repair-shop management system that gives shop owners calm control over every job, from intake to delivery. Success means a technician can log a repair, find the right part, and hand the device back to the customer without switching apps or squinting at tiny text. Speed and clarity on a busy shop floor are the measures of quality.

## Brand Personality
**"The Engineering Atelier"** — precision instrument, not a generic tool. Three words: **precise, trustworthy, sophisticated**. The interface should feel like using premium diagnostic equipment — calm control that puts the owner on top of every job. Technical authority without coldness.

## Anti-references
- Generic SaaS dashboards with cookie-cutter sidebar + cards + charts templates
- Any layout that could be mistaken for a CRUD admin panel out of the box

## Design Principles
1. **Tonal Layering Over Lines**: Surface hierarchy through color depth, never 1px borders. Cards float via background contrast, not box-shadows.
2. **Glanceability First**: Shop-floor speed demands instant recognition. Big numbers, clear status indicators, generous spacing to prevent cognitive overload.
3. **Tablet-Native Touch**: All interactive targets ≥ 44px. Crisp tap feedback. No hover-dependent interactions. Fluid layouts for tablet + desktop.
4. **Editorial Data Presentation**: "Small Label / Big Value" spec-sheet pairing. Headlines give data hero presence. Asymmetric grids over uniform card matrices.
5. **Integrated Visual Language**: Statuses, alerts, and errors use the same tonal system. No jarring accent colors that break the calm. Glass overlays for modals, gradient CTAs for primary actions.

## Accessibility & Inclusion
- **Touch targets**: Minimum 44×44px for all interactive elements (shop floor tablet use)
- **Contrast**: WCAG AA compliance in both light and dark modes
- **Motion**: Respect `prefers-reduced-motion` — reduce/disable transitions
- **Color blindness**: Status indicators never rely on color alone; always paired with text or icon