# Reconcile v3 — installation and synthetic test guide

Installation link: https://developer.atlassian.com/console/install/297ff2c3-3390-4087-999d-f7b0507e1854?signature=AYABeFEeI0jKV%2Fg55BiMMlIb2e4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB8IR%2Fr4eCcFtjv84f46z3lQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDJEnRfbvYEyuAXePKgIBEIA7Uu8ui9sA7kWIbdibQfVEw1pF86ly7J%2FycGOB3oKIR17iEuP5ccWFAGy24Lj8VDM6%2BkLAXFrQurRQNIcAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHhlTS1%2FI6vlaZv%2B2dnwSiEAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMlsespPbwioQ7YLwZAgEQgDtatkNIwTfq8ZNd2JvxfgVqFDntP%2BhpKWkRZDXzCwpnJ0xKttfZJ6x8S4jN4gsRt2FTr8ax7qKyKhE6pQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAR5cs%2FECKKfdmkL5tsJ9AiIAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzR9WbeVQ1UBVEwZEgCARCAOwjqc2AB9av88qBTd9S%2BMR66%2FjUADlelxf82eP7E2vHGrWz4oAvnmEHi7cq%2B4GAKDB0LK84m08%2F28WjZAgAAAAAMAAAQAAAAAAAAAAAAAAAAABy2b3i%2BTufV5lK1NVWCYPj%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLZVhAHc5T8zOQRiTVCZgEXR7t4RtcF%2Ba3ziNE3TDx9ex%2Bf%2FOh1Jjs2Pk5Fc1Q2Oyv7m9Suw2dmfli0CRXW4RgUeAY%3D&product=jira&product=confluence

Production **2.1.0** contains the same application source as development **3.9.0**. Distribution sharing remains enabled for Jira and Confluence. A site administrator can review the scopes and choose a site through the existing link above. Jira is required; connect optional Confluence on the same site. No external-service account or API key is needed. A fresh judge-site install and first consent by a new user remain unverified.

## Run the three-table example

1. Use only synthetic data in a test issue/page. Attach `app/samples/ledger.csv`, `app/samples/bank.xlsx` and `app/samples/invoices.csv` to that source. Open the Jira **Reconcile** issue panel, or insert the **Reconcile** macro on the saved Confluence test page.
2. Select ledger as A, bank as B, add C and select invoices. Click **Load selected sources**. Choose B's **Transactions** sheet, enable **Ignore leading zeros in keys** and **Aggregate C**. All detected headers are on source row 3, and data row counts are 6 / 6 / 7.
3. Run the comparison. Expect **3 matches / 1 mismatch / 2 only in reference / 2 missing from reference / 0 duplicates**. Key 1 combines 40 + 60; key 3 shows the bank difference 300 versus 305.
4. Export XLSX with **Include original table layouts** enabled. Expect ten sheets and eight result keys; the differing bank amount is coloured. Original layouts retain data-column order, not complete source formatting.
5. Optionally save a named template, mark unchanged exceptions Explained/Ignored with notes, refresh, select the same files, reload the template and rerun. Reviews should return. This passed on development 3.9.0.

## Optional real issue creation

This creates real Jira issues and is separate from a read-only comparison. Use a test project, select at most 20 exceptions by checkbox, enter a valid target/type, optionally group them, then review the summary and explicitly confirm. Development 3.9.0 created one grouped issue for keys 3 and 4 and reused it after a full refresh/template reload. No extra issue was created by the repeat. Changed-evidence invalidation is locally tested. Old-version record migration is not implemented. Avoid concurrent creation; cross-request atomicity is not guaranteed.

## Rovo boundaries

On a Rovo-enabled site, select **Reconciliation Assistant** and supply the real source issue key, two to five attachment IDs in template order and the exact saved template name. Live saved-template run and stored-exception explanation passed on a free Forge demo development site. After explicit confirmation the agent created one Jira issue for a single selected exception, and a repeated request reused it with zero new issues. Grouped creation through Rovo has not been tested live.

## Access and limits

The user must be able to read the source and attachments. Create Issues permission, valid project type IDs and required fields govern writes. The app uses `asUser()` and cannot exceed the invoking user's permissions. Accept Atlassian's normal consent screen if shown; first consent by a fresh judge user has not been verified.

CSV/XLSX attachments are capped at 2 MiB each; supported XLSX data has at most 100 columns and 50,000 rows. Large or highly compressed files may hit runtime limits. Exported full rows are transient; bounded history, compact evidence, reviews and templates remain in Forge KVS. Consult [README.md](README.md) for limits, precise live/local coverage, scopes and privacy links.
