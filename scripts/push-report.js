import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushLark, pushSlack } from '../src/agent/reporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function todayUtcStr() {
  return new Date().toISOString().slice(0, 10);
}

function compactDate(date) {
  return date.replace(/-/g, '');
}

const reportDate = process.env.REPORT_DATE || todayUtcStr();
const stamp = compactDate(reportDate);
const mdPath = path.join(DATA, 'reports', `daily_${stamp}.md`);
const htmlPath = path.join(DATA, 'reports', `daily_${stamp}.html`);
const md = await fs.readFile(mdPath, 'utf8');

await Promise.all([
  pushLark(md, { htmlPath }),
  pushSlack(md),
]);

console.log(`pushed report notification for ${reportDate}`);
