# REVIEW.md — review guidance for bagarre

Distilled from human replies to fouine's comments. These are review behaviours, not repo facts.

## Reductions are welcome — but always as nits
- The findings the author reliably applies are reductions: deleting dead code, collapsing duplicated helpers, dropping redundant defaults/constants, shortening the diff. Keep hunting this class, and say exactly what to delete and what (if anything) replaces it.
- Prose that contradicts the code belongs to this class too: a doc block attached to the wrong declaration, a stale count or name, user-facing copy whose grammar breaks when a value changes, and a PR-description claim that overstates what the code does. These are cheap, reliably applied, and still nits — the fix is sometimes the description rather than the code, and the author may deliberately correct it there and leave the code alone.
- A client re-implementing an authoritative server computation (hit test, validation) only to decide a cosmetic cue — a sound or effect the author already admits misfires — is a reduction target. Suggest the one-line unconditional cue (play it always, let the real outcome's sound carry it) instead of the copy; extra imports and gathering to feed a cue are the giveaway.
- A new guard, limiter, cap, or re-check that an existing bound already makes unreachable is a reduction target: propose deleting the guard rather than repairing its keying or condition, and name the bound that makes the guarded case impossible (a decision cadence cap, an in-flight limit, a spend budget). One PR added a per-bot rate limiter keyed on a room-local id; the author deleted it wholesale on the argument that the cadence and budget already covered it.
- Never block on one. A shorter diff is not a correctness, security, or data-loss problem.

## Reuse before suggesting something new
- Before proposing a new helper, formatter, constant, type, or test fixture/harness, search the repo for an existing one. If it exists, point at it by file:line and say to import it instead of retyping it.
- When a new spec copies helpers verbatim from a sibling spec, point at the shared fixtures module that already hosts such helpers and say to move them there and import in both. This is applied reliably.

## New members of a tagged union
- When a PR adds a member to a kind/string enum/union, audit every switch, lookup map and renderer that branches on the old members before approving. Client-side renderers are where a missed branch hides, because tests usually assert the data, not the drawing: a new floor/loot kind silently falling through to an existing renderer is a real gap.
- Keep the ask targeted — name the consumer to extend and its current fallthrough behaviour. Do not turn it into a request to refactor the union.

## Parallel branches and copied expressions
- When a block repeats a formula per axis, team, or side, check each variant's indices, bounds and signs instead of trusting the copy. A literal copied from the neighbouring line with one operand swapped reads as intentional but is a real bug; report it as a defect, not a style nit. The author fixed one in a bench and called it "a copy slip".

## Dead code vs deliberate code
- Dead-code shapes that recur: exports/imports with no importer; fields, counters, or per-frame values computed but never read; named constants that encode nothing; teardown/dispose methods with no caller; routes/handlers with no product caller; fallbacks for a branch the types say cannot happen.
- "No production reader" is not "no reader". If the only consumers are tests or checks, weigh the rewrite: a field read by a dozen assertions usually costs more to remove than to keep. Check the tests before flagging.
- A single-member union/switch, or a field that only restates a value, can be a deliberate seam for a planned or stacked follow-up. Ask whether one is coming; if the author names it and explains the seam, accept it and stop re-raising.
- Write-only observability fields (stats counters, latency, totals) are the same: on a PR stacked behind others the author may defer removal to a follow-up rather than churn the branch. If they name the follow-up or skip the nit, accept it and do not re-raise.
- Locate a claimed duplicate before flagging it. Do not assert that a constant is "written out again" unless you have found the second definition in the checkout; a doc-comment rewrite is not a duplicate.
- "No reader" and "unreachable under today's call graph" are different claims. Before flagging, check whether the branch documents a domain rule or guards the PR's stated invariant. Ask whether it is deliberate; if the author explains it is (a rule pinned by a check, belt-and-suspenders for the PR's invariant), accept it and stop re-flagging it on later passes.
- For routes/handlers with no product caller, ask whether one is planned rather than assuming it, and suggest the smaller alternative (e.g. reading data directly) if not.

## Defaults that read ambient env/config
- When a PR makes a default dispatch through env or config, audit existing tests and call sites that rely on that default and ask whether they should pin the concrete value. A test that passes locally with no key but spends against a real API once the key is exported is a real failure, not a hypothetical: the author here agreed the coupling was not intended and pinned the tests explicitly.

## Style vs defect
- A parameter-removal suggestion is a style call, not dead code, when the value already has a single source and callers supply it by design. Make the case once; if the author declines with a coherent rationale, drop it.
- An author may explicitly end the nit loop after a few rounds. Honour it: stop re-raising style-only points, and don't treat a declined nit as unresolved. A `/fouine skip nits` approval is such a declaration: the listed non-blocking findings are settled, not pending.

## Severity discipline on races and guards
- Only call a race/ordering/leak issue blocking when you can name the concrete, reachable path that triggers it. If it depends on an assumed state, or is really defense-in-depth, say so and file it as a nit or question.
- One blocking finding here assumed a code path that did not exist; the author traced it and called it "a guard, not the fix for a live bug". When an author pushes back with a concrete trace, verify it and accept it rather than re-raising.

## Ask, don't assume, about enforcement
- For changes whose point is measurement, validation, or balance, ask whether the new check is wired into CI instead of assuming it is. In one thread the honest answer was "not deliberate", and the check was gated.

## Re-review behaviour
- On a re-review, re-derive the changed area rather than ticking off the old list, and explicitly reconcile every prior finding — resolved, or accepted as an author correction. Do not re-raise a finding the author has already declined.
