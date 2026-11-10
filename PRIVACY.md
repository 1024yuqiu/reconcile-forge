# Privacy Policy — Reconcile

Last updated: November 10, 2026

Reconcile is an Atlassian Forge app. Its manifest has no external egress permission, remote backend, analytics service or external AI endpoint. Product requests act as the invoking user, whose existing Jira/Confluence permissions still apply.

**Reads.** The app discovers source issue/page attachments and reads the CSV/XLSX files selected by the user. Optional JQL reads issue keys, summaries and statuses. Source access and attachment membership are checked on the server.

**Stores.** Forge KVS holds bounded project/space templates, the last 20 run summaries per source, compact exception evidence, Explained/Ignored review states and notes, invoking account attribution and issue deduplication references. Full source workbooks and complete result rows are not persisted there. Users with access to a source can see its stored runs; project/space templates are shared within that scope. Jira issues created after confirmation are ordinary issues under the site's access and retention controls.

**Exports and local preview.** The user's browser receives selected source data for comparison and may download an XLSX. Local preview uses synthetic adapters and browser localStorage; user-uploaded local files stay in that browser workflow. Keep downloaded workbooks under your own data controls.

**Retention and logs.** App history is bounded as described above. Atlassian controls Forge platform logs, uninstall retention and deletion; this policy does not promise immediate deletion on uninstall. Site administrators can manage vendor log access in Atlassian administration. The app has no external analytics or data sale service.

**Contact.** Open a support/privacy request at https://github.com/1024yuqiu/reconcile-forge/issues. Do not post confidential attachments, credentials or personal data in a public issue.
