# Phase 3 licensing review — dependency gate passed

The TASK-2.md policy remains unchanged: explicitly permitted permissive families and OR branches, exact MIT AND Zlib, development-only caniuse-lite CC-BY-4.0 data, and mandatory Forge packages with verified installed Atlassian Developer Terms notices. UNKNOWN still fails. No blanket exception or license relabel was added.

TASK-3.md closes the former buffers@0.1.1 UNKNOWN by removing its dependency path. app/package.json now overrides exceljs@4.4.0 -> unzipper to 0.12.5. The installed unzipper/package.json declares MIT and its installed LICENSE contains the MIT grant and Near Infinity / Ziggy Jonsson notices. Its dependencies are bluebird, duplexer2, fs-extra, graceful-fs and node-int64; binary/buffers are absent. Evidence: logs/phase3-unzipper-license.txt. npm ls buffers reports (empty), with npm's expected exit 1 for no matching package; logs/phase3-buffers.txt.

The first Forge deployment exposed unzipper's optional S3 v3 require, which Forge's bundler resolves even though spreadsheet parsing does not call it. @aws-sdk/client-s3@3.1165.0 was explicitly pinned to satisfy this requirement; its installed metadata and LICENSE declare Apache-2.0. Its full transitive notices are included in THIRD-PARTY-LICENSES.md. No application S3 call, external permission or AWS credential was introduced. The initial failure remains in logs/phase3-deploy.txt.

unzipper 0.12.5 was retained instead of reverting to a pre-fix release: upstream advisory GHSA-2756-j7rr-9464 affects <=0.12.4 (https://github.com/ZJONSSON/node-unzipper/security/advisories/GHSA-2756-j7rr-9464). This app parses workbook bytes in memory and does not extract ZIP entries to disk.

The regenerated inventory contains 1,155 locked packages; npm run licenses exits 0 with zero non-allowlisted entries and zero UNKNOWN declarations. logs/license-exceptions.json is []. The scanner's policy code was not changed. ExcelJS/Papa Parse/React remain MIT; SheetJS remains absent.

Regression evidence: 21/21 tests, including actual XLSX write/read with worksheets, cached formulas, dates and exported duplicate detail; the same 300-row fixture counts remain 270 matched, 18 mismatch, 10 only A, 10 only B, 1 duplicate. Reference comparison still has 310 keys with zero per-key status differences. See logs/phase3-tests.txt, logs/phase3-reference.txt and final checks recorded in REPORT-2.md.

Historical phase 1/2 rejection was valid at that time: buffers lacked release-specific license evidence and was never relabeled. This phase resolves it through replacement, not a policy relaxation. A passing license gate does not claim a full security audit or production acceptance.

