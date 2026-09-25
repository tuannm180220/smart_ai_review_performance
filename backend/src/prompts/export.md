# Type Skill — Export / Report (Excel, CSV, PDF, downloads)

Applies on top of the base skill when the PR generates or changes a downloadable file: Excel,
CSV, PDF, printable report, bulk download. Output format, severity and signals are the base
skill's.

## 1. First, write down the export contract

Before checking code, reconstruct from the ticket (and existing code in the diff) what the file
must be. Every mismatch below is judged against this contract:

| Part | Questions |
| --- | --- |
| Trigger & access | Which screen/button? Which roles may export? Any column visible only to some roles? |
| Rows | Exactly the rows of the current search/filter? Row cap? What if 0 rows? |
| Order | Sort order of rows (and tie-breaker)? |
| Columns | List, order, header labels, sheet name(s)? |
| Per column | Source field/table, format (date, number, currency, boolean label), joins/concatenation, code → label mapping |
| File | Name pattern (date stamp, screen name), format, encoding |
| Volume | Expected max rows; sync download or background job? |

If the ticket does not define a part, do not invent it — check consistency with existing exports
in the diff and mark gaps "(verify)".

## 2. Checklist

### Rows and filters
- Export reuses the **same query/filter builder** as the screen. A second hand-written query that
  drifts from the screen's filters → `[major]` (users get different rows from what they see).
- Pagination is not accidentally applied (exporting only page 1) → `[blocker]`.
- Soft-deleted rows excluded, the same way the screen does.
- Tenant/user scope applied → missing is `[blocker]` `security-risk`.

### Columns and values
- Column order and header labels match the contract; labels come from i18n if the app is
  multilingual.
- `null`/`undefined` → empty cell, never the text "null", "undefined" or "NaN".
- Numbers written as numbers (so Excel can sum), not strings; money with the agreed decimals.
- Codes, phone numbers, postal codes, ids with **leading zeros** written as text.
- Dates/times: agreed format and **time zone** (server UTC vs user local) — a classic bug.
- Booleans and enums mapped to human labels, not `true`/`1`/`STATUS_A`.
- Joined/master data: which name is shown if the master was renamed or soft-deleted?
- Multi-value fields: agreed separator; long text not silently truncated (Excel cell limit 32,767).
- Column-level permission: restricted columns removed or masked for roles that cannot see them.

### CSV specifics
- Values containing comma, quote or newline are quoted and quotes doubled.
- **CSV/formula injection**: cells starting with `=`, `+`, `-`, `@`, tab or CR from user data are
  escaped (e.g. prefix `'`) → missing is `[major]` `security-risk`.
- Encoding: UTF-8 **with BOM** (or the agreed Shift_JIS etc.) when users open it in Excel with
  non-ASCII text; line endings as agreed.

### File delivery
- File name follows the pattern; unsafe characters removed; non-ASCII names sent with
  `Content-Disposition: attachment; filename*=UTF-8''…`.
- Correct `Content-Type`; no caching of personal data (`Cache-Control: no-store` where relevant).
- Errors during generation return an error, not a half-written or empty file with 200.

### Volume and performance
- Rows fetched in one query or in chunks — not one query per row (N+1 when mapping masters).
- Large exports stream or run as a job instead of building the whole workbook in memory.
- Row cap / confirmation for big exports if the product requires it; request timeout considered.
- Front end: button disabled while generating; no double download; progress or message for long runs.

### Tests expected for an export
At least one test on the row → cell mapping covering an edge value (null, date/time zone,
leading zero, number vs string). No test and no sample file described → `[major]` `tests-missing`.

## 3. Severity calibration for exports

| Situation | Severity |
| --- | --- |
| Rows not scoped to tenant/user, or restricted columns exported to the wrong role | `[blocker]` |
| Only the current page exported / filters ignored | `[blocker]` |
| Export query drifts from screen filters | `[major]` |
| Time zone or number/text type wrong in a column users rely on | `[major]` |
| CSV injection not escaped | `[major]` |
| "null"/"undefined" in cells, wrong header label, wrong file-name pattern | `[minor]` (major if the ticket specifies it) |
| Whole file built in memory for small, capped exports | not an improvement |

## 4. Examples

- `[blocker] src/services/memberExport.js:40 — Filters ignored: export queries all members, not the current search → reuse buildMemberQuery(filters)`
- `[major] src/services/memberExport.js:72 — Time zone: joinedAt written in UTC, screen shows JST → format with user tz`
- `[major] src/lib/csv.js:15 — CSV injection: user text starting with "=" not escaped → prefix with "'"`
