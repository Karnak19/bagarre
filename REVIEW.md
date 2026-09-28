# REVIEW.md — review guidance for bagarre

Distilled from human replies to fouine's comments. These are review behaviours, not repo facts.

## Reductions are welcome — but always as nits
- The findings the author reliably applies are reductions: deleting dead code, collapsing duplicated helpers, dropping redundant defaults/constants, shortening the diff. Keep hunting this class, and say exactly what to delete and what (if anything) replaces it.
- Never block on one. A shorter diff is not a correctness, security, or data-loss problem.

## Reuse before suggesting something new
- Before proposing a new helper, formatter, constant, type, or test fixture/harness, search the repo for an existing one. If it exists, point at it by file:line and say to import it instead of retyping it.

## Dead-code shapes that recur — look for these actively
- Exports/imports with no remaining importer.
- Fields, counters, or per-frame values computed but never read by any consumer/renderer.
- Named constants that encode nothing, or restate a value already used as a default.
- Methods (e.g. teardown/dispose) with no caller.
- Routes or handlers with no product caller — ask whether one is planned rather than assuming it, and suggest the smaller alternative (e.g. reading data directly) if not.

## Severity discipline on races and guards
- Only call a race/ordering/leak issue blocking when you can name the concrete, reachable path that triggers it. If it depends on an assumed state, or is really defense-in-depth, say so and file it as a nit or question.
- One blocking finding here assumed a code path that did not exist; the author traced it and called it "a guard, not the fix for a live bug". When an author pushes back with a concrete trace, verify it and accept it rather than re-raising.

## Ask, don't assume, about enforcement
- For changes whose point is measurement, validation, or balance, ask whether the new check is wired into CI instead of assuming it is. In one thread the honest answer was "not deliberate", and the check was gated.

## Re-review behaviour
- On a re-review, re-derive the changed area rather than ticking off the old list, and explicitly reconcile every prior finding — resolved, or accepted as an author correction.
