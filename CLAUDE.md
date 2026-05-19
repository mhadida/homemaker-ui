@AGENTS.md

## Project Context
- This is a beta project with active beta testers (as of March 2026). Data-preserving migrations are required — don't assume the DB is empty. Still don't over-engineer, but do handle existing data in schema changes.
- The codebase has massive amounts of dead code and bloat from previous LLMs (not Claude). They kept adding code on top of code to solve problems instead of fixing the root cause. Always prefer deleting and simplifying over adding.

## Deletion Policy
- **Never delete code, files, components, types, DB columns, or any artifact without explicit user confirmation.** When you spot bloat (unused imports, dead components, redundant state, unnecessary abstractions), flag it clearly and ask before removing.
- When removing frontend code (types, UI, state), always cross-check the DB schema for matching dead columns. Previous LLMs often added TypeScript fields that were never migrated, or migrated columns that are no longer used. Flag both and get approval before cleanup.
- Present deletions as a clear list of what will be removed and why, so the user can make an informed decision.

## Design Rules (applies to any frontend work)
- **No colored edge stripes on boxes, cards, panels, or alerts.** The `border-l-4 border-l-amber-700` / `border-t-4 border-t-red-500` / any-directional colored edge accent pattern is forbidden. Generic AI-slop design cliché, universally hated. This applies across all projects.
  - Urgency / importance / status is conveyed via typography (larger, serif, bold), content (countdown, status text), or a badge — never an edge stripe.
  - Uniform borders (`border border-stone-200` or similar) are fine. Thin decorative hairlines (`border-t border-stone-300` as a rule between sections) are fine. *Colored* directional borders used as visual accent are not.
- **Use the project's typography tokens — don't invent inline `text-Nx + text-stone-N + font-X` combos.** If a project has a typography token system (look for `.type-*` classes in `globals.css` or a `typography-tokens.md` doc), use those names. Inventing one-off combos fragments the design system and creates 100-file sweeps every time something needs to change. If a token doesn't fit, ask the user before introducing inline styling.
