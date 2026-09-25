# Type Skill — Bug fix / Hotfix

Applies on top of the base skill when the PR fixes a defect (bug ticket, `fix/` or `hotfix/`
branch, reopened ticket). Output format, severity and signals are the base skill's.
The question for a fix is not "is the new code nice" but **"is the bug really gone, and did
anything else break?"**

## 1. Reconstruct the bug before judging the fix

From the ticket, commits and diff, state to yourself in one line each:
- **Symptom** — what the user saw.
- **Cause** — the line or condition that produced it. If you cannot point to it in the diff,
  say in `labelRationale` that the root cause is not evident.
- **Fix** — what the diff changes about that condition.

## 2. Checklist

### Cause vs symptom
- Does the change fix the **cause**, or hide the symptom? Red flags:
  - a new `try/catch` or `?.` that makes the error disappear without handling it;
  - a null guard that skips bad data instead of preventing it from being created;
  - a special case for the one input in the ticket (`if (id === 1234)`), or a UI-only fix for a
    server-side problem.
  → symptom-only fix is `[major]` (`[blocker]` if bad data keeps being written).
- The same faulty pattern in **sibling code**: other callers of the same function, the twin
  endpoint (create vs update), the other screen with the same form, the export of the same list.
  Found in the diff and not fixed → report all locations in one item. Likely outside the diff →
  "(verify)".

### Regression risk
- Behaviour for the **normal case** unchanged? Watch changed defaults, changed comparison
  operators, reordered conditions, changed return shapes.
- Fix inside a shared helper → every caller now gets the new behaviour; is that intended?
  (`[major]` if callers visibly depend on the old behaviour.)
- Error handling changed so a previously visible error is now swallowed.

### Proof
- A test that **fails before the fix and passes after** (reproduces the ticket's input).
  Missing for a logic bug → `[major]` `tests-missing`; for a trivial copy/config fix → skip.
- No test possible → reproduction and verification steps described in the PR or ticket.
- Reopened ticket: what did the previous attempt miss, and does this diff address that
  specifically?

### Data already damaged
- Did the bug write wrong data? Then the fix also needs a repair script/migration or a stated
  plan. Missing and not mentioned → `[major]` "(verify)" if you cannot tell.

### Hotfix discipline
- Minimal diff: no unrelated refactors, renames or formatting in a hotfix → `bloated-scope`,
  `[minor]` (or `[major]` if the extra change is risky).
- Diagnostic logs added for the investigation are removed or at the right level, and log no
  personal data or secrets.

## 3. Severity calibration for fixes

| Situation | Severity |
| --- | --- |
| Fix introduces a visible regression or keeps writing bad data | `[blocker]` |
| Cause not addressed (symptom hidden) | `[major]` |
| Same bug left in a sibling path visible in the diff | `[major]` |
| No reproduction test for a logic bug | `[major]` |
| Damaged data not handled or mentioned | `[major]` (verify) |
| Unrelated changes in a hotfix | `[minor]` |

## 4. Labels for fixes

- `ticketComplexity`: judge the **cause** — a one-line fix to a race condition or money rounding
  is `high`; a typo is `low`.
- `codeCompleteness` is at most `adequate` without a reproduction test or described verification.

## 5. Examples

- `[major] src/services/order.js:58 — Symptom hidden: catch returns [] instead of fixing null customerId → validate customerId on create`
- `[major] src/routes/order.js:40, src/routes/orderAdmin.js:22 — Same bug in sibling: date filter still exclusive → use <= end of day in both`
- `[major] tests/ — No reproduction test: add a case with discount 0 that failed before the fix`
