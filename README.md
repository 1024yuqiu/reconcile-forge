# Reconcile for Jira & Confluence

Compare attached AP ledgers, bank exports, inventory lists or operational records by key, then turn exceptions into Jira work. The application is a new Forge project; its pure comparison engine is ported from the owner's read-only browser tool. No marketing text or UI from that tool is reused.

Production 2.0.0 is deployed and installed for Jira and Confluence; Forge reports Runs on Atlassian eligibility. Development 3.2.0 remains installed. A real Jira Cloud server-side comparison passed with the synthetic sample data below. Live browser panel rendering, first-run user consent, Rovo conversation, real exception creation and full Confluence reconciliation remain unverified. See [JUDGE-INSTALL.md](JUDGE-INSTALL.md) for the judge workflow. Distribution sharing and public video upload are pending; nothing has been submitted or published.

## Run locally

Use a supported Node LTS release. The locked Forge CLI requires Node `^22.23.4 || ^24.22.1 || >=26.12.1`; Node 24.21.0 can run the preview but is below the CLI's declared minimum.

```powershell
cd app
npm ci
npm test
npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. The preview explicitly says **LOCAL PREVIEW · SYNTHETIC DATA**, replaces `@forge/bridge` at build resolution, and uses the same service and engine as the Forge app. It simulates attachment selection, templates, run history and issue creation. Template and history metadata are kept in browser localStorage. Preview-created issue identifiers are synthetic. The production build uses real `@forge/bridge`; it never falls back silently to mocks.

Choose the two synthetic attachments, inspect mapping and tolerances, then click **Run reconciliation**. Optional local uploads in preview accept XLSX and UTF-8/GBK CSV. Both sides must be local files when using uploads. Uploaded local runs are not persisted. `npm run samples` regenerates the original four fixtures under `samples/`. `node scripts/phase4-samples.js` regenerates the live-test-compatible `phase3-ledger.csv` and `phase3-bank.xlsx`, verifies parsed cells and counts, and copies them into the mock-only asset directory. Visit `http://127.0.0.1:4173/?phase4` to load these files through the real parser and shared service. Expected key counts: 270 matched, 18 mismatch, 10 only A, 10 only B, one duplicate group.

## Features

- Jira issue panel and Confluence macro, with attachment discovery and workbook worksheet selection.
- File A against file B or JQL as B. JQL produces `Issue key`, `Summary`, `Status`; map matching export columns explicitly and turn off amount/date comparison when those fields are absent.
- Header and key suggestions, multi-column composite keys, paired amount/date mappings and optional additional text comparisons.
- Inclusive absolute / percentage amount tolerances, date tolerance in calendar days, trim/case/full-width normalization.
- Matched, value mismatch, only A, only B and duplicate-key categories; search, filter, pagination and highlighted amount/field changes.
- XLSX export includes complete results, selected rules and all duplicate source rows. It is independent of the active filters. Cell strings are written as values, never interpreted as spreadsheet formulas.
- Saved project/space templates and last 20 run summaries per source issue/page, attributed to the invoking account.
- Exception issues or sub-tasks in a chosen project/type, one per exception or grouped. Creation has a separate review/confirmation step and a maximum of 20 per request.
- Rovo Reconciliation Assistant with actual run, explain and create handlers. The current Forge module is `action`, not `rovo:action`.

## Install on Atlassian

Use the production sharing link once the owner has enabled it: see JUDGE-INSTALL.md (currently TBD). Jira is required; connect optional Confluence on the same site to test the macro. The manifest contains the registered public Forge app ID, not a credential. Source users deploying a separate app must register their own app identity with Forge. Build the UI, run Forge lint, deploy, then install Jira and connect Confluence if needed. Marketplace publication is not planned.

## Scopes

| Scope | Reason |
| --- | --- |
| `read:jira-work` | Read source issue/project and attachment metadata/content, JQL result rows, and existing exception issues for deduplication. |
| `write:jira-work` | Create user-confirmed exception issues or sub-tasks. |
| `read:attachment:confluence` | List and download page attachments. |
| `read:page:confluence` | Verify access to the current page and derive its space for templates. |
| `storage:app` | Persist run summaries, compact exception evidence, templates and dedupe references in Forge KVS. |

All product requests use `api.asUser()`: app scopes never override the current user's product permissions. Backend resolvers derive the source from Forge context, re-fetch the source's attachments and reject arbitrary attachment IDs. Stored runs are readable only from their original source after a fresh user permission check. Templates are shared by project/space; run history is shared with users who can access its source. Only administrators should grant access to sensitive source pages/issues.

There is no `permissions.external`, remote backend, analytics service or external AI endpoint. The bundle uses Atlassian design-token CSS variables with neutral/green fallback styling. Inline styles are permitted for the host's theme integration. The browser receives transient comparison results for display/export. No source workbook is persisted to KVS; compact exception evidence is stored there. Preview data stays in its local browser.

## Architecture

```text
Jira issue panel / Confluence macro (React Custom UI)
  -> @forge/bridge invoke -> src/index.js (Forge Resolver, asUser product APIs)
  -> src/service.js (source authorization, templates, runs, issue creation)
  -> src/files.js (Papa Parse + ExcelJS) -> src/reconcile.js (pure engine)
  -> @forge/kvs (bounded metadata and exception evidence)

Rovo agent -> action handlers -> same service / engine
Local preview -> mock bridge -> same service / engine
Preview local uploads -> Web Worker comparison -> XLSX export
```

`src/reconcile.js` retains integer-cents amount parsing and validated calendar-day date handling from the reference. Unique keys are indexed in a Map, giving linear grouping/comparison. Composite keys are serialized arrays, preventing delimiter collisions. Any repeated key on either side becomes one duplicate-key group, never an arbitrary financial match. Key counts therefore differ from source row counts. Amount tolerance is `max(absolute cents, abs(A cents) * percentage / 100)`. Values with more than two decimal places are rejected. No FX conversion is implied.

Date disagreements beyond tolerance are **value mismatches**. The old engine treated them as unmatched rows. This is an intentional product change so cell-level date differences are visible. The old engine also paired duplicate records greedily; this app flags all such groups for review. No other reference file was modified.

## Limits and operational boundaries

- Pure engine: 1–50,000 rows per table. XLSX: maximum 100 columns and 20 preamble/header rows; first worksheet by default. Header detection examines the first 20 rows and reports the detected source row. If the guessed header is incorrect, clean the export before attaching it. Encrypted XLSX and legacy XLS are unsupported. Formulas use cached values, not recalculation.
- Attached files: 2 MB compressed bytes each; local preview uploads: 8 MB. XLSX decompression can amplify memory use; very wide or highly compressed files may still exceed Forge runtime memory/time. Split exports when a limit is hit. 50,000 rows are engine-tested, not a promise every 50,000-row workbook fits a resolver.
- Custom UI bridge results: 3 MB safety limit. Larger results fail explicitly and request splitting; they are never silently truncated. The run summary may already be saved when the bridge size guard fails.
- JQL: paginated, maximum 5,000 issues, key/summary/status only. Narrow larger queries. Confluence attachment discovery: paginated, maximum 1,000 attachments.
- Full results are transient. Save at most the first 200 compact exceptions (difference text up to 2,000 characters each) and 20 run summaries per source. Individual run KVS records are guarded below 180,000 UTF-8 bytes. Template limit: 20 per project/space. Grouped issue descriptions are compact and may truncate; attach/export the XLSX for full audit evidence.
- Issue creation needs valid project-specific issue type IDs and any configured required fields. The app sends summary, description and labels, plus optional parent; projects requiring additional fields will reject creation with a clear API error. Subsequent requests can retry completed rows safely through stored references.
- Deduplication uses stable source/rules/key/content/target labels and Forge KVS references across reruns. It prevents ordinary serial retries, including search-index lag after a recorded creation. Concurrent calls or a crash between Jira creation and KVS recording can still duplicate issues. Serialize creation in the demo; transactional/concurrency hardening remains future work.
- No scheduled trigger is included; manual runs avoid unattended costs. Rovo uses compact evidence and cannot invent mismatch causes. Create actions require conversational user confirmation under the agent prompt and the `CREATE` action verb; there is no autonomous scheduled creation.
- Offline mocks cannot validate actual product contexts, downloads/redirects, tenant permissions, Jira required fields, Rovo confirmation behavior, KVS quotas or distribution eligibility. These require separate live checks; the recorded server-side test does not prove the browser or agent flows.

## Dependencies and provenance

ExcelJS (MIT) and Papa Parse (MIT) handle files; SheetJS is not used. `package-lock.json` pins resolved packages. [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) records direct/transitive notices and development tools; regenerate with `npm run licenses`. Reference source: `E:\夏楚铮\作品集\B-工具\src\reconcile.js`, `files.js`, `main.jsx`, read only. No reference tree writes are made.

**License gate passed:** 1,155 locked packages, zero UNKNOWN licenses and zero non-allowlisted exceptions. The ExcelJS unzipper override and explicitly pinned optional bundling dependency are explained in [LICENSING-REVIEW.md](LICENSING-REVIEW.md). See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for required notices. No project LICENSE has been chosen; the owner must decide before source publication.

## Official references

- [Jira issue panel](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-issue-panel/)
- [Confluence macro](https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/)
- [Rovo agent](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/) and [action, inputs and context](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/)
- [App compatibility and installation](https://developer.atlassian.com/platform/forge/app-compatibility/)
- [Forge platform limits](https://developer.atlassian.com/platform/forge/platform-quotas-and-limits/)
- [Jira attachment API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/)
- [Confluence attachment API](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/)
- [Forge KVS](https://developer.atlassian.com/platform/forge/storage-reference/)

Codegeist 2026 materials are prepared in English; the selected category is Apps for Business Teams and the proposed bonus is Best Agents (Rovo), pending live conversation verification. Contest rules and distribution documentation were checked November 10, 2026. Source publication is optional; this package has no remote or chosen project license. Do not interpret dependency notices as a license grant for the project itself.
