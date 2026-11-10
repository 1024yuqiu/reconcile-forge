import { makeResolver } from '@forge/resolver';
import api, { route, assumeTrustedRoute } from '@forge/api';
import { kvs } from '@forge/kvs';
import { randomUUID, createHash } from 'node:crypto';
import { createService } from './service.js';
import { readBytes } from './files.js';

async function json(response) {
  if (!response.ok) throw new Error(`Atlassian request failed (${response.status}). Check permissions, project fields and retry.`);
  return response.json();
}
async function jira(operation, p) {
  const client = api.asUser();
  if (operation === 'issue' || operation === 'attachments') {
    const issue = await json(await client.requestJira(route`/rest/api/3/issue/${p.key}?fields=project,attachment`));
    return operation === 'issue' ? issue : issue.fields.attachment.filter(a => /\.(csv|xlsx)$/i.test(a.filename)).map(a => ({ id: a.id, name: a.filename, size: a.size }));
  }
  if (operation === 'jql') {
    const issues = []; let nextPageToken;
    do {
      const data = await json(await client.requestJira(route`/rest/api/3/search/jql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jql: p.jql, fields: ['summary', 'status'], maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }) }));
      issues.push(...data.issues);
      nextPageToken = data.isLast ? undefined : data.nextPageToken;
      if (issues.length > 5000) throw new Error('JQL exceeds 5,000 issues. Narrow the query.');
    } while (nextPageToken);
    return { name: 'JQL results', headers: ['Issue key', 'Summary', 'Status'], rows: issues.map(i => ({ 'Issue key': i.key, Summary: i.fields.summary, Status: i.fields.status.name })) };
  }
  if (operation === 'findException') {
    const data = await json(await client.requestJira(route`/rest/api/3/search/jql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jql: `project = "${p.project}" AND labels = "${p.label}"`, maxResults: 1, fields: ['key'] }) }));
    return data.issues[0]?.key;
  }
  if (operation === 'create') return json(await client.requestJira(route`/rest/api/3/issue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }));
  throw new Error('Unknown Jira operation.');
}
async function confluence(operation, p) {
  const client = api.asUser();
  if (operation === 'page') return json(await client.requestConfluence(route`/wiki/api/v2/pages/${p.id}`));
  const all = []; let cursor;
  do {
    const path = cursor ? route`/wiki/api/v2/pages/${p.id}/attachments?limit=100&cursor=${cursor}` : route`/wiki/api/v2/pages/${p.id}/attachments?limit=100`;
    const data = await json(await client.requestConfluence(path));
    all.push(...data.results);
    cursor = data._links?.next ? new URL(data._links.next, 'https://local.invalid').searchParams.get('cursor') : undefined;
    if (all.length > 1000) throw new Error('More than 1,000 attachments. Use a page with fewer attachments.');
  } while (cursor);
  return all.filter(a => /\.(csv|xlsx)$/i.test(a.title)).map(a => ({ id: a.id, name: a.title, size: a.fileSize, downloadLink: a.downloadLink }));
}
async function loadAttachment(s, attachment, sheet) {
  // Bound compressed bytes before parsing; response JSON is bounded separately below.
  if (attachment.size > 2 * 1024 * 1024) throw new Error('Attached file exceeds the 2 MB server safety limit. Split it into smaller files.');
  let response;
  if (s.kind === 'jira') response = await api.asUser().requestJira(route`/rest/api/3/attachment/content/${attachment.id}?redirect=false`);
  else {
    const url = new URL(attachment.downloadLink, 'https://local.invalid');
    if (!url.pathname.startsWith('/wiki/download/attachments/') && !url.pathname.startsWith('/download/attachments/')) throw new Error('Unsupported Confluence attachment download path.');
    const path = url.pathname.startsWith('/wiki/') ? url.pathname : `/wiki${url.pathname}`;
    response = await api.asUser().requestConfluence(assumeTrustedRoute(path + url.search));
  }
  if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Attachment exceeds 2 MB. Split the export.');
  return readBytes(bytes, attachment.name, sheet);
}
const service = createService({ store: kvs, jira, confluence, loadAttachment, uuid: randomUUID, digest: value => createHash('sha256').update(value).digest('hex').slice(0, 32), now: () => new Date().toISOString() });
const definitions = {};
for (const operation of ['bootstrap', 'saveTemplate', 'run', 'createIssues']) definitions[operation] = async ({ context, payload }) => {
  const result = await service[operation](context, payload);
  if (Buffer.byteLength(JSON.stringify(result)) > 3 * 1024 * 1024) throw new Error('Results exceed the 3 MB bridge safety limit. Split the source files and rerun.');
  return result;
};
definitions.loadSource = async ({ context, payload }) => {
  const result = await service.source(await service.scope(context), payload);
  // Mapping needs headers and sheet names, not the full source data.
  return { name: result.name, headers: result.headers, sheets: result.sheets || ['JQL'], sheet: result.sheet || 'JQL', rowCount: result.rows.length, headerRow: result.headerRow };
};
export const handler = makeResolver(definitions);
export async function rovoRun(payload, context) {
  const ctx = { ...context, extension: { issue: { key: payload.issueKey } } };
  const data = await service.bootstrap(ctx);
  const template = data.templates.find(t => t.name === payload.template);
  if (!template) throw new Error('Saved template not found in this project.');
  const result = await service.run(ctx, { sources: [{ id: payload.attachmentA }, { id: payload.attachmentB }], mappings: template.mappings, rules: template.rules });
  return { runId: result.id, summary: result.summary, inputRows: result.inputRows };
}
function rovoContext(payload, context) {
  const issue = payload.context?.jira?.issueKey;
  if (issue) return { ...context, extension: { issue: { key: issue } } };
  const page = payload.context?.confluence?.contentId;
  if (page) return { ...context, extension: { content: { id: page } } };
  throw new Error('Open the source issue or page before using this action.');
}
export async function rovoExplain(payload, context) {
  const run = await service.savedRun(rovoContext(payload, context), payload.runId);
  return { runId: run.id, summary: run.summary, examples: run.exceptions.slice(0, 10), note: 'Observed differences only; causes require human investigation.' };
}
export const rovoCreate = (payload, context) => service.createIssues(rovoContext(payload, context), payload);
