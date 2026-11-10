import { validate } from '@forge/manifest';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('logs', { recursive: true });
const result = await validate();
const summary = { success: result.success, errors: result.errors, checker: '@forge/manifest local validation (not authenticated forge lint)' };
await writeFile('logs/manifest-validation.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (!result.success) process.exitCode = 1;
