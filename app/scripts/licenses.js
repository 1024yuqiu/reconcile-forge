import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
// TASK-2.md policy: explicit permissive families, never an unrestricted wildcard.
const allowed = new Set(['MIT', 'MIT/X11', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'Python-2.0', 'Unlicense', 'WTFPL']);
const entries = [], bad = [];
for (const [location, p] of Object.entries(lock.packages)) {
  if (!location || p.link) continue;
  const name = p.name || location.split('node_modules/').at(-1);
  let metadata = {};
  try { metadata = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8')); } catch { /* Optional platform package. */ }
  const rawLicense = p.license || metadata.license || metadata.licenses?.[0]?.type || 'UNKNOWN';
  const license = typeof rawLicense === 'string' ? rawLicense : rawLicense.type || JSON.stringify(rawLicense);
  const alternatives = license.replace(/[()]/g, '').split(/ OR /);
  const forgeTerms = name.startsWith('@forge/') && license === 'SEE LICENSE IN LICENSE.txt'
    && /Atlassian Developer Terms/i.test(await readFile(path.join(location, 'LICENSE.txt'), 'utf8'));
  const permitted = forgeTerms || alternatives.some(term => allowed.has(term)
    || term === 'MIT AND Zlib'
    || (term === 'CC-BY-4.0' && p.dev && name === 'caniuse-lite'));
  if (!permitted) bad.push({ name, version: p.version, license, development: Boolean(p.dev), location });
  let notices = [];
  try { notices = (await readdir(location)).filter(f => /^(license|licence|copying|notice)(\.|$)/i.test(f)); } catch { /* Optional platform package not installed. */ }
  const texts = [];
  for (const notice of notices) texts.push(`### ${notice}\n\n${await readFile(path.join(location, notice), 'utf8')}`);
  entries.push(`## ${name}@${p.version}\n\nLicense: ${license}. ${p.dev ? 'Development tooling.' : 'Application dependency.'}\n\n${texts.join('\n\n') || 'Optional platform package or package without a top-level notice; SPDX metadata recorded above.'}`);
}
await writeFile('../THIRD-PARTY-LICENSES.md', `# Third-party licenses\n\nGenerated from app/package-lock.json and installed package notices. Includes transitive dependencies and development tools. Policy: TASK-2.md; verified Forge Developer Terms are exempt, explicitly permitted permissive families and alternative branches are accepted, CC-BY-4.0 is limited to development-only caniuse-lite data. Unknown licenses remain unresolved and fail the gate. ExcelJS is MIT; Papa Parse is MIT. SheetJS is not used.\n\n${entries.join('\n\n')}\n`);
await writeFile('../logs/license-exceptions.json', JSON.stringify(bad, null, 2));
console.log(`Recorded ${entries.length} locked packages. Non-allowlisted licenses: ${bad.length}.`);
if (bad.length) { console.log(bad.map(p => `${p.name}: ${p.license} (${p.development ? 'dev' : 'runtime'})`).join('\n')); process.exitCode = 1; }
