# Design handoff: the adidas Running look for DPL Auction

**Reference:** the adidas Running app website. runtastic.com now redirects to `adidas.com/us/running-app`. The same page is at `adidas.co.in/running-app`.
**Audited:** 4 Oct 2026, in a live browser at 1280×720 and 375×812.
**Target:** `dpl-auction-system`, re-skinned to this look. **Do not change any behaviour.**

This folder contains:

| File | What it is |
|---|---|
| `HANDOFF.md` | This spec: foundations, components, a screen-by-screen mapping onto your app, and an implementation plan |
| `tokens.css` | Drop-in CSS variables: the adidas palette and scales, light/dark semantic tokens, and a **bridge** that re-points your existing variables |
| `preview.html` | Open in a browser. Your own components (lot card, bid buttons, money bar, projector board, SOLD tile) rendered in the new look, with a light/dark toggle |
| `reference/` | 14 screenshots from the audit. **Local only**: a `.gitignore` keeps them out of git because this repo is public and the images are adidas' copyright |

How values are labelled in this document:
- **adidas** means measured on the live site. Most values come from adidas' own "Stripes v7" design tokens, which the site exposes as about 9,500 CSS custom properties.
- **DPL decision** means my recommendation where the site gives no direct answer, such as how a broadcast projector should use the language.

---

## 0. The look in ten rules

If you only read one section, read this one.

1. **Black and white first.** Pages are pure white (`#fff`) or pure black (`#000`). Colour is rare, which makes it loud when it appears.
2. **Square everything.** Border radius is `0` on every web component: buttons, inputs, cards, tags, modals and images. The only round things are radio dots and progress rings.
3. **No shadows, no gradients, no glass.** Depth comes from colour blocks (white against grey `#eceff1` against black) and 1px dividers.
4. **The signature CTA.** A black rectangle with a bold label, a long thin arrow, and a 1px outline offset 4px down and right behind it. That outline is adidas' only "shadow".
5. **Headlines shout.** Condensed bold, UPPERCASE, wide tracking (2–3.5px). Body text is calm: sentence case, 14–16px, regular weight.
6. **Big numbers, tiny labels.** In the Running app a stat is a large bold number over a 10–12px uppercase grey label. This fits purses, bids, timers and player stats perfectly.
7. **Underlined links that invert.** Links are underlined. On hover they flip to a black background with white text.
8. **Selected means inverse.** Active tabs get a 2px black underline. Active chips and size cells go black with white text. Nothing glows.
9. **Grey tiles for choices.** Sizes, tags and image backgrounds sit on `#eceff1` tiles with 4px gaps.
10. **Motion is short and decisive.** 300ms on `cubic-bezier(0.3, 0, 0, 1)`, with no bounce. Panels slide in, colours cross-fade, and nothing wobbles.

---

## 1. What was audited

| Page | URL | Why it matters | Screenshot |
|---|---|---|---|
| Running app landing | `/us/running-app` | The reference itself: hero, black split sections, app mockups, adiClub band, footer | `01`–`04`, `10`, `11`, `12` |
| Running hub | `/us/running` | Text-box hero, section titles, teaser cards, tabbed carousels | `05` |
| Product listing | `/us/men-running-shoes` | Breadcrumbs, page title, in-page tabs, filter button, product-card grid and hover | `06`, `07` |
| Product page | `/us/adizero-adios-pro-5-shoes/KJ7040.html` | Buy box, size grid, tags, rating, accordions, spec highlights, big CTA | `08`, `09` |
| Help (IN) | `adidas.co.in/help/contact-us` | Bordered info cards and back link | `13` |
| Privacy dialog (IN) | first visit to `adidas.co.in` | Modal anatomy. It was only inspected; tracking was not accepted | `14` |
| Mobile | `/us/running-app` at 375px | Responsive header, hero and stacking | `11`, `12` |

**Method.** Computed styles were read from the live DOM and the component library's CSS. That library is `@adl/collection@7` (class prefix `stripes_v7_gl-*`). Every `var(--…)` was resolved to its final value. The two Running-app colours were sampled pixel by pixel from the app screenshots on the page. Hover states come from the library's own `:hover` rules, not guesses.

### Running app UI patterns (from the phone mockups on the page)
These are the most useful patterns for an auction app. See `reference/12-mobile-app-mockups.jpg` and `04`.
- **Hero numeral:** `01:25:12` set in heavy condensed type, about 3× body size.
- **Stat triplet:** `0.00 / 0 / 00:00` in bold, each over a tiny uppercase grey label (`DISTANCE (KM)`, `CALORIES (CAL)`, `AVG. PACE`).
- **Progress ring:** a thick green ring (`#51ac6f`) around a centred value (`THIS WEEK · 5.1 · OF 20 KM`).
- **Icon + value + label rows:** a thin-line icon, a bold value (`3 WEEKS`) and a tiny caps label (`CURRENT STREAK`), in a two-column grid.
- **Segmented chips:** `WEEK | MONTH | YEAR | ALL TIME` as boxed 1px chips; the selected one is filled.
- **Brand tile:** a mint `#8dfe8e` rounded square with black italic heavy-condensed "RUNNING". This is the app's signature colour.
- **Bars:** a black full-width "SLIDE TO PAUSE" bar, and a black "GET STARTED →" button.

---

## 2. Ground rules for the re-skin (the "don't break it" list)

The re-skin is CSS-first. Everything below is a functional hook. **Keep the hooks; change only how they look.**

**2.1 Keep every class and data attribute that JS toggles.** The full list is in §9.2. The ones you'll trip over first:
- `tab.active`, `tier-chip.active`, `lot-card.you-lead`, `bid-row.leading`, `hold-bid.holding` / `.leading`, `hammer-timer.urgent`, `timeout-timer.done`, `star.on`, `status-*`, `stage-*`, `log-*`, `conn-dot.on` / `.off`, `toast.*`, `notice.*`
- Projector: `scr-cell.leading` / `.full` / `.out`, `scr-ring.urgent`, `scr-plate.dark-ink` / `.open`, `scr-flash.sold` / `.unsold` / `.dark-ink`, `scr-feed.empty`, `scr-delta.up`, `scr-ticker-track.marquee` / `.static`, `scr-boards.two`
- Attributes: `html[data-theme]`, `.scr-page[data-view]`, `.scr-stagechip[data-stage]`

**2.2 Size and timing couplings. These are functional, so don't change them.**

| Coupling | Where | Rule |
|---|---|---|
| Bid feed row height | `screen.css:518-528`; `ScreenPage.tsx:410-432` measures rows | `.scr-bid-row` stays `height: 46px`, and `scrRowIn` keeps `margin-top: -46px` |
| SOLD/UNSOLD overlay | JS unmounts at 4000ms (`ScreenPage.tsx:137`) | The exit animation must finish by 4000ms (currently starts at 3450ms and runs 500ms) |
| Hold to bid | `TeamPage.tsx:294-295, 354`; `styles.css:328-341` | Keep `transform: scaleX()` driven by `--hold-ms`, `overflow: hidden`, `touch-action` and `user-select` |
| Sticky money bar | `styles.css:315` `top: 57px` | Must equal the new `.topbar` height. If you change the topbar padding or font, update this number |
| Keyed animations | `screen.css:1-11` discipline | Elements keyed by player, bid or team must keep *an* entry animation that ends at their natural state (names and easing can change) |
| Reduced motion | `screen.css:1252` | Keep the `prefers-reduced-motion` block |

**2.3 Colours that come from data are inline styles.** These are tier colours (`TierBadge`, `ui.tsx:179`), team colours (`.bid-btn`, `AuctionConsole.tsx:361`; dots; `.result-team`), and JS-set variables (`--team`, `--tier`, `--lead`, `--fc`, `--team-color`). Restyle them as **identity stripes** (§3.1). Where the inline `color` would put pale tier or team colours on white text, override with `color: var(--text) !important`. That is CSS-only and needs no JSX change.

**2.4 Things CSS can't touch.** The 7 native `window.confirm` dialogs (listed in §9.3), confetti colours chosen in JS (`ScreenPage.tsx:871`) and QR code colours (`TeamsTab.tsx:32`). Leave them, or change them in Phase 4.

---

## 3. Foundations

### 3.1 Colour

**Palette** (adidas Stripes v7; all values are in `tokens.css` §A1):

| Token | Hex | adidas role |
|---|---|---|
| `--ad-black` | `#000000` | Primary text and fills; inverse page |
| `--ad-white` | `#ffffff` | Page; inverse text |
| `--ad-grey-50` | `#f5f5f5` | Hover fill on light |
| `--ad-grey-100` | `#eceff1` | Secondary fill: tags, size cells, alternate sections, image tiles |
| `--ad-grey-200` | `#d9dbdd` | Dividers, disabled fill and text |
| `--ad-grey-300` | `#929396` | Inactive input and chip borders; hovered outlines |
| `--ad-grey-500` | `#767677` | Secondary text |
| `--ad-grey-800` | `#3b3b3c` | Dividers on dark; disabled on dark |
| `--ad-grey-900` | `#1e1e1e` | Hover fill on dark |
| `--ad-red` | `#e32b2b` | Error, sale, urgent |
| `--ad-green` | `#00aa55` | Success |
| `--ad-orange` | `#d98916` | Warning text |
| `--ad-blue` | `#007bc6` | Brand blue, info |
| `--ad-club-green` / hover | `#408267` / `#336853` | Membership (adiClub) |
| `--ad-run-mint` | `#8dfe8e` | Running app signature tile (sampled) |
| `--ad-run-green` | `#51ac6f` | Running app progress ring (sampled) |

Surfaces: error `#fff0f0`, success `#defbe6`, adiClub off-white `#f5f4e7`. Backdrop `rgba(0,0,0,.75)`.

**Semantic tokens** (`tokens.css` §B). Light theme = adidas "onlight"; dark theme = adidas "ondark" (inverse):

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--ad-page` / `--ad-surface` | `#fff` | `#000` | Cards are the page colour plus a 1px divider |
| `--ad-surface-alt` | `#eceff1` | `#1e1e1e` | Tiles, stat cells, tags |
| `--ad-hover` | `#f5f5f5` | `#1e1e1e` | |
| `--ad-text` / `--ad-text-2` | `#000` / `#767677` | `#fff` / `#929396` | Dark secondary is a DPL decision (adidas uses `#d9dbdd`) |
| `--ad-divider` | `#d9dbdd` | `#3b3b3c` | |
| `--ad-border-input` | `#929396` | `#d9dbdd` | |
| `--ad-action` / `--ad-on-action` | `#000` / `#fff` | `#fff` / `#000` | Primary buttons |
| `--ad-inverse` / `--ad-on-inverse` | `#000` / `#fff` | `#fff` / `#000` | Selected and active states |
| `--ad-success-text` | `#408267` | `#00aa55` | `#00aa55` fails contrast on white (3:1) |
| `--ad-warning-text` | `#000` + orange icon | `#d98916` | Orange fails contrast on white (2.7:1) |
| `--ad-ring` | `#51ac6f` | `#8dfe8e` | Countdown ring arc |

**Colour roles for DPL** (DPL decision, built from adidas' own rules):

| Role | Looks like | Use for |
|---|---|---|
| **Action** | Black fill, white text (light theme); inverted on dark | Primary buttons: Start, Draw next, Save, Join as captain |
| **Selected / leading** | Inverse block (`--ad-inverse`) or a 2px underline | Active tab, active filter chip, active tier chip, leading purse cell, leading bid row |
| **Win (mint)** | `#8dfe8e` fill, **black** text, never mint text | SOLD button, SOLD stamp tile, the phone's "You're leading" bid button, the ring arc on dark |
| **Urgent** | `#e32b2b` | Hammer timer ≤ 3s, ring urgent, HOT tag, OUT, errors, offline bar, destructive actions |
| **Live** | `#00aa55` dot or text (`#408267` text on white) | LIVE indicator, connection status, "sold" status text |
| **Identity** | Team or tier colour | 4–6px stripes, 10px squares, the leading plate, team column headers. **Never** body text on white |

Mint on white has 1.2:1 contrast, so it is always a *fill* with black text, never a text colour. Black on mint is 17:1.

### 3.2 Typography

adidas' typefaces (AdihausDIN, adidasFG, AdineuePRO, Denton) are proprietary, so **don't self-host them**. These free Google Fonts get very close:

| adidas face | Where adidas uses it (measured) | Stand-in | DPL use |
|---|---|---|---|
| **adidasFG Compressed Bold** | Running-app hero 80/80, tracking 2px (30/30 on mobile); split-section headlines 38/40, tracking 3px | **Anton** 400 (already loaded) | Landing hero, projector player name, bid amount, SOLD stamp, big numbers that don't tick |
| **adidasFG Bold** | Page title 46/48 (3.5px); section title 38/40 (3px); product/card title 24/28 (2.5px); modal title 30/32 → 38/40 (3px) | **Barlow Condensed** 700 | Page and card titles, console/phone player names, modal titles, table-free headings |
| **AdihausDIN** (400/700) | All UI and body text, 12–18px; buttons 16/24 bold | **Barlow** 400/500/700 | Everything else, replacing the Segoe UI stack |
| **Denton Light** | Body copy on the black editorial sections, 16/24 | **Newsreader** 300 (optional) | Landing subtitle, rules intro. Skip it if you want just two families |

**Type scale** (`tokens.css` §A3; desktop size, with mobile under 960px in brackets):

| Token | Spec | Case / tracking | Example |
|---|---|---|---|
| `--ad-display-xl` | Anton 80/80 (30/30) | UPPER, 2px | Hero headline |
| `--ad-headline-l` | Barlow Condensed 700 46/48 (38/40) | UPPER, 3.5px (3px) | Page title, `MEN'S RUNNING SHOES` |
| `--ad-headline-m` | Barlow Condensed 700 38/40 (30/32) | UPPER, 3px | Section title, `SHOP BY SURFACE` |
| `--ad-headline-s` | Barlow Condensed 700 24/28 (20/24) | UPPER, 2.5px (2px) | Card title, product name |
| `--ad-eyebrow` | Barlow 700 14/24 | UPPER, 1px | Table headers, small section labels |
| `--ad-body-l` | Barlow 400 18/24 (16/24) | sentence | Lead paragraph |
| `--ad-body-m` | Barlow 400 16/24 | sentence | Default body, inputs, buttons |
| `--ad-body-s` | Barlow 400 14/20 | sentence | Secondary text, table cells, card meta |
| `--ad-body-xs` | Barlow 400 12/20 | sentence | Fine print |
| `--ad-label-caps` | Barlow 400 12/16 | UPPER, 1px | Stat and money labels (`REMAINING`) |
| `--ad-button` | Barlow 700 16/24 | **sentence** case in v7 (`Add to bag`, `Filter & Sort`) | Buttons |
| `--ad-price` | Barlow 700 16/24 (14/20 in listings) | n/a | Amounts in lists |

**Rules**
- UPPERCASE and wide tracking only for **short** text: headings, tags, labels and nav. Never for paragraphs.
- Buttons are sentence case. Marketing-style CTAs whose copy is already uppercase (`SHOP NOW`, `SIGN UP FOR FREE`) stay uppercase.
- Keep `font-variant-numeric: tabular-nums` on every number. **But Anton has no tabular figures.** I measured it in the browser: at 40px, "1111" is 53px wide and "0000" is 79px, while Barlow and Barlow Condensed are equal width. So:
  - Anton for names, headlines, the SOLD stamp, and amounts that change only once per event (bid amount, purses).
  - **Barlow Condensed 800** for anything that ticks every second (hammer timer, ring number, timeout clock). Otherwise the digits jitter sideways.
- Body line-height is 1.5 (16/24); headlines 1.05–1.2.
- Long headlines: add `text-wrap: balance`, as adidas does on CTA labels.

### 3.3 Spacing and sizing

adidas spacing scale: **2 · 4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64 · 80** (`--ad-space-3xs` … `--ad-space-4xl`).

| Use | Value |
|---|---|
| Icon to text | 8px (`--ad-space-xs`) |
| Button side padding | 16px (8px for small) |
| Tag padding | 4px 8px |
| Chip padding | 4px 8px, height 32px |
| Card padding | 24px (`--ad-space-m`); 32px for the product buy box |
| Title to content | 24px |
| Section gap | 48–64px |
| Tile grid gap | 4px (size grid); 6px (product grid) |

Sizes: button S/M/L = **32/40/48px**, XL 56px, product-page buy button **60px**; touch target minimum **44px**; icons **24px** (20px small); tag minimum height 28px; overlay widths 351 / 480 / 600 / 760 / 960px.

### 3.4 Layout grid and breakpoints

adidas grid@7: **6 columns** on mobile, **12** on desktop. Gutter 4px on mobile and 8px from 768px.

| Breakpoint (adidas) | Page side margin |
|---|---|
| < 390px | 14px |
| ≥ 390px | 30px |
| ≥ 768px | 60px |
| ≥ 1440px | 108px |
| ≥ 1920px | centred, max 1600px |

Other adidas breakpoints in use: **960px** (desktop type scale and breadcrumbs appear), **1024px** and **480px** (side panels).

**DPL decision:** keep your existing layout breakpoints (520 / 900px in `styles.css`; 560 / 760 / 980px and the max-height rules in `screen.css`). They encode real layout fits for phones and the projector. Adopt adidas' *side margins* inside them: 16px on phones, 32px on tablets, 60px on desktop.

### 3.5 Shape, borders and elevation
- **Radius:** `0` everywhere (`--ad-radius`). This replaces your 6/8/10/12/14/18/999px radii. Keep `50%` only for dots, radio buttons and the ring.
- **Borders:** 1px for inputs, chips, cards and dividers; 2px for the active tab underline, input focus bottom edge, error bottom edge and the card hover outline.
- **Elevation:** none. Delete box-shadows, text-shadows, `drop-shadow` filters, glows and blurs. Separate things with tiles and dividers instead.
- **The offset outline** is a 1px line in the button's own ink colour, 4px down and right, behind the button. It turns grey `#929396` on hover. See §4.1.
- **Card hover** (product grid) is a 2px black outline with a 1px white inner line. See §4.6.

### 3.6 Motion

| Token | Value | adidas usage |
|---|---|---|
| `--ad-ease` | `cubic-bezier(0.3, 0, 0, 1)` | Everything: colour, background, border, transform, opacity |
| `--ad-dur` | 300ms | Default |
| `--ad-dur-fast` | 200ms | Chips (`ease-in-out`) |
| `--ad-dur-slow` | 700ms | Large reveals |
| Modal | 300ms `ease-out`, fade or slide | Backdrop fades in over 300ms |
| Header | `transform .25s .1s` | Header slides away on scroll down and returns on scroll up |
| Loader | `.7s linear infinite` spin | Tripled under reduced motion |

**DPL decision for the projector:** keep its keyframes, which give the broadcast energy, but switch the three easing variables to `--ad-ease` (done in `tokens.css` §D). Remove *looping* decoration: beams, grid pan, header sheen, watermark breathing, hot-badge glow pulse and cell glow. Keep *event* motion: slam, wipe, row-in, purse flip and SOLD.

### 3.7 Icons and imagery
- **Icons:** adidas uses thin-line icons on a 32×32 grid (about 1px strokes, square ends): arrow, bag, heart, chevron, search, account. Your app uses emoji (🔨 🎲 ⏸ ⏱ ↩ 🏁 ⭐ 🔥 …).
  - CSS-only pass: keep the emoji. They read as content.
  - Phase 4 (optional): swap them for a thin-line set, such as Lucide with `stroke-width: 1.25` or Phosphor "light".
- **The CTA arrow** is a long, thin horizontal arrow at the end of primary CTAs. Draw your own as a line plus a chevron. Don't copy adidas' artwork. `preview.html` includes one.
- **Photos:** square, no radius, on a `#eceff1` tile (dark: `#1e1e1e`), like product images. Missing photos show the initials placeholder in Anton, grey on the tile.

---

## 4. Components

Each component lists the adidas spec, then where it lands in the app. Values reference tokens; the raw adidas CSS is in §9.1.

### 4.1 Buttons

**Anatomy (adidas `gl-cta`):** inline-flex, `min-height` 48px (32px small), `padding-inline` 16px (8px small), gap 8px, `--ad-button` font, radius 0, optional trailing 24–32px arrow, `transition: transform .3s var(--ad-ease), color .3s`.

| DPL class | adidas variant | Light theme | Dark theme | Used for |
|---|---|---|---|---|
| `.btn.primary` | `gl-cta--primary` with drop shadow | Fill `#000`, text `#fff`, offset outline `#000` | Fill `#fff`, text `#000`, outline `#fff` | Start, Resume, Draw next, Save, Add, Join as captain |
| `.btn` (default) | `gl-cta--secondary` | Fill `#fff`, 1px `#000` border, text `#000` | Fill `#000`, 1px `#fff` border | Bid (custom), Back to start |
| `.btn.ghost` | Ghost (`gl-cta-icon--ghost`) | Transparent, 1px transparent border | Same, inverted | Theme, Sound, Exit, Edit, Undo bid, timer buttons, modal ✕ |
| `.btn.ok` | DPL **mint** variant | Fill `#8dfe8e`, text `#000`, 1px `#000` border (edge definition on white), offset outline `#000` | Fill `#8dfe8e`, text `#000`, outline `#8dfe8e` | **SOLD** (`AuctionConsole.tsx:400`), 🏁 Complete (`:273`) |
| `.btn.warn` | DPL caution (secondary in red) | Transparent, 1px `#e32b2b`, text `#e32b2b` | Same | UNSOLD, Undo, Reopen, Delete, restore/reset |
| `.btn.big` | XL | `min-height: 56px`, full width, 16px bold | | Primary page actions |
| `.bid-big` | Buy button | `min-height: 60px` (`--ad-size-buy`), label 18px bold | | The phone's hold-to-bid button |

**States**

| State | Spec (adidas) |
|---|---|
| Hover | Primary: fill `#1e1e1e` (light) / `#f5f5f5` (dark), and the offset outline turns `#929396`. Secondary and ghost: fill `#f5f5f5` (dark: `#1e1e1e`), border `#929396`. Caution (DPL): fill `--ad-error-surface` |
| Focus-visible | `outline: 1px dashed var(--ad-focus); outline-offset: 4px`. On primary, adidas draws it via `::before` offset `2px` with `outline-offset: 6px` so it clears the offset outline |
| Active | DPL: keep your `translateY(1px)` |
| Disabled | Primary: fill `#d9dbdd`, text `rgba(0,0,0,.3)` (dark: `#3b3b3c` / `rgba(255,255,255,.3)`), `cursor: not-allowed`, no offset outline. Secondary, ghost and caution: transparent, text and border `--ad-text-disabled`. Declare `.btn.warn:disabled` **after** `.btn.warn`, or the red wins and a disabled UNSOLD looks live. Replaces your `opacity: .45` |
| Loading | adidas puts a 32px spinner 8px after the label. Your buttons don't have this state, so skip it |

**The offset outline (signature CTA):**
```css
.btn.primary, .btn.ok { position: relative; transform-style: preserve-3d; }
.btn.primary::after, .btn.ok::after {
  content: ""; position: absolute; inset: 0;
  left: var(--ad-offset); top: var(--ad-offset);           /* 4px down-right */
  border: 1px solid var(--outerbox, var(--ad-action));
  transform: translateZ(-1px); pointer-events: none;      /* sits behind the button */
  transition: border-color var(--ad-dur) var(--ad-ease);
}
.btn.primary:hover::after { --outerbox: var(--ad-grey-300); }
.btn:disabled::after { display: none; }
```
- Leave `var(--ad-offset)` of free space right and below the button (margin) so the outline isn't clipped.
- **Turn it off on `.hold-bid`:** add `.hold-bid::after { display: none; }`. The hold button is also `.btn.primary` (`TeamPage.tsx:347`), and its `overflow: hidden` (needed for the fill sweep) would otherwise clip the outline into a stray line inside the button.
- The `transform: translateZ(-1px)` trick needs the parent to have no `overflow: hidden` and the button to keep `transform-style: preserve-3d`, which is the adidas implementation. If an ancestor breaks 3D, use `z-index: -1` on `::after` with `isolation: isolate` on the button instead.

### 4.2 Links
adidas `gl-link`: `text-decoration: underline; text-underline-position: from-font;` at 16/24 (14/20 small), regular or bold.
- **Hover inverts:** `background: var(--ad-inverse); color: var(--ad-on-inverse)`.
- Menu links (nav, footer) have no underline at rest and underline on hover.
- **Apply to:** `<a>` in body text, "Back", "Show more", the Landing links that aren't buttons, and `Copy link`-style actions if you prefer links over ghost buttons.

### 4.3 Tags and badges
adidas `gl-tag`: `min-height` 28px, padding 4px (inner 4px), 14/20 regular or bold, radius 0. Variants: **default** `#000`/`#fff`, **subtle** `#eceff1`/`#000`, **membership** `#408267`/`#fff`. On listings, status labels are plain 14px text (`New`, `Best Seller`, `Selling Fast`), sometimes with a `·` prefix.

| DPL element | New look |
|---|---|
| `.tier-badge` (inline `color` + `borderColor` from data) | **Subtle tag with a tier stripe.** `background: var(--ad-surface-alt); border: 0 solid; border-left-width: 4px; border-radius: 0; color: var(--ad-text) !important; padding: 2px 8px; font: 700 12px/20px var(--ad-font-body); letter-spacing: 1px; text-transform: uppercase;` The inline `borderColor` paints the stripe. **Delete** the light-theme `filter: brightness(.62)` at `styles.css:147-148`, which would dull the stripe |
| `.badge.hot` | **Red tag:** `#e32b2b` fill, `#fff` text, 12/20 bold, uppercase, 1px tracking, padding 2px 8px, radius 0 (adidas sale colour) |
| `.badge.sleeper` | **Default tag:** `--ad-inverse` fill, `--ad-on-inverse` text, same metrics |
| `.small-badge` | 10/16, padding 1px 6px |
| `.stage-chip` | Subtle tag, 12/20 bold uppercase, 1px tracking. `.stage-live` gets an 8px `--ad-live` square before the text (`::before`); `.stage-accelerated` text `--ad-warning-text`; `.stage-completed` text `--ad-text-2` |
| `.conn-dot.on` | 12/16 bold uppercase, 2px tracking, `--ad-live` text, an 8px square dot via `::before`, transparent fill |
| `.conn-dot.off` | Red tag (`#e32b2b` / `#fff`). Keep the pulse; it's functional attention |
| `.log-type` | Subtle tag; `.log-sale` text `--ad-success-text`, `.log-bid` text `--ad-text`, `.log-undo` text `--ad-error-text` |
| `.status-available` / `-sold` / `-unsold` | Plain 12/16 bold uppercase text: `--ad-text-2` / `--ad-success-text` / `--ad-error-text` |
| `.stat-rank` (`#3`) | Tiny inverse tag: `--ad-inverse` / `--ad-on-inverse`, 10/14 bold, padding 0 4px |
| Projector `.scr-tierchip`, `.scr-rolechip`, `.scr-basechip`, `.scr-badge` | Same system at projector scale. Tier = subtle tag with stripe (`border-left: 4px solid var(--tier)`, text `--hi`); role = subtle; base = transparent with 1px `--hi` border; HOT = red; SLEEPER = inverse |

### 4.4 Chips (filter pills)
adidas `gl-chip-selection`: height 32px, padding 4px 8px, 1px border, 16/24 regular, radius 0, `transition: .2s ease-in-out`, group gap 8px.

| State | Light | Dark |
|---|---|---|
| Inactive | Fill `#fff`, border `#929396`, text `#000` | Fill `#000`, border `#d9dbdd`, text `#fff` |
| Inactive hover | Fill `#f5f5f5`, border `#000` | Fill `#1e1e1e`, border `#fff` |
| Active | Fill `#000`, border `#d9dbdd`, text `#fff` | Fill `#fff`, text `#000` |
| Active hover | Fill `#1e1e1e`, border `#929396` | Fill `#f5f5f5` |
| Disabled | Text and border `#d9dbdd` | Text and border `#3b3b3c` |

**Apply to:** the Pool filters, which reuse `.tab` inside a card (`TeamPage.tsx:475`). Scope them as `.card .tab` so the topbar tabs (`nav.tabs .tab`) keep the underline style in §4.5.

### 4.5 Header and tabs
**adidas header (measured):**
- 40px black promo bar: 14/20 bold uppercase white.
- 32px utility row: 12/20 links.
- 48px nav row: 16/24 **uppercase** links with `padding: 0 16px`; highlighted links are 700, the rest 400.
- 190×32 search input on `#e9ecef` (14px text); 48px icon buttons.
- White background, no border or shadow. Total 121px on desktop, 101px on mobile, z-index 8000.

**adidas tabs (`gl-tabs`):** 56px items, `padding: 0 8px`, 16/24 regular. Active = **700 + 2px solid bottom border** in the text colour. Hover fill `#f5f5f5`. The tab list has a 1px bottom border.

| DPL element | New look |
|---|---|
| `.topbar` | Solid `--ad-page` background (no `backdrop-filter`), 1px `--ad-divider` bottom border, height ~64px, side padding 16px (32px from 768px). **Update `.money-bar { top }` to match** (§2.2) |
| `.brand` | Barlow Condensed 700, 20–24px, uppercase, 2px tracking |
| `nav.tabs .tab` | 16/24 uppercase Barlow, `padding: 0 16px`, height 48px, transparent, text `--ad-text`. **`.active`** = 700 plus `box-shadow: inset 0 -2px 0 var(--ad-text)`, which avoids a layout shift. Hover fill `--ad-hover` |
| `.topbar-right` utilities | `.theme-toggle` and `.sound-toggle` become ghost icon buttons: 40×40, radius 0, 1px transparent border, hover grey. `.sound-toggle:not(.muted)` keeps a 1px `--ad-live` border as its "on" cue |
| `.stage-banner` (Landing) | adidas promo bar: full-width black (dark: white) strip, 40px, 14/20 bold uppercase, centred |

### 4.6 Cards and panels
adidas cards are flat. Info cards (help page) are a white box with a 1px light-grey border and 24px padding. Product cards have no border; the image tile gives the shape.

| DPL element | New look |
|---|---|
| `.card` | `background: var(--ad-surface); border: 1px solid var(--ad-divider); border-radius: 0; padding: var(--ad-space-m)`. Remove the gradient. Margin-bottom 16px |
| Card titles (`.card > h2`, `h3`) | `--ad-headline-s` uppercase, 2.5px tracking, margin 0 0 16px |
| `.card.danger` | Border `#e32b2b`; title colour `--ad-error-text` |
| `.timeout-card` | Border `--ad-border-strong` 2px; title has an 8px orange square before it (`::before`) |
| `.lot-card.you-lead` | `outline: 2px solid var(--ad-green); outline-offset: -2px` (adidas `color-border-success`) |
| `.center-note` | Centred, 48px vertical padding, title `--ad-headline-s`, body `--ad-body-m` `--ad-text-2` |
| `.result-team` | Card with a **6px top stripe** in team colour (keep the inline `borderTopColor`), radius 0, title `--ad-headline-s` |
| `.team-card` | Card with a 6px top stripe (inline). `.join-box`: `--ad-surface-alt` tile, no dashed border, radius 0 |
| `.add-team` | Dashed 1px `--ad-border-input` box, `--ad-eyebrow` label, hover border `--ad-text` |
| `.rules-card` (`<details>`) | adidas **accordion**: summary row 48px (80px large), `padding-inline: 16px`, 16/24 **bold**, chevron at the right (via `summary::after`), 1px `--ad-divider` bottom border, hover fill `--ad-hover`. `.rules-you`: `--ad-surface-alt` tile with a 4px team-colour left stripe (keep `--team-color`) |

**Card hover (product grid)**, for clickable rows and tiles:
```css
.clickable-card { position: relative; }
.clickable-card:hover::before { content:""; position:absolute; inset:0; border:2px solid var(--ad-text); pointer-events:none; z-index:2; }
.clickable-card:hover::after  { content:""; position:absolute; inset:1px; border:2px solid var(--ad-page); pointer-events:none; z-index:3; }
```
Use it on `.team-card` and on pool-table rows if you want hover feedback.

### 4.7 Stat blocks (Running-app style)
These come from the app mockups and the product page's "spec highlights" row (icon + label + value). **This is where the app look pays off most.**

| DPL element | New look |
|---|---|
| `.stat-groups`, `.stat-group` | Keep the grid. `.stat-group-title`: `--ad-label-caps`, **700**, `--ad-text-2` |
| `.stat-cell` | `background: var(--ad-surface-alt); border: 0; border-radius: 0; padding: 8px 4px` (like a size cell) |
| `.stat-value` | Barlow Condensed 700, 20px (17px compact), tabular |
| `.stat-label` | `--ad-label-caps` (10–11px on cells), `--ad-text-2` |
| `.money-cell` | The app's **stat triplet**: value above label, cells split by 1px `--ad-divider` lines (keep the `gap: 1px` trick, with background `--ad-divider`). Cell fill `--ad-page` |
| `.money-value` | Anton, `clamp(20px, 3.6vw, 30px)`, 1px tracking (values change per sale, not per second, so Anton's proportional digits are fine) |
| `.money-label` | `--ad-label-caps`, `--ad-text-2` |
| `.money-cell.accent` | Keep the inset team-colour bar, at 4px |
| `.team-money` | Row of `value + label` pairs, 14px |

### 4.8 Tables and lists

| DPL element | New look |
|---|---|
| `.table th` | `--ad-eyebrow` at 12px (12/16 bold uppercase, 1px tracking), `--ad-text-2`, padding 12px 8px, bottom border **2px `--ad-text`** (adidas `gl-divider--primary` is a 2px rule) |
| `.table td` | `--ad-body-s` (14/20), padding 12px 8px, 1px `--ad-divider` bottom border |
| `.row-you td` | `background: var(--ad-shade)`, and weight 700 on the first cell |
| `.row-dim` | `opacity: .45` |
| `.actions .btn` | Small buttons: 32px, padding 0 8px, 14px |
| `.bid-history .bid-row` | 48px rows, 1px divider, team `.dot` becomes a **10px square** (`border-radius: 0`), `.bid-amt` bold tabular. **`.leading`** = inverse block (`--ad-inverse` / `--ad-on-inverse`), radius 0 |
| `.results-grid ul`, `.mini-roster`, `.rules-list` | 14/20; list rows separated by 1px dividers, as in an accordion; numbered rules get a bold numeral column |

### 4.9 Forms
adidas `gl-input`: white field, 1px `#929396` border, radius 0, 16/24 text, side padding 16px.
- Hover: border `#000`.
- **Focus: `border-bottom: 2px solid #000`**, no outline ring.
- Error: `border-bottom: 2px solid #e32b2b`, with hint text in red.
- Disabled: text and border `#d9dbdd`.
- Label: 14/20 **bold** above the field; sub-label 14/20 regular grey. (adidas uses floating labels; DPL keeps its labels above.)

| DPL element | New look |
|---|---|
| `.input` | Height 48px, `padding: 12px 16px`, `background: var(--ad-page)`, `border: 1px solid var(--ad-border-input)`, radius 0, `--ad-body-m`. Focus: `outline: none; border-bottom: 2px solid var(--ad-text)` (`padding-bottom: 11px` so the text doesn't jump) |
| `select.input` | Same, with `appearance: none` and an SVG chevron at the right, padding-right 48px |
| `textarea.input` | Same border rules, min-height 96px |
| `.input.color` | 48×48, radius 0 |
| `label` | `--ad-body-s` **700**, `--ad-text`, gap 8px. The hint stays `.muted.small` |
| `label.check` | adidas checkbox: `input { appearance: none; width: 24px; height: 24px; border: 1px solid var(--ad-border-input); border-radius: 0 }`; checked = `--ad-inverse` fill with a white check (SVG `background-image`); hover = border `--ad-text` plus `outline: 4px solid var(--ad-hover)`; label 16/24, **700 when checked** (adidas) |
| `.code-input` | Barlow Condensed 700, 28px, `letter-spacing: .35em`, uppercase, centred |
| `.form-grid` | Gap 16px |

### 4.10 Modal
adidas `gl-modal` and the privacy dialog (measured): white, radius 0, no border.
- Width 600px (`overlay-width-fixed-m`; the privacy dialog is 640px), `max-height: 80vh`, padding 20px.
- Backdrop `rgba(0,0,0,.75)`.
- Title: adidasFG 30/32 → 38/40 at ≥960px, uppercase, 3px tracking.
- Close button at top-right, 10px in.
- Entry: fade-in over 300ms, or slide in from the right for side panels (width 100vw → 80vw at ≥480 → 50vw at ≥768 → 35vw at ≥1024 → 25vw at ≥1920).

| DPL element | New look |
|---|---|
| `.modal-backdrop` | `background: var(--ad-backdrop)` |
| `.modal` | `background: var(--ad-surface); border: 0; border-radius: 0; padding: 24px; width: min(600px, 94vw)`. Entry animation: opacity 0 → 1 over 300ms `ease-out` |
| `.modal-head h2` | `--ad-headline-s` uppercase (the full adidas 30–38px is too big for form dialogs) |
| `.modal-head .btn.ghost` (✕) | 40×40 ghost icon button |
| Footer actions | Primary at the right, `.btn.warn` Delete at the left |

### 4.11 Messages: notices, warnings, toasts, offline
adidas `gl-message-inline`: padding 16px, gap 8px, 32px icon area, `width: fit-content`, radius 0, black text.
- **Low:** 1px `rgba(0,0,0,.1)` border.
- **Medium:** `#eceff1` fill.
- **Strong:** `#000` fill with white text.
- **Error:** `#fff0f0` fill with a red icon.
- **Success:** `#defbe6` fill with a green icon.

| DPL element | New look |
|---|---|
| `.notice.info` | Medium: `--ad-surface-alt`, text `--ad-text`, radius 0, 14/20, padding 16px |
| `.notice.ok` | `--ad-success-surface`, text `--ad-text`, 4px `--ad-green` left bar |
| `.notice.error` | `--ad-error-surface`, text `--ad-text`, 4px `--ad-red` left bar |
| `.warnings .warning` | Medium tile with a 4px `--ad-orange` left bar, text `--ad-text`, and `⚠` kept as content |
| `.toast` | **Strong** message: `--ad-inverse` fill, `--ad-on-inverse` text, 16/24 bold, padding 16px, radius 0, **no shadow** |
| `.toast.ok` | Strong, plus a 4px `--ad-run-mint` left bar |
| `.toast.error` | `#e32b2b` fill, white text |
| `.offline-banner` | adidas promo bar in red: full width, 40px, `#e32b2b`, white 14/20 bold uppercase, 1px tracking. Keep the pulse |
| `.hold-hint`, `.wl-hint` | 14/20; `.wl-hint` text `--ad-text` with the ⭐ as content |

### 4.12 Loading and empty states
- **Loader (adidas):** a circular spinner with a 5px black border clipped to a quarter (`clip-path: ellipse`), spinning `.7s linear`. Small = 32px with a 1px stroke. The linear variant is a 1px bar.
- **`.page-loading`** ("Connecting…"): add a 32px spinner with `::before` on the container. Set the text in `--ad-label-caps` with 2px tracking.
- **Empty states** (adidas `stateempty` uses adidasFG titles): `--ad-headline-s` title, `--ad-body-m` grey line, optional primary CTA. Apply to `.scr-feed.empty`, "No bids yet" and empty tables.

### 4.13 Player photo

| DPL element | New look |
|---|---|
| `.player-photo` (all sizes) | `border-radius: 0; border: 0; background: var(--ad-surface-alt)`. Keep the sizes (34 / 96 / 150 / 230px) |
| `.placeholder` | Anton initials, `--ad-text-2` |
| `.photo-preview img` | Radius 0, no border |
| Projector `.scr-photo-frame` | No gradient frame: `padding: 0; background: none; border-radius: 0`. The photo sits on its tile. Optional 4px tier stripe on the left edge (`box-shadow: inset 4px 0 0 var(--tier)` on the wrap). Hide `.scr-photo-glow` |

### 4.14 Timers and the countdown ring

| DPL element | New look |
|---|---|
| `.hammer-timer` | **Barlow Condensed 800** 30px, tabular, `--ad-text` (not Anton: no tabular figures, §3.2). **`.urgent`** = `#e32b2b`; keep the pulse |
| `.timeout-timer` | Barlow Condensed 800 `clamp(32px, 8vw, 56px)`, tabular. `.done` = `--ad-label-caps` grey |
| `.scr-ring .track` | `stroke: var(--line)` (unchanged) |
| `.scr-ring .arc` | `stroke: var(--ad-ring)` (mint on dark, Running green on white), **`stroke-linecap: butt`** (square ends, adidas) |
| `.scr-ring.urgent .arc` | `#e32b2b` |
| `.scr-ring-num` | Barlow Condensed 800, tabular, `--hi`. Urgent: red, **no text-shadow glow** |
| `.scr-danger-vignette` | Hide it, or replace it with 8px red edge bars |

---

## 5. Screen-by-screen mapping

Each screen keeps its layout and DOM. Only the CSS changes. Class names are from the current code.

### 5.1 Landing: `/` (`Landing.tsx`, `styles.css:211-218`)
**adidas pattern:** the Running app page. A big uppercase hero, a black promo strip and three teaser cards ("LET'S GO" on the hub).

| Element | Spec |
|---|---|
| `.landing` | Max-width 1000px, padding 48px 16px 64px |
| `.landing-hero h1` | `--ad-display-xl`, using `font-size: clamp(30px, 6vw, 80px)`, 2px tracking, uppercase, centred |
| LIVE / OFFLINE (`.conn-dot`) and `.theme-toggle` | Tag and ghost-icon specs (§4.3, §4.5) |
| Subtitle | `--ad-body-l`, or `--ad-editorial` (Newsreader Light) for the Running-page feel |
| `.stage-banner` | Promo bar (§4.5) |
| `.landing-cards` | Gap 16px. Each card: `--ad-headline-s` title, `--ad-body-m` text, CTA at the bottom |
| Captain card | `.code-input` (§4.9), then **`.btn.primary.big`** "Join as captain" with an arrow and the offset outline |
| Auction Screen card | Secondary button "Open the auction screen" |
| Auctioneer card | Secondary "Admin sign-in"; the PIN form uses the inputs in §4.9 |

**Responsive:** cards stack under about 600px (existing `auto-fit`). The hero drops to 30/30, as on adidas mobile.

### 5.2 Join (`/join/:code`) and Photo (`/photo/:code`)
- **Join** (`JoinPage.tsx`): one card at 420px with an adidas loader and "Joining…" in `--ad-label-caps`. The error state is a `.notice.error` plus a secondary "Back to start".
- **Photo** (`PhotoPage.tsx`, `styles.css:367-371`): mobile-first like the adidas product page.
  - Title `--ad-headline-s`.
  - Current photo as an xl square tile.
  - "Choose a photo" = `.btn.primary.big` with arrow.
  - Preview: square, no radius. "Looks good — upload" is primary; "Pick another" is secondary.
  - Notices per §4.11.

### 5.3 Admin: `/admin` (`AdminPage.tsx`, `admin/*`)
**adidas pattern:** the header (§4.5), product-page buy box (lot card), size grid (bid buttons) and listing tables.

**Topbar.** Brand + `.stage-chip` on the left. Uppercase `nav.tabs` (🔨 Auction · Players · Teams · Settings · Log) with the 2px underline. Theme, sound and LIVE as ghost icons and tag. "Sign out" as a ghost button. Below it: `.offline-banner` (red bar), then `.warnings` (orange-bar messages).

**🔨 Auction (`AuctionConsole.tsx`)**

| Element | Spec |
|---|---|
| `.stagebar .tier-chip` | Two-line **size-grid tiles**: `--ad-surface-alt` fill, radius 0, `border: 0 solid; border-left-width: 4px` (the chip's inline `borderColor` paints a tier stripe; plain chips such as Total and Set fall back to `--ad-divider`), 14/20 bold name with 12/16 grey `sold/total`. **`.active`** = inverse block, no outline. `.timeout-chip` = orange stripe (`border-left-color: var(--ad-orange)`). The tier name span is inline-coloured, so see the note below |
| SetupPanel | Card. The rules toggle is a secondary button, and `.btn.warn` ("on air") per §4.1. "▶ Start the auction" = `.btn.primary.big` with arrow and outline |
| **LotCard** | adidas **buy box**. Eyebrow row: tier tag, HOT and SLEEPER tags. Name (`h1.lot-name`): `--ad-headline-m` (38/40 uppercase, 3px tracking). Meta line `role · base`: `--ad-body-s` grey, with base in `--ad-price`. Photo md as a square tile. `.lot-bid-box` (right): `.hammer-timer` (Barlow Condensed 800, §4.14), the label "Current bid" in `--ad-label-caps`, `.lot-bid-amount` in **Anton 44px** (it changes once per bid, so proportional digits are fine), and `.lot-bid-team` in 16/24 bold with a 10px team square. Stats per §4.7. Notes: `--ad-body-s` with a 2px `--ad-divider` left rule |
| Bid history | Rows per §4.8, with the leading row as an inverse block |
| **BidPanel `.bid-buttons`** | adidas **size grid**: 2 columns, **gap 4px**. Each `.bid-btn`: `min-height: 64px`, `background: var(--ad-surface-alt)`, `border: 0; border-left: 6px solid` (the inline `borderColor` gives the team stripe), `color: var(--ad-text) !important` (overrides the inline team-coloured text), radius 0. `.bid-btn-name` 14/20; `.bid-btn-amt` Barlow Condensed 700 22px tabular. Hover: `--ad-hover-alt`. Disabled ("LEADING" / "OUT"): transparent, text `--ad-text-disabled`, stripe kept. Optional: render "LEADING" as an inverse tag |
| Custom bid row | `select.input`, `input.input` and a secondary `.btn` "Bid" on one 48px line |
| `.hammer-row` | **SOLD** = `.btn.ok.big.grow`, the mint CTA with outline; the amount stays in the label. **UNSOLD** = `.btn.warn`, red outline |
| Ghost row | Undo last bid, Cancel lot, ⏱ 10s / 20s, Clear ⏱: ghost buttons, small (40px) |
| BetweenLots | "🎲 Draw next player" = `.btn.primary.big`; pick-a-player `select.input` + secondary "Put up"; "⏸ Call a strategic timeout" = ghost |
| TimeoutPanel | `.timeout-card` (§4.6), `.timeout-timer` (Barlow Condensed 800, §4.14), team rosters as list cards, "▶ Resume" primary big |
| PhaseEnd | Primary (accelerated); 🏁 Complete = `.btn.ok.big` (mint) |
| PurseTable "Live purse tracker" | Table per §4.8. Team name has a 10px square; amounts tabular, right-aligned; `.row-dim` for full or out teams |
| Undo (`.btn.warn.wide`) | Red outline, full width |
| ResultsPanel | `.results-grid` of `.result-team` cards with a 6px top stripe; "↩ Reopen" = `.btn.warn` |

> **Tier chips note:** the chip carries `style={{ borderColor }}` and its name span carries `style={{ color }}` (`AuctionConsole.tsx:66-67`). With a left-only border the chip shows the tier as a stripe, so neutralise the text: `.tier-chip > span[style] { color: var(--ad-text) !important; }`, and inverse text on `.active`. Then delete the light-theme brightness filter at `styles.css:147-148`; the selector `.tier-chip > span[style]` still depends on that inline style being present, so keep the JSX as it is.

**Players (`PlayersTab.tsx`).** Toolbar: search `.input` (48px; adidas search uses a grey `#e9ecef` fill and 14px text, which is optional), tier and status `select.input`, "+ Add player" primary, "Bulk add" secondary, "📸 Copy photo links" ghost. Table per §4.8 with sm photo tiles, the tier tag and status text. `.actions` hold ghost small buttons; "Release" is `.warn-text` in red. Modals per §4.10. `<details>` "Career stats" becomes an accordion row.

**Teams (`TeamsTab.tsx`).** `.teams-grid` gap 16px. `.team-card` with a 6px top stripe, h3 `--ad-headline-s`, `.team-money` as value/label pairs, `.join-box` as a grey tile:
- QR code at 84px with radius 0.
- `.join-code` in Barlow Condensed 700 28px with .25em tracking.
- Copy link and New code as ghost buttons.

The `.add-team` tile is dashed (§4.6).

**Settings (`SettingsTab.tsx`).** `.settings-stack` max 760px. Each section is a card with a `--ad-headline-s` title. Increment and tier rungs: inline `.input`s on one line, with `.rung-label` 14px bold. "💾 Save settings" = primary big. The `.card.danger` Danger zone has a red border, with `.btn.warn` actions.

**Log (`LogTab.tsx`).** Table per §4.8, with `.log-type` as subtle tags (§4.3).

### 5.4 Team (bidder): `/team` (`TeamPage.tsx`), phone first
**adidas pattern:** the mobile header, the Running app stat triplet (money bar), the "Add to bag" buy button (hold to bid), chips (pool filters) and listings (pool table).

| Element | Spec |
|---|---|
| Topbar | Team `.dot.big-dot` becomes a **16px square** in team colour. `.brand` = team name, Barlow Condensed 700 uppercase. The line under it is `--ad-body-xs` grey. Tabs Live / My squad / Pool & watchlist are uppercase with the underline; on ≤520px let them scroll horizontally (`overflow-x: auto`), like adidas' `gl-tabs` list. Theme, LIVE and Exit as ghost icon, tag and ghost |
| `.money-bar` | **Stat triplet** (§4.7): 4 cells, value above label, 1px dividers. "Max next bid" `.accent` keeps its team-colour bottom bar (4px). Sticky `top` = new topbar height |
| Waiting card + RulesCard | `.center-note` and accordion (§4.6) |
| Timeout card | `.timeout-card` + Barlow Condensed 800 countdown (§4.14) |
| **Lot card** | Same buy box as the console (§5.3): photo, tags, `h1.lot-name` (`--ad-headline-m`, 30/32 on mobile), meta, bid box (timer, label, Anton amount, leader line). "✅ YOU are leading" is bold with `--ad-success-text`. `.lot-card.you-lead` per §4.6 |
| `.wl-hint` | §4.11 |
| **HoldBidButton** (`btn primary bid-big hold-bid`) | adidas buy button: full width, `min-height: 60px`, label 18/24 bold, `--ad-action` fill, **no offset outline** (`.hold-bid::after { display: none }`, because `overflow: hidden` would clip it). Fill sweep: `.hold-fill { background: color-mix(in srgb, var(--ad-run-mint) 45%, transparent); }`, so holding visibly fills it with mint and the label stays legible over it. **`.leading`** = solid `--ad-run-mint` fill with `#000` text ("you're leading" = the win colour). `:disabled` per button disabled spec |
| "Bidding on this player" | Bid rows (§4.8), "You" in bold |
| All purses (RivalsCard) | Table (§4.8), `.row-you` shaded |
| Top sales so far | List rows: name 14px bold, team square, amount right in `--ad-price` |
| **My squad** | Table (§4.8) in `.table-scroll` |
| **Pool & watchlist** | Filter pills = **chips** (§4.4, scoped `.card .tab`). `.pool-table`: sm photo tiles, name + tags, tier tag, role, MVP, base and target (tabular), status text. `.star` ⭐/☆ stays as content: opacity .35 → 1 when `.on`. The WatchlistModal follows §4.10 |

**Responsive:** below 900px the grid is already one column. Below 520px keep `.hide-narrow` and use adidas' 14–16px side margins.

### 5.5 Projector: `/screen` (`ScreenPage.tsx`, `screen.css`)
**adidas pattern:** the black editorial sections of the Running app page (dark theme) and the white listing and product pages (light theme). Huge condensed uppercase type, flat colour, square plates, mint as the one accent.

**Arena and header**

| Element | Spec |
|---|---|
| `.scr-ambient` | Flat `--bg-0`. Hide `.scr-beam`, `.scr-gridlines` and `.scr-vignette` (`display: none`). `.scr-leadtint` is optional; if kept, cap `--lead-on` at about 0.08 for a subtle team lean |
| `.scr-head` | 68px, flat `--ad-page`, 1px `--line` bottom border. **Hide the sheen** (`.scr-head::after { display: none }`) |
| `.scr-brand` | Anton, `clamp(16px, 2vw, 26px)`, 2px tracking. `.scr-brand-bar`: 6×30 solid `--ad-run-mint` (dark) or `#000` (light), no gradient |
| `.scr-stagechip` | Tag: transparent, 1px `--hi` border, Barlow 700 14–18px, .24em tracking. Text is `--hi` (the tier shows as a 4px left stripe, `border-left: 4px solid var(--tier)`). `[data-stage=timeout]` and `accelerated`: border and stripe `--ad-orange` |
| `.scr-sound`, `.scr-theme` | 42px ghost icon buttons, radius 0, 1px `--line` border; hover `--ad-hover`. `.muted` = .5 opacity |
| `.scr-live` | 14–17px bold, .3em tracking, `--live`. The dot is a 12px **square**; keep the radar ping, but with square pings (`border-radius: 0`) |

**Lot view (`data-view="lot"`)**

| Element | Spec |
|---|---|
| `.scr-lotline` | Eyebrow: Barlow 700, .16em tracking, `--mid`; first span `--hi`; `.alert` = `--ad-orange` |
| Photo | §4.13: square tile, no frame or glow; the guillotine reveal keyframe stays |
| `.scr-name` | Anton, same clamp × `--name-scale`, `letter-spacing: 2px`, line-height .95. The `scrNameIn` keyframe stays (ends at 2px tracking; update the `to` value) |
| `.scr-meta` chips | §4.3 projector row. **Remove** the HOT glow pulse (`animation: none`) |
| `.scr-sg-title` | Barlow Condensed 700, `--mid`; right rule 2px `--line` (or keep the tier tint at .55) |
| `.scr-stat` | Flat `--panel` tile with a 2px top border in `var(--tier)`. `.scr-stat-v`: Barlow Condensed 700, same clamp, tabular. `.scr-stat-l`: Barlow 600 uppercase, .1em tracking, `--mid`. `.scr-stat-rank`: `--hi` bold (or a tiny inverse tag) |
| `.scr-notes` | `--mid`, 2px `--line` left rule |
| `.scr-eyebrow` "Current bid" | Barlow 700, .26em tracking, `--mid` |
| **`.scr-amount`** | Anton, same clamp, **flat colour**: with `--gold` = `--hi` the gradient collapses to solid white on dark and black on light. **Remove** the `filter: drop-shadow`; the `scrSlam` keyframe keeps its motion, but delete the blur and drop-shadow steps from its frames |
| `.scr-shockwave` | Square, `border-radius: 0`, 2px `--hi` at 0.5 opacity, or hide it |
| **`.scr-plate`** (LEADING) | **Rectangle:** `clip-path: none` at rest; padding 10px 20px; `--lead` fill; Anton uppercase, 2px tracking; **no text-shadow**. Keep `.dark-ink` (black text on light team colours) and `.open` (transparent, 1px `--line`, `--mid` text). Replace the parallelogram keyframe with a straight wipe: `@keyframes scrPlateWipe { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }` |
| `.scr-nextmin` | Barlow 600 uppercase, `--mid`; `b` = `--hi` |
| `.scr-edgeflash` | Keep (event feedback): 8–12px bars in `--lead` |
| Ring | §4.14 |
| **Feed `.scr-bid-row`** | **Height stays 46px** (§2.2). Flat `--panel`, 1px `--line` bottom border, `.bar` 6px `--team`, `.team` Barlow 700 uppercase 19px, `.amt` Barlow Condensed 700 22px tabular `--hi`. Keep the opacity fade |

**Idle view (`data-view="idle"`)**
- `.scr-watermark`: hide it, or keep it static (no breathing) at 0.04 opacity.
- `.scr-idle-headline`: Anton, solid `--hi`, no shimmer, 2px tracking. The `.tier` word becomes an inverse block (the adidas highlight text-box: inline `background: var(--hi); color: var(--bg-0); box-decoration-break: clone; padding: 0 .15em`).
- CategoryBoard and HotListBoard: flat tiles (`--panel`), 1px dividers. Category header `.tname` gets a 4px tier stripe; `.scr-cat-name.sold` keeps its inset team bar; hot rows are list rows with a rank numeral in Anton.
- Ticker `.scr-ticker-track` and `.scr-signing`: flat tiles with a 6px team stripe.

**Rules view (`data-view="rules"`)**
- `.scr-rules-tile`: size-grid tiles on `--panel`. The number is Anton large; the label is `--ad-label-caps`.
- `.scr-rules-list`: numbered rows with 1px dividers; numerals in Anton `--hi`.

**Timeout view**
- `.scr-to-badge`: Anton uppercase, 3px tracking, `--hi`, with an orange square before it.
- `.scr-to-timer`: Barlow Condensed 800 at the same giant size, tabular (it ticks, §3.2). `.urgent` is red, `.done` is `--mid` caps.
- Team columns: flat `--panel` cards with a 6px team top stripe. `.scr-to-purse` uses the stat-triplet layout; the fuel bar is a 4px track.

**Final view**
- `.scr-final-head`: **remove the clip-path notch** (`clip-path: none`) for a flat team-colour header with Anton uppercase text. Keep `.dark-ink`.
- `.scr-final-row`: list rows with 1px dividers. `.top-buy` = inverse block, or mint fill with black text. `.fchip` "TOP BUY" = mint tag with black text.
- Awards strip `.scr-award`: adidas spec-highlight style. Label in `--ad-label-caps`, value in Barlow Condensed 700, a 6px `--team` left stripe.

**Footer purse tower `.scr-foot`**
- `.scr-foot`: `--ad-page` with a 1px `--line` top border.
- `.scr-cell`: keep the 6px `--team` left border. **Remove** the skewed divider (`.scr-cell + .scr-cell::before { transform: none; width: 1px }`).
- `.scr-cell-name`: Barlow Condensed 700 uppercase.
- `.scr-purse`: Anton, flat `--hi` (the gradient collapses via `--gold`). It changes once per sale, so proportional digits are fine.
- `.scr-delta`: red, `.up` uses `--live`.
- `.scr-squad` and `.lbl`: `--ad-label-caps`.
- **`.leading`** = **inverse cell**: `background: var(--hi); color: var(--bg-0)`, with the name, purse and labels inheriting. **Remove** `scrCellGlow`.
- `.out`: value in red; main at .5 opacity.
- `.full`: .55 opacity.
- `.scr-fuel`: 4px track, `--team` fill.

**SOLD / UNSOLD takeover (`.scr-flash`)**. Timing is untouched (§2.2).

| Element | Spec |
|---|---|
| `.scr-flash-scrim` | `rgba(0,0,0,.8)` |
| `.scr-flash-panel.a` / `.b` | **Solid** `var(--fc)` (no gradients). Optionally drop the skew so the panels are flat halves; then also update the `scrPanelA` and `scrPanelB` keyframes. UNSOLD panels: solid `#000` and `#1e1e1e` |
| **`.scr-stamp`** (SOLD) | **The Running tile:** `background: var(--ad-run-mint); color: #000; padding: 0 .18em;` Barlow Condensed **800 italic** (or Anton with `transform: skewX(-8deg)`), no text-shadow; keep the slam keyframe and the -4° tilt, or set rotation to 0 for pure adidas. `.dark-ink` changes nothing, because the tile is always mint with black text |
| `.scr-flash.unsold .scr-stamp` | White Anton on transparent, 5px `#e32b2b` border, square |
| `.scr-flash-shock` | Square ring (`border-radius: 0`), or hide it |
| `.scr-flash-card .player-photo.xl` | Square, 4px white border (`.dark-ink`: black), **no box-shadow** |
| `.scr-flash-name` | Anton uppercase, 2px tracking, no text-shadow |
| `.scr-payoff-team` | **Rectangle** (`clip-path: none`), inverse block: `#000` with white text on light team colours, white with black on dark ones. Barlow 700 uppercase, .16em tracking |
| `.scr-payoff-price` | Anton, flat, no shadow; `.pts` in `--ad-label-caps` style |
| Confetti | Unchanged (colours come from JS, §2.4). Optional Phase 4: swap `#fbbf24` for `#8dfe8e` in `ScreenPage.tsx:871` |

**Light projector:** everything inverts. White arena, black type, Running-green ring, black plates' ink on light team colours via `.dark-ink`. Remove the light-only filters at `screen.css:85-93` once tier colour lives in stripes.

**Projector responsive:** keep every existing query (980px stack, max-height 900 / 820 / 700 trims, the 981px projector fit, the 560px phone fallback). Re-check 1280×720, 1366×768 and 1920×1080 after the font swap: Anton metrics are unchanged, but Barlow is narrower than Archivo, so rows will gain room, not lose it.

---

## 6. Implementation plan

Work top-down. Each step is CSS-only unless marked.

| Step | Files | What |
|---|---|---|
| **0. Fonts** | `client/index.html:8-10` | Replace the font link with: `https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,800&display=swap`. Add `&family=Newsreader:opsz,wght@6..72,300` only if you use the editorial serif. Archivo is no longer needed once `--font-body` points at Barlow. Also set `<meta name="theme-color">` to `#000000` (`index.html:6`) |
| **1. Tokens** | `styles.css:6-54`, `screen.css:14-42`, `screen.css:60-82` | Paste `tokens.css` sections A–C and E at the top of `styles.css` in place of the old variable blocks. Paste section D into `.scr-page` and delete the old light block. **Ship E with C** (the primary-button fix). Most of the palette and every corner change already happen at this step |
| **2. Base** | `styles.css:56-77` | `body`: `font-family: var(--ad-font-body); font-size: 16px; line-height: 1.5`, flat background. `h1–h3`: Barlow Condensed 700 uppercase with tracking (map 26/20/16 to `--ad-headline-s` / 20px / `--ad-eyebrow`). `a`: §4.2. `code`: radius 0. `hr.sep`: 1px divider |
| **3. Components** | `styles.css:79-385` | In order: `.card` → buttons (+ offset outline) → `.input` / labels → `.table` → badges and tags → toasts, modal, notices, warnings → topbar and tabs (**update `.money-bar` top**) → landing → console (stagebar, lot, stats, bid history, bid buttons, hammer row) → teams and settings → team page (money bar, bid-big, hold-bid) → photos → rules card |
| **4. Projector** | `screen.css` | Ambient off → header → lot identity → theatre (amount, plate, ring, feed) → idle → rules → timeout → final → footer → SOLD/UNSOLD. Then delete `screen.css:85-93`. Keep §2.2 untouched |
| **5. Phase 4 (optional, tiny JSX)** | `ui.tsx`, `ScreenPage.tsx`, `theme.ts` | Thin-line SVG icons instead of emoji; arrow icons on primary CTAs; `TierBadge` passes `--tc` instead of an inline `color` (removes the need for `!important`); confetti palette; **default theme** (adidas web is light-first; your default is dark — your call) |

### Verification checklist
- [ ] Every route in **both themes**: `/`, `/join/X`, `/photo/X`, `/admin` (5 tabs), `/team` (3 tabs), `/screen`.
- [ ] Projector at **1280×720, 1366×768, 1920×1080**: lot view fits without scrolling, the bid feed trims rows (`.cut`), and the footer is readable from the back of the room.
- [ ] Projector views: idle, rules, timeout, final; SOLD and UNSOLD overlays finish before 4s and unmount cleanly.
- [ ] Phone at **375px**: tabs scroll, the money bar sticks under the topbar with no gap or overlap, and hold-to-bid still needs the full hold. Leading turns mint; releasing early snaps back.
- [ ] Admin: bid buttons show team stripes; LEADING / OUT disabled styles; SOLD (mint) and UNSOLD (red outline) are obvious at a glance.
- [ ] Keyboard: every button and tab shows the dashed focus outline; inputs show the 2px bottom border.
- [ ] `prefers-reduced-motion`: the projector is static and legible.
- [ ] Countdowns don't jitter: every ticking number is in Barlow or Barlow Condensed, never Anton (§3.2).

---

## 7. Accessibility

| Check | Result / rule |
|---|---|
| Black on white, white on black | 21:1 |
| `--ad-text-2` `#767677` on white | 4.5:1, passes AA for body text (adidas' own secondary) |
| `#929396` on black (dark secondary) | 6.6:1, passes |
| Black on mint `#8dfe8e` | 17:1, passes. **Mint text on white: 1.2:1. Never do this** |
| `#e32b2b` on white | 4.4:1: fine for bold or large text (timers, tags, buttons), borderline for small regular text |
| `#00aa55` on white | 3.0:1: **fails** for text. Use `#408267` (4.9:1) on light; the token already does this |
| `#d98916` on white | 2.7:1: **fails**. Black text plus an orange bar or icon on light; orange text is fine on black (7.6:1) |
| Focus | adidas: 1px **dashed** outline, 4px offset (6px on offset-outline CTAs). Never remove focus without a replacement |
| Touch targets | At least 44px (`--ad-size-hit`). Small (32px) buttons only on desktop admin tables |
| Colour alone | HOT, SLEEPER, LEADING, OUT, SOLD and UNSOLD all keep their words; team colour is never the only cue (names are shown) |
| Uppercase | Short strings only; screen readers read the source text, so keep the source sentence case where it is now |
| Skip link | adidas ships "SKIP TO ADD TO BAG" (black, 14/20 bold, 2px tracking). Optional for the admin console ("Skip to bid panel") as Phase 4 |
| Motion | Keep `prefers-reduced-motion`; adidas triples spinner duration under it |

---

## 8. Edge cases

| Case | Rule |
|---|---|
| Long player names | The projector already scales with `--name-scale`. Console and phone `.lot-name`: `text-wrap: balance; overflow-wrap: anywhere` |
| Long team names | Plates and feed already ellipsis-truncate; keep `white-space: nowrap` with `text-overflow: ellipsis` |
| Big numbers (100,000+) | Tabular figures; amounts never wrap (`white-space: nowrap`) |
| Missing photo | Initials placeholder (Anton, grey on the tile) |
| Pale team or tier colours (yellow, cyan, lavender) | Stripes only. Text sits on neutral surfaces; `.dark-ink` handles text on colour fills |
| Empty states | §4.12: no bids, empty squad, empty watchlist, nothing unsold |
| Offline | Red promo bar (§4.11) plus the LIVE tag turns red |
| Slow fonts | `display=swap` keeps text visible; the fallback stacks are condensed and grotesque, so the layout barely shifts |
| Light theme on the projector | Everything inverts; mint appears only as a fill (SOLD tile, `.fchip`) |

---

## 9. Appendix

### 9.1 Raw adidas component CSS (resolved values)
- **Primary CTA** `gl-cta--primary`:
  - Base: `font: 700 16px/24px AdihausDIN; min-height: 48px; padding-inline: 16px; background: #000; color: #fff; border-radius: 0; gap: 8px; transition: transform .3s cubic-bezier(.3,0,0,1), color .3s; transform-style: preserve-3d`.
  - `:hover`: `background: #1e1e1e`.
  - `--dropshadow::after`: `border: 1px solid var(--outerbox-color); left: 4px; top: 4px; width/height: 100%; transform: translateZ(-1px)`. The outer box is `#000`, and `#929396` on hover.
  - `:focus-visible::before`: `outline: 1px dashed #000; left/top: 2px; outline-offset: 6px`.
  - Disabled: `background: #d9dbdd; color: rgba(0,0,0,.3)`.
  - Small: `min-height: 32px; padding-inline: 8px`.
  - On dark: `background: #fff; color: #000`; hover `#f5f5f5`; disabled `#3b3b3c` / `rgba(255,255,255,.3)`.
- **Secondary** `gl-cta--secondary`: `background: #fff; border: 1px solid #000; color: #000`; hover `background: #f5f5f5; border-color: #929396`.
- **Membership** `gl-cta--membership`: `background: #408267; color: #fff`; hover `#336853`.
- **Icon buttons** `gl-cta-icon`: 48 / 40 / 32px squares in primary, secondary and ghost variants. Ghost: transparent with a 1px transparent border; hover `#f5f5f5` with border `#929396`.
- **Tag** `gl-tag`: `min-height: 28px; padding: 4px`; regular 14/20 400, strong 700; default `#000`/`#fff`, membership `#408267`/`#fff`, subtle `#eceff1`/`#000`.
- **Chip** `gl-chip-selection`: `height: 32px; padding: 4px 8px; border-width: 1px; font: 400 16px/24px; transition: .2s ease-in-out`. Inactive `#fff` / `#929396` / `#000`, hover `#f5f5f5` / `#000`. Active `#000` / `#d9dbdd` / `#fff`, hover `#1e1e1e` / `#929396`. Group gap 8px.
- **Size grid** `gl-chip-selection-size`: `grid-template-columns: repeat(auto-fill, minmax(80px, 1fr))`, items `min-height: 40px`, active `background: #000; border: 1px solid #000`. The live product page uses 5 columns, gap 4px, `#eceff1` cells and 14px text.
- **Tabs** `gl-tabs`:
  - Item: `height: 56px; padding: 0 8px; 400 16px/24px; border-bottom: 2px solid transparent`.
  - Active: `700; border-bottom: 2px solid #000`.
  - Hover `#f5f5f5`; list bottom border 1px.
  - Focus: `background: #eceff1; border: 1px dashed #000`.
- **Accordion** `gl-accordion__button`: small 48px, large 80px; `padding-inline` 16px / 24px; `700 16px/24px`; `border-bottom: 1px solid #d9dbdd`; hover `#f5f5f5`. On the live product page: 80px rows, padding 24px 32px.
- **Input** `gl-input__field`:
  - Base: `background: #fff; border: 1px solid #929396; padding: 30px 16px 8px; font: 400 16px/24px`.
  - Hover: `border-color: #000`. Focus: `border-bottom: 2px solid #000`. Error: `border-bottom: 2px solid #e32b2b`. Disabled: `#d9dbdd`.
  - Floating label: 16/24 `#767677`, shrinking to 12/20 at `top: 8px` over `.3s cubic-bezier(.3,0,0,1)`.
- **Checkbox:** 24px, 1px `#929396`; hover border `#000` + `outline: 4px solid #f5f5f5`; checked `#000` fill with white check; label 16/24, 700 when checked.
- **Radio:** 32px outer (24px ring, 16px dot); active ring 1px `#929396`, dot `#000` scale 0 → 1 over .3s.
- **Toggle:** a 56×24 track (1px `#929396` border) with a 24×16 black knob. Checked: black track, white knob, bold label. Transition `.3s linear`.
- **Modal** `gl-modal`:
  - Base: `width: 80vw; max-height: 80vh; padding: 20px 0; background: #fff; border-radius: 0`; `::backdrop rgba(0,0,0,.75)`; body `padding: 0 20px`, 16/24.
  - Title: adidasFG 30/32 at 3px tracking, uppercase; 38/40 at ≥960px.
  - Animations: fade-in .3s, or slide-in-left .3s ease-out.
- **Inline message:** padding 16px, gap 8px, 32px icon area. Low = 1px `rgba(0,0,0,.1)`; medium `#eceff1`; strong `#000`; error `#fff0f0`; success `#defbe6`; action area margin-top 16px with a 16px gap.
- **Tooltip:** black panel with a 2px border, min-width 362px, padding 16px 40px 16px 16px, title 16/24 bold white, close button at 8px / 8px.
- **Loader:** circular 96px with a 5px `#000` border, clip-path quarter, `.7s linear infinite`; small 32px with a 1px stroke; linear = 1px bar sliding over 1.4s.
- **Links:** `text-decoration: underline; text-underline-position: from-font`; hover `background: #000; color: #fff`. Menu links underline only on hover.
- **Dividers:** primary 2px `#3b3b3c`; secondary 1px `#d9dbdd`.
- **Pagination dots:** 16×8px items, gap 2px, 1px bottom border `#929396`.

### 9.2 Hooks JS depends on (keep these selectors working)
- **Console and phone:**
  - `.tab.active`, `.tier-chip.active`, `.timeout-chip`, `.timeout-timer.done`, `.hammer-timer.urgent`, `.bid-row.leading`, `.row-dim`, `.row-you`
  - `.lot-card.you-lead`, `.hold-bid.leading`, `.hold-bid.holding`, `.star.on`
  - `status-{available|sold|unsold}`, `stage-{…}`, `log-{…}`
  - `.conn-dot.on` / `.off`, `.sound-toggle.muted`, `.toast.{kind}`, `.notice.{kind}`
  - `.player-photo.{sm|md|lg|xl}` / `.placeholder`, `.stat-groups.compact`, `.warn-text`
- **Projector:**
  - `.scr-sound.muted`, `.scr-live.off`, `.scr-plate.dark-ink` / `.open`, `.scr-ring.urgent`, `.scr-feed.empty`
  - `.scr-ticker-track.marquee` / `.static`, `.scr-boards.two`
  - `.scr-cat-name.{status}`, `.scr-hot-row.{status}`, `.scr-to-timer.done` / `.urgent`
  - `.scr-final-head.dark-ink`, `.scr-final-row.top-buy`, `.scr-cell.leading` / `.full` / `.out`, `.scr-delta.up`
  - `.scr-flash.{sold|unsold}.dark-ink`, `.scr-lotline .alert`, `.scr-edgeflash`, `.scr-danger-vignette`, `.cut` (set by BidFeed)
- **Attributes:** `data-theme`, `data-view`, `data-stage`.
- **Variables set from JS:** `--tier`, `--tier-rgb`, `--lead`, `--lead-on`, `--name-scale`, `--i`, `--ci`, `--team`, `--team-rgb`, `--tc`, `--fc`, `--fc-rgb`, the confetti vars, `--team-color`, `--hold-ms`.

### 9.3 Native dialogs (unstyleable)
`window.confirm` at `PlayersTab.tsx:175, 252`, `SettingsTab.tsx:68, 186, 193` and `TeamsTab.tsx:72, 117`.

### 9.4 Reference screenshots (`reference/`, local only)
`01` running-app hero · `02` black split with app mockups · `03` guided-runs split · `04` events split with stats mockups · `05` hub hero text-box + CTA · `06` listing header, tabs, filter · `07` product cards · `08` product gallery + buy box · `09` size grid, add to bag, spec highlights, accordion · `10` adiClub band + footer · `11` mobile hero · `12` mobile app mockups · `13` help cards · `14` privacy dialog.

### 9.5 Licensing
- Emulate the *design language*: colours, spacing, square shapes, type treatment and layouts.
- Don't ship adidas logos, the three-stripe or Badge of Sport marks, the "RUNNING" wordmark, adidas photography, or the proprietary fonts. That is why this handoff uses free font stand-ins and a home-made arrow.
- Keep `reference/` out of the public repo; its `.gitignore` already does.
