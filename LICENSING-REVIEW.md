# Dependency licensing review

The license gate permits the explicitly listed permissive families and OR branches, exact MIT AND Zlib, development-only caniuse-lite CC-BY-4.0 data, and mandatory Forge packages with installed Atlassian Developer Terms notices. UNKNOWN declarations fail; there is no blanket exception or license relabel.

ExcelJS 4.4.0 overrides unzipper to 0.12.5, removing the old binary/buffers path. The installed unzipper metadata and LICENSE declare MIT. Workbook bytes are parsed in memory, without extracting ZIP entries to disk.

`@aws-sdk/client-s3` is pinned only because Forge's bundler resolves unzipper's optional S3 require. The app makes no S3 calls, declares no external egress permission and supplies no AWS credentials. Its Apache-2.0 and transitive notices are included in THIRD-PARTY-LICENSES.md.

Run `cd app; npm run licenses` to regenerate the locked-package inventory and enforce the existing allowlist. ExcelJS, Papa Parse and React retain their notices; SheetJS is absent. Historical dependency rejection was resolved by replacement, without relaxing policy. A passing license gate is not a complete security audit or production acceptance.
