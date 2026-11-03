# Design system

CrowdFlow's UI is built from CSS custom properties defined in `client/src/assets/main.css`, with light and dark values. Components read tokens; they do not hard-code colours.

## Colour tokens

| Token | Use |
| --- | --- |
| `--bg`, `--card`, `--line` | Page, surface and border |
| `--ink`, `--ink-2` | Primary and secondary text |
| `--lead`, `--lead-soft`, `--accent` | Brand and per-presentation accent |
| `--on-accent` | Text on a filled accent or lead surface |
| `--good`, `--danger`, `--danger-ink`, `--danger-soft` | Success, destructive actions, error text |
| `--inverse`, `--inverse-ink`, `--inverse-muted`, `--inverse-line` | Always-dark band (landing closing section) |
| `--t-*` | Presentation theme variables, set per theme and mode in `client/src/themes.ts` (`--t-correct` marks correct quiz answers) |

## Radius, spacing and type

Named steps for the values the app already uses. Use these in new code instead of raw numbers.

| Token | Value | Notes |
| --- | --- | --- |
| `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius` | 8, 10, 12, 14px | Controls, inputs, small cards, cards |
| `--radius-pill` | 999px | Pills and chips. `50%` stays for circles |
| `--space-1` to `--space-7` | 4, 8, 12, 16, 24, 32, 48px | Gap, margin and padding |
| `--fs-xs`, `--fs-sm`, `--fs-base`, `--fs-md`, `--fs-lg` | 0.78, 0.85, 0.9, 1.05, 1.15rem | Body and UI text |

Existing exceptions, kept so the look does not drift: spacing values 5, 6, 10, 14, 18, 20, 22 and 28px, font sizes such as 0.72, 0.8, 0.88, 0.92 and 0.95rem, one-off radii (2 to 7, 9, 11, 16 to 30px), and `clamp()` display sizes for headings. Fold them into the steps only in a deliberate visual change with before/after screenshots.

## Rules

1. No hex or `rgb()` literals in `.vue` files. Add or reuse a token. Exceptions are listed with a reason in `client/src/__tests__/tokens.test.ts`, which fails on any new hex colour in a component. Per-theme palettes live in `themes.ts`.
2. Every new token needs a light and a dark value.
3. Text and its background must keep WCAG AA contrast (4.5:1). `client/src/__tests__/themes.test.ts` checks the presentation themes.
4. Do not use `var(--token, #fallback)`: the token always exists, and a wrong fallback hides mistakes.
5. Keep the supplied logo files unchanged.

## UI standards for new features

Tokens say what colours and sizes exist. These rules say how new screens are put together, so features share one look. They come from the project's components and from feedback the owner has given on this and other apps.

**Layout and density**
1. Compact beats tall, on phones most of all. Check every screen at 390px and 1280px, in light and dark mode, before showing it.
2. Cards in one row have the same height and the same internal order. Images are cropped to one fixed ratio with `object-fit: cover`, never stretched.
3. Secondary tools open in a dialog (`NewPresentationDialog.vue` and `ConfirmDialog.vue` are the patterns), not as a block that pushes the form down. Inline expansion is for one or two short fields.

**Controls**
4. One primary action per view, filled (`.button`). Secondary actions use `.button.secondary` or `.ghost`. A row of identical ghost buttons is a sign the hierarchy is missing.
5. Repeated per-item actions (delete, use, move) are icon buttons with a visible label on hover and an accessible name, not full-width text buttons on every item.
6. Raised, soft-3D surfaces: one subtle `--shadow`, a clear pressed state, no inner shadows, and a lighter shadow in dark mode. Neutral backgrounds.
7. Destructive actions ask once in `ConfirmDialog` (focus starts on Cancel), say what is lost, and say whether anything else is kept. Never delete something that is still in use: disable the action and say why, or block it on the server.

**Feedback**
8. Errors show next to the action that caused them, as an obvious alert (`role="alert"`), not as small text elsewhere on the page. Say what happened and what to do next.
9. Any button that talks to the server locks and shows a spinner (`.spinner`) until the answer arrives.
10. Empty, loading, full and failed states are designed, not left blank. A limit message tells people how to get back under it.
11. Motion is short and purposeful, and is off under `prefers-reduced-motion`.

**Content**
12. Plain words for non-technical users. Say who can see something when it is public (for example an uploaded image link).
13. Names and numbers wrap or truncate without breaking the layout. Test a long name and a tie.

**Proof**
14. Every UI change ships with a Playwright flow and desktop plus 390px screenshots. When the design direction is open, mock two options and let the owner choose before building.

The image picker (`ImageUploadField.vue` and `ImagePickerDialog.vue`) is the reference for these rules: one fixed-ratio tile, a dialog for choosing, icon actions with accessible names, and an alert inside the dialog for errors.

## Checking a change

Run the app (`npm run dev:memory` in `server/` with the client built), then compare the landing, dashboard, editor, presenter and audience views in both modes before and after your change.

## Landing demos and product captures

- Keep product demos explicitly labelled as sample-only and separate from joining. No fictitious live room, join code, audience count or automatic votes. Counts must add up.
- The landing poll, word cloud and quiz use `client/src/landing/demo.ts` for their sample data and answer rules. Components hold only ephemeral UI state. Switching question type and Reset demo clear the visitor's answer and presenter controls.
- Demo choices are native buttons with pressed states, visible focus and at least 44px hit targets. Quiz choices can change until reveal, matching the real app; reveal locks them until reset. Closing voting disables the phone; hiding results does not disable voting. Keep status feedback outside the stage so it remains available when results are hidden.
- Use paired stage/phone composition where both remain readable; stack on very narrow phones. A phone hero must get to the interactive proof before long explanatory sections.
- Product screenshots are real seeded local app captures, not decorative grey-bar mockups or private user decks. Captions explain the task. Images have descriptive alt text, fixed aspect ratio and a full-size link for phone readers. The screenshots are light-mode Candy even when the surrounding page is dark; preserve the actual product pixels.

## First-use feedback and keyboard behavior

- Editor dirty state compares the current snapshot with the last loaded/saved snapshot. Show saved or unsaved feedback on phone and desktop; successful Save must not trigger a leave warning.
- New presentation uses a modal dialog with focus containment, return to opener, and roving arrow-key radio selection.
- Landing and standalone join use the same join helper; the hero joins once and shows busy/errors beside the form.
- Ended audience screens show the terminal message and any final leaderboard, never active answer controls or waiting-for-results copy.
- Put real product proof directly after the demo. Phone editor proof is a crop of the actual editor capture with an explicit full-editor link; steps and types stay compact.
- Session-enabled dashboards make fresh sessions primary and explain new-code/blank-answer versus existing-code/kept-answer behavior in visible text.
