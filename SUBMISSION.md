# Project name
Reconcile

## Elevator pitch
Compare two attached spreadsheets inside Jira and Confluence, investigate differences, export the evidence, and turn reviewed exceptions into Jira work.

## Inspiration
Finance, operations and support teams already attach exports to the issues and pages where they coordinate work. Reconciliation still happens by eye or in a separate workbook, and exceptions must be copied into tickets. We wanted the comparison to stay next to its context and lead directly to an accountable follow-up.

## What it does
Reconcile compares two CSV/XLSX attachments by single or composite key. It suggests mappings and supports amount/date tolerances, normalization and extra text-field comparisons. Users inspect matches, value mismatches, records missing from either source and duplicate groups; search highlights the evidence. A complete Excel export preserves summary, results and duplicate source rows. Project/space templates make recurring comparisons consistent, and the last 20 run summaries remain on the source issue or page. Reviewed exceptions can become Jira issues or grouped work through a separate confirmation step, with stable references for serial retry reuse.

The Rovo Reconciliation Assistant defines three actions to run saved rules, explain observed exceptions and create issues after explicit confirmation. A live Rovo conversation has not been verified. The video shows live production 2.0.0 Jira panel footage for source loading, mapping, comparison, filtering and XLSX export. The v7 video shows live grouped creation and serial retry on SCRUM-5. One issue, SCRUM-6, was created for 39 exceptions; the identical rerun reused SCRUM-6 and created none. The creation responses are transcribed on screen from the recorded application response, which was outside the viewport. Rovo remains an implementation overview; no live conversation was verified.

## How we built it
We built a Forge-hosted React Custom UI shared by a Jira issue panel and Confluence macro. Forge Resolver functions use user-authorized Atlassian product APIs. A shared service handles source authorization, templates, history and exception creation. Papa Parse and ExcelJS read CSV/XLSX, while a pure JavaScript engine indexes keys, compares integer cents and validated calendar days, and isolates duplicate groups. Forge KVS stores bounded metadata and compact exception evidence rather than source workbooks. Rovo actions call the same service. There is no remote backend, external egress, analytics endpoint or external AI service configured.

## Challenges we ran into
Duplicate records need explicit review instead of arbitrary pairing. Spreadsheet date formats and exact cents need consistent interpretation. Forge's bridge and storage limits require bounded payloads and clear failure messages. A real deployment exposed a resolver initialization issue, which was fixed using the SDK's named makeResolver API. Dependency review also replaced a transitive package with missing license evidence without relaxing the license policy.

## Accomplishments that we're proud of
The real Jira server-side test used two 300-row synthetic attachments and returned 270 matched keys, 18 value mismatches, 10 only in A, 10 only in B and one duplicate group. The live production Jira panel produced those same counts and exported an XLSX workbook. A confirmed grouped request created SCRUM-6, and an identical serial rerun reused it without creating another issue. Twenty-one automated tests passed. Production version 2.0.0 is deployed, Forge reports Runs on Atlassian eligibility, and both Jira and Confluence production connections are Up-to-date. Development 3.2.0 remains installed. The license inventory covers 1,155 locked dependencies with no unknown licenses or policy exceptions.

## What we learned
Useful reconciliation needs visible evidence and honest limits, not just a match percentage. The export must retain full results even when the screen is filtered. Separating the pure engine, source authorization and product adapters made it possible to compare local and live results without inventing a second implementation. Server-side acceptance and browser/agent acceptance are different checks; we describe them separately.

## What's next
Verify a live Rovo conversation, test user consent on a judge-like installation, and validate a full Confluence attachment run. Improve support for project-specific required fields and atomic handling of concurrent creation requests. Gather feedback from teams doing recurring finance and operations comparisons. Marketplace publication is not planned for this submission.

## Built with
Atlassian Forge, Jira Cloud, Confluence Cloud, Rovo, React, JavaScript, Node.js, Forge KVS, ExcelJS, Papa Parse, Vite, Playwright

## How it meets the technology requirement
This is an Atlassian Forge app integrating Jira and optional Confluence, with a Rovo agent implementation. Its manifest declares `jira:issuePanel`, `macro`, `rovo:agent`, three `action` modules, four `function` handlers and a Custom UI `resources` entry. Jira is the required product; Confluence is an optional same-site connection. Runtime and persisted application metadata use Forge; product operations use Atlassian APIs under `asUser()`. Production deployment and Jira/Confluence installation are verified. The earlier server-side comparison was recorded in development 3.1.0; the final development cleanup release is 3.2.0. The new browser footage shows production 2.0.0. The source has no external egress or remote configuration.

## Category recommendation
**Apps for Business Teams.** The primary workflow serves finance, operations and support teams reconciling operational exports and assigning exceptions in Jira.

## Bonus prize recommendation
**Best Agents (Rovo), pending live agent verification.** A declared Rovo agent invokes three implemented actions through the same service and requires explicit creation confirmation. It explains actual stored evidence rather than inventing causes. Before final submission, verify the conversation and include its actual result in the bonus write-up. Do not present an unverified conversation as a demonstration. Runs on Atlassian is an eligibility attribute, not a Codegeist 2026 bonus category. No MCP, Teamwork Graph or Marketplace bonus is claimed.

## Testing instructions
Follow JUDGE-INSTALL.md. A site admin installs from the production sharing link and connects Jira (plus Confluence if testing the macro). Attach `samples/phase3-ledger.csv` and `samples/phase3-bank.xlsx` to one test issue, open Reconcile, accept any required user consent, load both sources, map Order ID / Amount / Date, use 0.01 amount and 1-day date tolerance, and run. Expect 270 / 18 / 10 / 10 / 1. Inspect AP-0001, missing and duplicate views, export XLSX, and optionally confirm creation in a test project using a valid issue type ID. Rerun identical inputs to test serial reuse. Try Reconciliation Assistant only if Rovo is enabled.

## Links
- YouTube demo (public): **TBD — upload video/demo-v7.mp4 and optionally video/demo-v7.srt; no upload performed.**
- Production installation link: https://developer.atlassian.com/console/install/297ff2c3-3390-4087-999d-f7b0507e1854?signature=AYABeFEeI0jKV%2Fg55BiMMlIb2e4AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB8IR%2Fr4eCcFtjv84f46z3lQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDJEnRfbvYEyuAXePKgIBEIA7Uu8ui9sA7kWIbdibQfVEw1pF86ly7J%2FycGOB3oKIR17iEuP5ccWFAGy24Lj8VDM6%2BkLAXFrQurRQNIcAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHhlTS1%2FI6vlaZv%2B2dnwSiEAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMlsespPbwioQ7YLwZAgEQgDtatkNIwTfq8ZNd2JvxfgVqFDntP%2BhpKWkRZDXzCwpnJ0xKttfZJ6x8S4jN4gsRt2FTr8ax7qKyKhE6pQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAR5cs%2FECKKfdmkL5tsJ9AiIAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzR9WbeVQ1UBVEwZEgCARCAOwjqc2AB9av88qBTd9S%2BMR66%2FjUADlelxf82eP7E2vHGrWz4oAvnmEHi7cq%2B4GAKDB0LK84m08%2F28WjZAgAAAAAMAAAQAAAAAAAAAAAAAAAAABy2b3i%2BTufV5lK1NVWCYPj%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLZVhAHc5T8zOQRiTVCZgEXR7t4RtcF%2Ba3ziNE3TDx9ex%2Bf%2FOh1Jjs2Pk5Fc1Q2Oyv7m9Suw2dmfli0CRXW4RgUeAY%3D&product=jira&product=confluence
- Repository: https://github.com/1024yuqiu/reconcile-forge

Submission preparation follows the [Codegeist 2026 rules](https://codegeist2026.devpost.com/rules), checked November 10, 2026. Deadline: December 22, 2026, 12:00 PM PST. The video must be publicly available on YouTube and under five minutes; the prepared artifact targets the stricter phase-four cap of 4:30. All submission materials are English.
