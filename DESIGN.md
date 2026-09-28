---
name: OficinaOS
description: Precision repair shop management for the Engineering Atelier
colors:
  reliable-blue: "#0040a1"
  reliable-blue-light: "#0056d2"
  slate-river: "#456080"
  forge-amber: "#822800"
  forge-amber-light: "#a93802"
  calm-rose: "#ba1a1a"
  calm-rose-surface: "#ffdad6"
  steady-green: "#16a34a"
  canvas: "#f7f9ff"
  workspace: "#f1f4fa"
  card-surface: "#ffffff"
  overlay: "#e5e8ee"
  highest-surface: "#dfe3e8"
  ink: "#181c20"
  muted-ink: "#424654"
  ghost-border: "#c3c6d6"
  outline: "#737785"
  primary-fixed: "#dae2ff"
  secondary-container: "#bed9ff"
  tertiary-fixed: "#ffdbcf"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.75
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Karla, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Karla, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Karla, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.025em"
rounded:
  xs: "0.125rem"
  sm: "0.25rem"
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"
  "2xl": "1.5rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "48px"
  "3xl": "64px"
  "4xl": "96px"
components:
  button-primary:
    backgroundColor: "{colors.reliable-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.reliable-blue-light}"
  button-primary-gradient:
    backgroundColor: "linear-gradient(135deg, #0040a1 0%, #0056d2 100%)"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "10px 20px"
  button-secondary:
    backgroundColor: "{colors.highest-surface}"
    textColor: "#2d4867"
    rounded: "{rounded.xl}"
    padding: "10px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.xl}"
    padding: "10px 20px"
  button-destructive:
    backgroundColor: "{colors.calm-rose}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "10px 20px"
  input:
    backgroundColor: "{colors.highest-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "14px 16px"
  input-focus:
    backgroundColor: "{colors.card-surface}"
  metric-card:
    backgroundColor: "{colors.workspace}"
    rounded: "{rounded.xl}"
    padding: "20px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.lg}"
    padding: "12px"
  nav-item-active:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.reliable-blue}"
---

# Design System: OficinaOS

## 1. Overview

**Creative North Star: "The Engineering Atelier"**

In a fast-paced repair environment, a UI should not just be a tool; it should be a precision instrument. This system moves away from the "generic SaaS" look of boxes-inside-boxes. Instead, it embraces a high-end editorial approach that mirrors the technical sophistication of a master mechanic. This is achieved through **Tonal Layering**, using varying depths of light and color rather than harsh lines to organize information. The layout prioritizes "glanceability" for a shop floor while maintaining a sophisticated, premium aesthetic that builds immediate trust with high-value clients.

The system explicitly rejects generic SaaS dashboards conventions: no cookie-cutter sidebar + cards + charts templates, no CRUD-admin-panel layouts. Structure comes from surface depth, not lines.

**Key Characteristics:**
- Tonal layering over lines: surface hierarchy through color depth, never 1px borders
- Glanceability: big numbers, clear status indicators, generous spacing
- Tablet-native touch: 44px minimum targets, no hover-dependent interactions
- Editorial data: "Small Label / Big Value" spec-sheet pairing
- Integrated visual language: statuses, alerts, errors share one tonal system

## 2. Colors

A Material Design 3 palette anchored on Reliable Blue, with all neutrals tinted toward the blue hue so they belong to the same palette, not a generic gray scale.

### Primary
- **Reliable Blue** (#0040a1): The system's signature color. Primary actions, active navigation, focus rings, and the anchor hue for all neutral tinting.
- **Reliable Blue Light** (#0056d2): CTA gradient endpoint, surface tint, and primary-container role. Lighter and more vibrant for gradient endpoints and hover states.

### Secondary
- **Slate River** (#456080): Supporting actions and secondary emphasis. A desaturated blue-gray that sits quietly beside Reliable Blue without competing.

### Tertiary
- **Forge Amber** (#822800): Pending and waiting states. A deep, warm tone that signals attention without alarm.
- **Forge Amber Light** (#a93802): Tertiary-container tone for lighter surfaces.

### Error & Success
- **Calm Rose** (#ba1a1a): Error and on-hold states. Deliberately less aggressive than pure red.
- **Calm Rose Surface** (#ffdad6): Error container background. Integrated and calm, not jarring.
- **Steady Green** (#16a34a): Success states and completion indicators.

### Neutral
- **Canvas** (#f7f9ff): The root background. A barely-perceptible blue tint separates it from pure white.
- **Workspace** (#f1f4fa): Primary section background, the first tonal lift above Canvas.
- **Card Surface** (#ffffff): Actionable card background, the white "floater" on Workspace sections.
- **Overlay** (#e5e8ee): Information overlays and elevated surfaces.
- **Highest Surface** (#dfe3e8): Sidebar background, input resting state, and the deepest tonal layer.
- **Ink** (#181c20): Primary text on surfaces.
- **Muted Ink** (#424654): Secondary text and labels. Reduced contrast for hierarchy, not for decoration.
- **Ghost Border** (#c3c6d6): The rare structural edge, used only at 15% opacity when accessibility demands it.
- **Outline** (#737785): Minimum-contrast text and icons.

**The No-Line Rule.** 1px solid borders are prohibited for sectioning. Structural boundaries must be created through background color shifts. A card sits on a workspace canvas; a sidebar uses Highest Surface to create a natural, unlined vertical break.

**The Tinted Neutral Rule.** All neutrals are tinted toward the blue hue (chroma 0.005 to 0.01). Neutrals should feel like they belong to the same palette as Reliable Blue, not like they were pulled from a generic gray scale.

## 3. Typography

**Display Font:** Manrope (sans-serif fallback)
**Body Font:** Karla (sans-serif fallback)
**Label Font:** Karla (shared with body)
**Mono Font:** JetBrains Mono, Fira Code, ui-monospace

Manrope's geometric nature feels engineered and modern. Karla's rounded terminals and high x-height keep part numbers and labor hours legible even on grease-smudged tablets. The warmth of Karla complements the precision of Manrope without competing.

### Hierarchy
- **Display** (extrabold, clamp(2rem 5vw 3rem), line-height 1.1): Hero counters, "Days in Shop" metrics. Data gets hero presence. Negative tracking for tightness.
- **Headline** (bold, 1.25rem, line-height 1.75): Section headings, customer names, device models. Negative tracking. Manrope.
- **Title** (semibold, 1rem, line-height 1.5): The "Big Value" in spec-sheet pairings. Karla.
- **Body** (regular, 0.875rem, line-height 1.5): Descriptions, notes, general content. Max line length 65 to 75ch. Karla.
- **Label** (medium, 0.75rem, line-height 1, tracking 0.025em): The "Small Label" in spec-sheet pairings. Uppercase for metadata labels. Karla.

**The Spec-Sheet Rule.** Always pair a label (Small) above or beside a title (Big Value). "LABEL-sm in Muted Ink" paired with "Title-md in Ink" mimics technical spec sheets and enables glanceability.

## 4. Elevation

Depth is achieved through **Tonal Stacking**, not shadows. Place a Card Surface element on a Workspace section and the background contrast creates a "soft lift." Shadows are reserved for specific interactive states, not for default structure.

### Shadow Vocabulary
- **Ambient Float** (box-shadow: 0 8px 40px rgba(0,64,161,0.06)): Drag-and-drop repair tickets or temporarily elevated elements. Tinted with primary, never pure gray or black.
- **Subtle Lift** (box-shadow: 0 1px 2px rgba(0,0,0,0.05)): Active navigation items and top bar. Barely perceptible, structural only.
- **Focus Ring** (outline: 2px solid #0040a1, offset 2px): Global focus-visible treatment. Consistent across all interactive elements.

**The Ghost Border Fallback.** If high-contrast accessibility requires a structural edge, use Ghost Border (#c3c6d6) at 15% opacity. It should be felt, not seen. Never use 100% opaque outline colors for borders.

## 5. Components

### Buttons
Tactile and confident. All variants share rounded-xl (1rem) corners, Manrope bold font, and a 0.98 scale on active press.

- **Shape:** Rounded corners (1rem), Manrope bold
- **Primary:** Reliable Blue (#0040a1) fill, white text, shadow-md. Hover transitions to Reliable Blue Light (#0056d2).
- **Primary Gradient:** 135deg gradient (Reliable Blue to Reliable Blue Light), white text, shadow-md. Hover reduces opacity to 0.9. Used for signature CTAs like Intake and Delivery.
- **Secondary:** Highest Surface (#dfe3e8) fill, #2d4867 text, no shadow. Hover transitions to Workspace (#f1f4fa).
- **Ghost:** Transparent fill, Muted Ink (#424654) text. Hover gets Workspace (#f1f4fa) background.
- **Destructive:** Calm Rose (#ba1a1a) fill, white text. Hover reduces opacity to 0.9.

Sizes: sm (12px/8px padding, 12px font), md (20px/10px padding, 14px font), lg (32px/12px padding, 16px font).

### Chips
Compact status indicators. Full rounded (9999px) to contrast against the xl-rounded cards.

- **Style:** Compact uppercase label text (0.75rem, extrabold) inside role-appropriate container backgrounds.
- **Intake:** Secondary Container (#bed9ff) with #445f7f text.
- **Waiting:** Tertiary Fixed (#ffdbcf) with #812800 text.
- **In Repair:** Primary at 10% opacity with Reliable Blue text.
- **On Hold:** Overlay (#e5e8ee) with Muted Ink text.
- **Done:** Primary Fixed (#dae2ff) with Reliable Blue text.
- **Delivered:** Surface Container (#ebeef4) with Muted Ink text.
- **Returned:** Calm Rose Surface (#ffdad6) with #93000a text.
- **Cancelled:** Overlay with Muted Ink, line-through decoration.

### Cards / Containers
No border, no divider lines. Background contrast creates structure.

- **Corner Style:** Rounded (1rem)
- **Background:** Workspace (#f1f4fa) at rest, Overlay (#e5e8ee) on hover for clickable cards
- **Shadow Strategy:** None at rest. Tonal stacking only.
- **Border:** None
- **Internal Padding:** 20px (1.25rem)
- **Separation:** 16px vertical spacing between list items, no divider lines

### Inputs / Fields
Stateful surfaces that signal interaction readiness.

- **Style:** No border, Highest Surface (#dfe3e8) background at rest, rounded-xl (1rem)
- **Focus:** Background transitions to Card Surface (#ffffff), 2px primary box-shadow ring appears
- **Error:** No dedicated error variant at component level. Errors surfaced through validation and icon color change.
- **Icons:** Positioned at inline-start or inline-end, color transitions from Outline (#737785) to Primary on parent focus.

### Navigation
Sidebar at 256px fixed left (or right in RTL), visible at lg (1024px). Mobile uses top bar + bottom nav.

- **Sidebar:** Workspace (#f1f4fa) background, 16px padding
- **Nav Items:** 12px padding, rounded-lg (0.75rem), Muted Ink text at rest
- **Nav Hover:** Surface Container (#ebeef4) background, Primary text
- **Nav Active:** Card Surface (#ffffff) background, Primary text, semibold weight, subtle shadow, 4px inline offset
- **Mobile Top Bar:** 64px height, Canvas at 95% opacity with 4px backdrop blur, Ghost Border bottom edge
- **CTA in Sidebar:** Full-width Reliable Blue fill, white text, rounded-xl

### Metric Card (Signature Component)
The "Small Label / Big Value" spec-sheet pattern. The data is the hero.

- **Label:** 0.75rem medium uppercase, Muted Ink, wide tracking
- **Value:** 2.25rem (36px) extrabold, Manrope, Ink. The dominating element.
- **Unit:** 0.875rem medium, Muted Ink, baseline-aligned beside value
- **Detail:** 0.75rem regular, Muted Ink, 4px top margin
- **Background:** Workspace at rest, Overlay on hover (if clickable)
- **Padding:** 20px all sides

## 6. Do's and Don'ts

### Do
- **Do** use display-scale Manrope for "Days in Shop" counters. Make the data the hero.
- **Do** use asymmetrical layouts. Wide column for repair details, narrow surface-container-high column for parts list.
- **Do** leave breathing room. High-speed environments require more white space, not less.
- **Do** use the Small Label / Big Value pairing for every data point that matters.
- **Do** use Integrated Visual Language: error containers, not alert reds; surface depth, not box shadows.

### Don't
- **Don't** use 100% opaque outline colors for borders. It breaks the Engineering Atelier sophistication.
- **Don't** use standard "Alert Red" for everything. Use error-container (#ffdad6) with on-error-container text.
- **Don't** use icons without labels in the main navigation. Speed requires clarity.
- **Don't** use generic SaaS dashboard templates with cookie-cutter sidebar + cards + charts.
- **Don't** use CRUD admin panel layouts. Structure comes from surface depth, not lines.
- **Don't** use divider lines between list items. 16px vertical spacing and background shifts.
- **Don't** use 1px solid borders for sectioning. Background color shifts create structure.