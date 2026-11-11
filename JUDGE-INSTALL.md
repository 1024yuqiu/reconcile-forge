# Reconcile — installation and synthetic test guide

Installation link: https://developer.atlassian.com/console/install/297ff2c3-3390-4087-999d-f7b0507e1854?signature=AYABeFEeI0jKV%2Fg55BiMMlIb2e4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB8IR%2Fr4eCcFtjv84f46z3lQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDJEnRfbvYEyuAXePKgIBEIA7Uu8ui9sA7kWIbdibQfVEw1pF86ly7J%2FycGOB3oKIR17iEuP5ccWFAGy24Lj8VDM6%2BkLAXFrQurRQNIcAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHhlTS1%2FI6vlaZv%2B2dnwSiEAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMlsespPbwioQ7YLwZAgEQgDtatkNIwTfq8ZNd2JvxfgVqFDntP%2BhpKWkRZDXzCwpnJ0xKttfZJ6x8S4jN4gsRt2FTr8ax7qKyKhE6pQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAR5cs%2FECKKfdmkL5tsJ9AiIAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzR9WbeVQ1UBVEwZEgCARCAOwjqc2AB9av88qBTd9S%2BMR66%2FjUADlelxf82eP7E2vHGrWz4oAvnmEHi7cq%2B4GAKDB0LK84m08%2F28WjZAgAAAAAMAAAQAAAAAAAAAAAAAAAAABy2b3i%2BTufV5lK1NVWCYPj%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLZVhAHc5T8zOQRiTVCZgEXR7t4RtcF%2Ba3ziNE3TDx9ex%2Bf%2FOh1Jjs2Pk5Fc1Q2Oyv7m9Suw2dmfli0CRXW4RgUeAY%3D&product=jira&product=confluence

Judges install Reconcile **4.x**. Application package **4.0.0** is deployed to production (Forge deployment **3.3.0**); existing production installation is upgraded, while the sharing-installation UI check remains pending. Application versions and Forge deployment numbers are independent; historical acceptance versions are in the README Changelog. Jira is required; Confluence is optional on the same site. A site administrator reviews the scopes through the sharing link. No external-service account or API key is needed. A fresh judge-site install and first consent by a new user remain unverified.

## 1. Three tables and confirmed column mapping

1. In an existing synthetic Jira test issue or saved Confluence test page, attach `app/samples/ledger.csv`, `bank.xlsx` and `invoices.csv`. Open the **Reconcile** issue panel or macro.
2. Select ledger as A and bank as B; add C and select invoices. **Load selected sources**, choose B's **Transactions** worksheet, enable **Ignore leading zeros in keys** and **Aggregate C**. The files have 6 / 6 / 7 rows, with headers on source row 3.
3. Inspect the **High / Medium / Low** mapping proposals, choose any blank or incorrect columns, then click **Confirm column mapping**. Run and Save stay disabled until mapping is complete and confirmed. Changes to rules or columns require confirmation again; an existing saved template restores its confirmed mapping.
4. Click **Run reconciliation**. Expect **3 matched / 1 mismatch / 2 only in reference / 2 missing from reference / 0 duplicates**. Key 3 is 300 versus 305. Key 2 also has a tolerated 0.01, so the bank statement residual is **5.01**.
5. Enable **Include original table layouts** and export XLSX. Expect ten sheets and eight result keys, with the differing bank amount coloured. Save a named template if you want reviews and Rovo to reuse these mappings.

For a deliberate confidence example, attach `examples/mapping/` files and follow its README: Key High, Amount → Amuont Medium, Date → Booking Low. Choose Booking manually before confirming.

## 2. Unique amount combinations

Use `examples/combinations/` and its config. First compare 305.01 against 300.00: the difference remains 5.01. Switch to the split-invoices export, enable **Match unique amount combinations**, confirm the mapping and rerun: **300.00 + 5.01 = 305.01** matches with component keys and rows preserved. Ambiguous combinations remain unresolved; this is bounded search, not global allocation.

## 3. Domestic exports

Use the clean reference and UTF-8 / GBK / GB18030 files under `examples/domestic/`, following that folder's README. Confirm the key/amount/date mapping and rerun; all three synthetic rows match. The original quoted thousands separators, yuan amounts, Chinese dates and full-width values remain visible. Keep CSV thousands separators quoted.

## 4. Confirmed Jira creation and closure evidence

Use only an existing demo test project. Enter its project key and click **Load project issue types**, then choose a type from the dropdown. If loading is unavailable, use the numeric `issueTypes[].id` returned by `GET /rest/api/3/project/PROJECTKEY`; open this relative path on your own Jira site. A type name or project key is not an issue type ID. A sub-task also needs a valid parent key.

Select at most 20 exception checkboxes. **Group selected exceptions** is enabled by default, matching Rovo. Click **Review issue creation**, verify selected keys/project/type/grouped mode, then explicitly **Confirm creation**. Repeat requests reuse existing matching references. Serialize requests; concurrent writes have no global atomic lock.

Follow `examples/closure/README.md`: save a named template, run the initial differing data, and explicitly create the selected grouped exception. Attach/select the corrected export, reuse the same template and rerun. Once every linked key matches, Forge re-reads the authorized source and adds one evidence comment to the original issue; **Ready to close** appears. Another balanced run adds no comment. Review and close manually; the app never changes issue status. Historical references are not bulk migrated; current label-based reuse is now enrolled in tracking.

## 5. Audit trail and Confluence report

Add an optional **Run annotation** before running. The audit card shows actor accountId, content-based template version and annotation. **Load audit trail** displays event cards for run, reviews, explicit confirmation, creation/reuse and report receipts.

From Confluence, **Generate Confluence report** uses the source page's space. From Jira, open an existing accessible test page in the intended Confluence space; copy its numeric page ID from `/wiki/spaces/SPACEKEY/pages/PAGEID/...` into **Existing Confluence page ID in the report space**. This selects the destination space without editing that page. Generate creates a new report; **Open report** uses the API's web UI link. A repeated request for the same run/space reuses the report. Do not enter a space key or a full URL in the page-ID field.

## 6. Rovo grouped creation and reuse

On a Rovo-enabled site, choose **Reconciliation Assistant**. Provide the source issue key, two to five attachment IDs in saved-template order, and the exact saved template name. Ask to run, then explain stored exceptions; the returned run ID and counts refer to persisted evidence.

Ask for grouped issue creation for explicit exception IDs, project and numeric issue type. Verify the confirmation includes **grouped=true**, then confirm. Ask again for the identical evidence and confirm again: the second result should have **Created: none**, **Reused: the same issue**. Real grouped creation and serial reuse were previously verified on the existing demo development site; see README Changelog. The app does not invent root causes.

## Access, privacy and limits

The user must be able to read source files and have Create Issues permission for writes; required project fields still apply. The app uses `asUser()` and cannot exceed the user's permissions. Accept Atlassian's normal consent screen if shown; first consent by a fresh judge user has not been verified.

Reconciliation data stays within Atlassian and the user's browser. CSV/XLSX attachments are capped at 2 MiB each, local uploads at 8 MiB, and each sheet at 50,000 rows / 100 XLSX columns. Large results can hit bridge/runtime safeguards. Full rows stay transient; bounded metadata remains in Forge KVS. See [README.md](README.md) for exact limits, coverage and security-audit limitations.
