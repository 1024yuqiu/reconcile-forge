# Reconcile — installation and synthetic test guide

Installation link: https://developer.atlassian.com/console/install/297ff2c3-3390-4087-999d-f7b0507e1854?signature=AYABeFEeI0jKV%2Fg55BiMMlIb2e4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB8IR%2Fr4eCcFtjv84f46z3lQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDJEnRfbvYEyuAXePKgIBEIA7Uu8ui9sA7kWIbdibQfVEw1pF86ly7J%2FycGOB3oKIR17iEuP5ccWFAGy24Lj8VDM6%2BkLAXFrQurRQNIcAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHhlTS1%2FI6vlaZv%2B2dnwSiEAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMlsespPbwioQ7YLwZAgEQgDtatkNIwTfq8ZNd2JvxfgVqFDntP%2BhpKWkRZDXzCwpnJ0xKttfZJ6x8S4jN4gsRt2FTr8ax7qKyKhE6pQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAR5cs%2FECKKfdmkL5tsJ9AiIAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzR9WbeVQ1UBVEwZEgCARCAOwjqc2AB9av88qBTd9S%2BMR66%2FjUADlelxf82eP7E2vHGrWz4oAvnmEHi7cq%2B4GAKDB0LK84m08%2F28WjZAgAAAAAMAAAQAAAAAAAAAAAAAAAAABy2b3i%2BTufV5lK1NVWCYPj%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLZVhAHc5T8zOQRiTVCZgEXR7t4RtcF%2Ba3ziNE3TDx9ex%2Bf%2FOh1Jjs2Pk5Fc1Q2Oyv7m9Suw2dmfli0CRXW4RgUeAY%3D&product=jira&product=confluence

Judges install Reconcile with the production sharing link above. This repository contains application package **4.1.5**; the panel header reads **ATLASSIAN FORGE · v4.1.5**. Forge major/deployment numbers and the application package version are independent. The installation checks recorded for 4.1.3 on 2026-11-11 (production major 3, both existing installations Up-to-date, a brand-new Atlassian account and site installing through this link with no extra consent page or error, the three-table sample returning the five counts listed in step 4, the XLSX export with original layouts downloading) must be repeated after 4.1.5 is deployed. Jira is required; Confluence is optional on the same site. A site administrator reviews the scopes through the sharing link. No external-service account or API key is needed.

## 1. Three tables and confirmed column mapping

1. In an existing synthetic Jira test issue or saved Confluence test page, attach `examples/three-tables/ledger.csv`, `examples/three-tables/bank.xlsx` and `examples/three-tables/invoices.csv`. Open the **Reconcile** issue panel or macro.
2. The panel auto-selects sources only when it can tell them apart reliably: with these three file names it sets **A = ledger, B = bank, C = invoices** whatever the upload order. **An issue with other or additional attachments (several versions, other file names) is not auto-selected: confirm A / B / C by hand, with ledger as A.** The panel shows **Identifying attachments…** first. **Reset** repeats the same check, so the three sample files give A / B / C again. Then **Load selected sources**, check B's automatically selected **Transactions** worksheet, and enable **Ignore leading zeros in keys** and **Aggregate C**. The three-table sample needs both checkboxes; **Matched 0 usually means Ignore leading zeros in keys was not ticked.** The files have 6 / 6 / 7 rows, with headers on source row 3.
3. The three-table sample produces **High** confidence for every mapping proposal. Medium/Low examples are in **examples/mapping/** (Amount → Amuont: Medium; Date → Booking: Low). Inspect the proposals, choose any blank or incorrect columns, then click **Confirm column mapping**. Run and Save stay disabled until mapping is complete and confirmed. Changes to rules or columns require confirmation again; an existing saved template restores its confirmed mapping.
4. Click **Run reconciliation**. Expect **Matched 3 / Value mismatch 1 / Only in base 2 / Missing from base 2 / Duplicate keys 0**, as the panel labels them. Key 3 shows 300 versus 305 and its row reads **Δ 5**. Key 2 matches within the 0.01 tolerance, and Key 1 matches C's two rows summed. The combined residual **5.01** (5 plus the tolerated 0.01) appears only in the collapsible **Reconciliation statement & unreconciled items** section below the counts, as "Does not balance · residual 5.01".
5. Enable **Include original table layouts** and export XLSX. Expect ten sheets and eight result keys, with the differing bank amount coloured. Save a named template if you want reviews and Rovo to reuse these mappings. Editing its name and clicking **Save template** preserves the current result.

For a deliberate confidence example, attach `examples/mapping/` files and follow its README: Key High, Amount → Amuont Medium, Date → Booking Low. Choose Booking manually before confirming.

## 2. Unique amount combinations

Use `examples/combinations/` and its config. First compare 305.01 against 300.00: the difference remains 5.01. Switch to the split-invoices export, enable **Match unique amount combinations**, confirm the mapping and rerun: **300.00 + 5.01 = 305.01** matches with component keys and rows preserved. Ambiguous combinations remain unresolved; this is bounded search, not global allocation.

## 3. Domestic exports

Use the clean reference and UTF-8 / GBK / GB18030 files under `examples/domestic/`, following that folder's README. Confirm the key/amount/date mapping and rerun; all three synthetic rows match. The original quoted thousands separators, yuan amounts, Chinese dates and full-width values remain visible. Keep CSV thousands separators quoted.

## 4. Confirmed Jira creation and closure evidence

Use only an existing demo test project. Enter its project key and click **Load project issue types**, then choose a type from the dropdown. If loading is unavailable, use the numeric `issueTypes[].id` returned by `GET /rest/api/3/project/PROJECTKEY`; open this relative path on your own Jira site. A type name or project key is not an issue type ID. A sub-task also needs a valid parent key.

Select at most 20 exception checkboxes. After **Load project issue types** the **Type** dropdown preselects the type named Task (usually keep Task); if the project has no Task type it stays empty with a notice, so choose one. **Group selected exceptions** is enabled by default, matching Rovo. Click **Review issue creation**, verify selected keys/project/type/grouped mode, then explicitly **Confirm creation**. Repeat requests reuse existing matching references. Serialize requests; concurrent writes have no global atomic lock.

Follow `examples/closure/README.md`: save a named template, run the initial differing data, and explicitly create the selected grouped exception. Attach/select the corrected export, reuse the same template and rerun. Once every linked key matches, Forge re-reads the authorized source and adds one evidence comment to the app-created exception issue; **Ready to close** appears. Another balanced run adds no comment. Review and close manually; the app never changes issue status. Historical references are not bulk migrated; current label-based reuse is now enrolled in tracking.

`closure-base.csv`, `closure-open.csv`, `closure-third.csv` and `closure-fixed.csv` each contain only one data row. The panel shows “This sheet has almost no data rows — check the worksheet selection.” for each file. This warning is expected for these example files and can be ignored.

## 5. Audit trail and Confluence report

Add an optional **Run annotation** before running. The audit card shows actor accountId, content-based template version and annotation. **Load audit trail** displays event cards for run, reviews, explicit confirmation, creation/reuse and report receipts. A confirmation card names each selected exception as **Exception #<ID> (key <key>)**, for example `Selected exceptions: 1 · Exception #0 (key close-501)`. The ID is the exception's position (sequence number, counted from 0) in the run's result list, not the Jira key and not a count; older audit events without a stored key show `Exception IDs: #0`.

From Confluence, **Generate Confluence report** uses the source page's space. From Jira, open an existing accessible test page in the intended Confluence space; copy its numeric page ID from `/wiki/spaces/SPACEKEY/pages/PAGEID/...` into **Existing Confluence page ID in the report space**. This selects the destination space without editing that page. Generate creates a new report; **Open report** uses the API's web UI link. A repeated request for the same run/space reuses the report. Do not enter a space key or a full URL in the page-ID field.

## 6. Rovo grouped creation and reuse

Before you ask anything, **open the source issue page (for example KAN-5) in the browser and keep it open.** Rovo reads the open page's context; without it, fetching exception details fails with a system error.

The assistant does not appear in Rovo's **Change agent** list search. In the Rovo input box type **@Reconciliation Assistant** and select it. You must provide the source Jira issue key, attachment IDs and exact saved project template name. The agent does not support listing saved templates; open the Reconcile panel on an issue in that project to view or save a named template.

The run action inputs are `issueKey`, `attachmentIds` (a comma-separated string of 2–5 numeric IDs in saved-template table order) and `template` (the exact, case-sensitive saved name). Spaces around comma-separated IDs are trimmed. For two tables, `attachmentA` and `attachmentB` are supported instead; a nonempty `attachmentIds` overrides them. Use the number of attachments required by the template. All attachments must belong to the source issue.

The panel's **Source** dropdown shows filenames, not attachment IDs. To find IDs, while signed in to Jira with access to the source issue, open `/rest/api/3/issue/KAN-5?fields=attachment` on that same Jira site (replace `KAN-5` as needed). In `fields.attachment`, match each `filename` to its numeric `id`; use the `id`, not the filename or issue ID.

Copy this prompt, replacing `<id1>`, `<id2>` and `<id3>` with the IDs for closure-base, closure-open and closure-third respectively, after saving their confirmed mapping as `closure-test` on KAN-5:

```text
Run reconciliation on KAN-5 with attachment IDs <id1>,<id2>,<id3> using template closure-test.
```

The run action returns counts and a persisted run ID. With the source issue still open, ask **Explain the exceptions for run <runId>**, using that returned ID, for up to ten stored exception details. Each is named **Exception #<ID> (key <key>)**. **Exception ID is a sequence number counted from 0** in the run's result list (so `close-501` can be Exception #0); it is not the Jira key.

Then ask for grouped issue creation. **The issue type must be a numeric ID**; a name such as Task fails with "invalid project key or issue type ID". Example:

```text
Create one grouped issue for exception 0 from run <runId> in project KAN with numeric issue type ID 10003.
```

The numeric ID is shown as the **Type** value in the panel's audit trail after a creation through the panel, or can be looked up in Jira's issue type settings. In the panel the **Type** dropdown usually selects Task for you.

Rovo does not always behave the same way, so expect either of these two flows:

- **A.** Rovo shows a **Please review** card straight away.
- **B.** Rovo first asks in plain text whether to continue. Reply **Yes, proceed.** and the **Please review** card appears after that.

In both flows the card lists **Grouped: true**, **Confirmed: true**, **Exception IDs**, **Run ID** and **Issue Type**. Check that it says **Grouped: true**, then click **Confirm selected**. The result text includes **Mode: Grouped**, the exception as `Exception #0 (key …)` and **Created Issue: <key>**. Open the created issue: its description is plain text sections (run ID, template, Source A/B/C file names, then one `Exception #<id> (key <key>)` block with category, row counts, amounts and `field: A value → B value` lines), without raw JSON.

Ask again for the identical evidence and confirm again: the second reply reads **Reused Issue: <the same issue key>** and no new issue is created. If a grouped issue already exists for the same evidence, even the first request reuses it; to see a first-time creation, choose an exception that has no issue yet, or test on a new source issue. Real grouped creation and serial reuse were previously verified on the existing demo development site; see README Changelog. The app does not invent root causes.

## Access, privacy and limits

The user must be able to read source files and have Create Issues permission for writes; required project fields still apply. The app uses `asUser()` and cannot exceed the user's permissions. Accept Atlassian's normal consent screen if one is shown; on the fresh-site check above none was shown.

Reconciliation data stays within Atlassian and the user's browser. CSV/XLSX attachments are capped at 2 MiB each, local uploads at 8 MiB, and each sheet at 50,000 rows / 100 XLSX columns. Large results can hit bridge/runtime safeguards. Full rows stay transient; bounded metadata remains in Forge KVS. See [README.md](README.md) for exact limits, coverage and security-audit limitations.

The server-verified evidence comment is added to the grouped issue created by the app (not to the issue where the panel was opened).

Keys are compared case-insensitively and shown in lowercase in the panel (e.g. PAY-501 appears as pay-501).

The report page is created in the same space as the target page, at the same level (not as a child page); generating again reuses the same report page.

XLSX files default to the worksheet with the most parsed data rows; check the worksheet and row count before confirming the mapping. A selected sheet with at most one data row shows a warning. Mapping confirmation and reconciliation are disabled during loading; a worksheet change requires mapping confirmation again. **Reset** clears sources, worksheets, mappings and results. Restored session sources/mappings show “Restored from your last session. Please re-check sources and worksheets, or click Reset.” near **Load selected sources**, and require confirmation again. Automatically selected issue attachments show “Sources were auto-selected from this issue's attachments. Please re-check sources and worksheets, or click Reset.” in the same position. When the issue's attachments cannot be told apart reliably (more than three, repeated roles or unrecognized names), nothing is selected and the same position shows “This issue has N attachments, so sources were not auto-selected. Choose A / B / C manually (for the three-table sample: ledger as A), then click Load selected sources.” **Reset** or **Load selected sources** dismisses any of these reminders. Session recovery is limited to this browser tab and excludes local uploads.

Add an optional **Run annotation** before running, or edit it after completion and click **Save run annotation** to save it to that run with an audit event. Annotation changes do not change comparison evidence signatures. Save before generating a report: existing Confluence reports keep their generated snapshot when reused.
