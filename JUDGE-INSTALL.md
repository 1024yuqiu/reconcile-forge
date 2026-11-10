# Reconcile — judge installation and test guide

Installation link: **TBD — owner must enable Sharing in the Developer Console and paste the generated production link here.** No judge installation link has been generated yet. The app ID is not an installation link.

## Install and authorize

1. A site administrator opens the production installation link, chooses their Atlassian Cloud site, reviews the requested scopes, and installs Reconcile. Jira is required. Confluence is optional in the manifest; connect it on the same site if testing the macro. If the distribution screen requires both products, use a site with both and install/connect both. The owner must verify this final distribution configuration before sending the link.
2. Scopes are `read:jira-work`, `write:jira-work`, `read:attachment:confluence`, `read:page:confluence`, and `storage:app`. No external-service account or API key is required. No remote backend is configured.
3. The invoking user needs permission to read the source issue/page and its attachments. Exception creation also needs Create Issues in the chosen Jira project and a valid project-specific issue type ID. Open the app and complete any first-run Atlassian user consent prompt; production requests use `api.asUser()` and cannot exceed the user's permissions. Browser consent has not yet been verified live.
4. On a Jira issue, use the issue's Apps/action area to open the **Reconcile** panel. On a saved Confluence page, attach the files, edit the page, insert the **Reconcile** macro, publish, then open it. Jira remains required even for the optional Confluence connection.

## Reproduce the synthetic comparison

Use the supplied source package: `samples/phase3-ledger.csv` (A) and `samples/phase3-bank.xlsx` (B). Both have 300 synthetic rows. Attach both to the same Jira issue (or saved Confluence page), then open Reconcile. Select A and B and click **Load selected sources**. The XLSX sheet is **Transactions**.

Review suggested mappings: key **Order ID**, amount **Amount**, date **Date** on both sides. Leave Other fields empty; amount tolerance **0.01**, percentage **0**, date tolerance **1 day**. Keep trim, ignore case and full-width normalization enabled. Save a named project/space template, then click **Run reconciliation**.

| Category (unique keys) | Expected |
| --- | ---: |
| Matched | 270 |
| Value mismatch | 18 |
| Only in A | 10 |
| Only in B | 10 |
| Duplicate keys | 1 |

Filter to Value mismatch and search `AP-0001`: one row, amounts 125.00 and 137.50, with differing cells highlighted. Clear search and inspect Only in A, Only in B and Duplicate keys. Export XLSX; its Summary, Results and Duplicate rows sheets include the full comparison regardless of the current filter.

For issue creation, use a test project, obtain an issue type ID valid for that project (ask its administrator), enter the target and type, then **Review issue creation → Confirm creation**. This makes real Jira issues when installed. An optional parent must be a valid key for sub-tasks. Projects with additional required fields may reject this minimal payload. Rerun the same inputs with unchanged rules/target and repeat confirmation: ordinary serial retries reuse stored references. View **Run history** for the two summaries. Do not run concurrent creation requests; atomic deduplication across concurrent calls is not guaranteed.

## Try the Rovo agent (only on a Rovo-enabled site)

Find **Reconciliation Assistant** in Rovo's agent picker. Open the source issue, then ask it to reconcile two attachments using your saved template. Supply the actual issue key, attachment IDs and exact template name. Ask it to explain the returned run's exceptions. For creation, remain in the original issue/page context, specify run ID, target project and issue type ID, review its summary, and explicitly confirm. The three manifest actions run the shared service: reconcile attachments, explain stored exceptions, and create exception issues. A live Rovo conversation has not been verified; this section is a test procedure, not a successful-conversation claim. If Rovo is unavailable, the issue panel workflow remains the primary test.

## Limits and troubleshooting (from source)

- CSV and XLSX only; UTF-8 and GBK/GB18030 CSV. XLSX formulas use cached results, not recalculation. First worksheet by default; select another if available. Header inference examines the first 20 rows; fix ambiguous headers before attaching.
- 2 MiB per attached file; parser/local preview uploads allow 8 MiB. Engine: 1–50,000 rows per table. XLSX: no more than 100 columns or 50,000 rows plus 20 header-area rows. Engine capacity does not guarantee every large workbook fits Forge memory/time.
- Bridge response safety cap: 3 MiB. Split exports if it fails; a summary may already have been saved. Run record safety cap: 180,000 UTF-8 bytes.
- JQL source: at most 5,000 issues, with Issue key, Summary and Status. Confluence discovery: at most 1,000 attachments. Narrow/split when exceeded.
- History: last 20 summaries per issue/page; at most 200 compact exceptions retained per run, difference text up to 2,000 characters. Full rows are transient. Templates: 20 per project/space, names 1–80 characters, small payloads up to 16,000 serialized characters.
- Create at most 20 exception issues per request, or one grouped issue. Grouped descriptions are compact and may truncate; keep the exported workbook as full evidence.
- Templates are shared within their project/space; source history is visible to users with access to its issue/page. Do not use sensitive attachments on broadly accessible sources.
- Local preview uses synthetic product responses and browser storage. It is explicitly labeled. Real Jira server-side comparison passed on the same sample data; live panel rendering, live exception creation, live Rovo interaction and full Confluence reconciliation remain unverified.

## Owner: obtain the link before inviting judges

Developer Console → Reconcile → Distribution → Distribution controls → Edit → Sharing (for judges outside the owner's organization) → fill required app details → Save changes → review Atlassian app selection → copy installation link. Validate installation on a judge-like site, then replace TBD above and in SUBMISSION.md. See [Atlassian's distribution instructions](https://developer.atlassian.com/platform/forge/distribute-your-apps/#start-sharing-your-app).
