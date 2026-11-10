# Privacy Policy — Reconcile (Atlassian Forge app)

Last updated: November 10, 2026

Reconcile runs entirely on Atlassian Forge ("Runs on Atlassian"). It has no remote backend, no external network egress, no analytics and no external AI service.

**What it reads.** When a signed-in user opens Reconcile on a Jira issue or Confluence page, the app reads the CSV/XLSX attachments that user chooses, through Atlassian product APIs acting as that user (`asUser()`). It can only read what that user is already allowed to see.

**What it stores.** In Forge storage (inside Atlassian's infrastructure, on your site) the app keeps bounded metadata: saved comparison templates, the last 20 run summaries per issue or page, and compact evidence for exceptions a user chose to turn into Jira issues. It does not store copies of source workbooks.

**What it shares.** Nothing leaves Atlassian. We do not sell, transfer or receive any data.

**Retention and deletion.** Stored metadata is deleted when the app is uninstalled from the site. Jira issues created through the app are ordinary Jira issues owned by your site.

**Contact.** Questions or deletion requests: open an issue at https://github.com/1024yuqiu/reconcile-forge/issues
