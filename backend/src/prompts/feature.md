# Type Skill — Feature (screens, forms, lists, CRUD APIs)

Applies on top of the base skill when the PR adds or changes user-facing behaviour: a screen,
form, list/search, detail view, or the API endpoints behind them. Output format, severity and
signals are the base skill's.

## 1. Review it as a user journey

Walk the change in the order a user meets it, and at each stop ask what happens on the unhappy
path:

1. **Entry** — route/menu/link: who can reach it? Is the page guarded in the UI **and** is every
   API it calls guarded on the server with the same role?
2. **Load** — data fetch: loading state, empty state, error state, not-found / deleted record,
   record belonging to another tenant/user.
3. **Input** — each field: required, type, length, format, allowed values. Are the **same rules**
   enforced on the server? Trimming? Full-width vs half-width characters where relevant?
4. **Submit** — button disabled/loading while pending (no double submit); Enter key behaviour;
   server validation errors mapped back to the right field.
5. **Persist** — create vs update paths both correct; empty input stored the way the codebase
   stores it (NULL vs ""); multi-table writes in one transaction; audit/operation log written
   only after the write succeeds.
6. **Result** — success message, redirect, list refresh or cache invalidation, focus.
7. **Other modes** — create vs edit vs read-only; roles that may view but not edit; two users
   (or two tabs) editing the same record — last write silently wins? Is there a lock or version
   check where the codebase uses one?

## 2. Checklist

### Access control
- New endpoint without a server-side role/permission check → `[blocker]` `security-risk`.
- UI guard missing while the API is guarded → `[major]` (users reach a screen they cannot use).
- Ids taken from the URL/body used without checking ownership (IDOR) → `[blocker]`.
- Response includes fields the current role must not see (salary, personal data, internal notes).

### Validation
- Rule exists only in the frontend → `[major]`.
- Frontend and backend limits differ (e.g. max 50 vs max 100) → `[major]`.
- Error messages: from the project's message system / i18n keys in every language, not literals.
- Dates: format, time zone, "to" date inclusive of the whole day.

### List and search
- Match type per field as the ticket says: partial vs exact, case sensitivity, AND vs OR.
- Default sort defined and stable (tie-breaker on id) so pages do not shuffle.
- Pagination: total count correct after filters; page reset when filters change; server caps
  page size.
- Search conditions / sort kept when returning from detail, if the rest of the app does that.
- Empty result: message shown; actions that need rows (export, bulk delete) hidden or disabled.
- Filters applied on the server, not by fetching everything and filtering in the browser.

### Create / edit / delete
- Delete: soft vs hard as the codebase does; children and references handled; confirmation.
- Edit loads fresh data by id (not stale list data) before showing the form.
- Unique constraints (e.g. code, email) checked on the server with a clear error, not a 500.

### API shape
- Status codes and error body consistent with existing endpoints.
- No over-fetching: list endpoints do not return large or sensitive fields they do not need.
- Query/body params validated and typed; unknown sort fields rejected (no SQL built from them).

### UI state and quality
- Loading, disabled, empty, error states for every async action.
- Labels and messages in all supported languages; no raw i18n keys.
- Design tokens / shared components used instead of hard-coded colours and sizes, where they exist.
- Accessible basics: labels bound to inputs, buttons are buttons, keyboard works for new forms.

### Tests expected for a feature
At least: one happy path, one validation rejection, one permission-denied case for new
endpoints. Missing all three on non-trivial logic → `[major]` `tests-missing`.

## 3. Severity calibration for features

| Situation | Severity |
| --- | --- |
| Missing server permission check / IDOR / sensitive field exposed | `[blocker]` |
| Required acceptance point (a field, a filter, a button) missing | `[blocker]` + `partial-ticket` |
| Validation only on the client, or client/server rules differ | `[major]` |
| No double-submit guard on a create/update/delete button | `[major]` |
| Filter/sort done in the browser on unbounded data | `[major]` |
| Missing empty/error state, missing i18n entry | `[minor]` (major if users see raw keys or a blank page) |
| Hard-coded style where tokens exist | `[minor]` |

## 4. Examples

- `[blocker] src/routes/members.js:31 — Missing permission check: DELETE /members/:id has no role guard → add requireRole('admin')`
- `[major] web/pages/MemberForm.jsx:77, api/validators/member.js:12 — Validation mismatch: name max 50 in UI, 100 in API → align both to spec`
- `[major] web/pages/MemberForm.jsx:120 — Double submit: Save stays enabled while pending → disable on isPending`
