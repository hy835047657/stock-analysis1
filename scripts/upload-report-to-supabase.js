import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function todayUtcStr() {
  return new Date().toISOString().slice(0, 10);
}

function compactDate(date) {
  return date.replace(/-/g, '');
}

async function readText(file, fallback = '') {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function readJson(file, fallback) {
  const text = await readText(file, '');
  if (!text) return fallback;
  return JSON.parse(text);
}

function publicUrl(file) {
  const base = (process.env.REPORT_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) return '';
  return `${base}/${path.basename(file)}`;
}

async function supabaseRequest(pathname, options = {}) {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const res = await fetch(`${url}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${pathname} failed: ${res.status} ${body}`);
  }
  return res;
}

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.log('Supabase upload skipped: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(0);
}

const reportDate = process.env.REPORT_DATE || todayUtcStr();
const stamp = compactDate(reportDate);
const processedDir = path.join(DATA, 'processed', reportDate);
const reportDir = path.join(DATA, 'reports');
const mdPath = path.join(reportDir, `daily_${stamp}.md`);
const htmlPath = path.join(reportDir, `daily_${stamp}.html`);

const classified = await readJson(path.join(processedDir, '_all_classified.json'), {});
const consensus = await readJson(path.join(processedDir, '_consensus.json'), {});
const risk = await readJson(path.join(processedDir, '_risk.json'), {});
const bloggerStats = Object.entries(classified).map(([handle, items]) => ({
  handle,
  count: items.length,
  translated: items.filter(item => item.translation_zh || item.summary_zh).length,
  long: items.filter(item => item.stance === 'LONG').length,
  short: items.filter(item => item.stance === 'SHORT').length,
  risk: items.filter(item => item.stance === 'RISK_FLAG').length,
}));

const row = {
  report_date: reportDate,
  markdown: await readText(mdPath),
  html: await readText(htmlPath),
  report_url: publicUrl(htmlPath),
  markdown_url: publicUrl(mdPath),
  topic_heat: consensus.topic_heat || [],
  consensus,
  risk,
  blogger_stats: bloggerStats,
  generated_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

await supabaseRequest('daily_reports?on_conflict=report_date', {
  method: 'POST',
  body: JSON.stringify(row),
});

await supabaseRequest('report_runs', {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({
    report_date: reportDate,
    status: 'success',
    message: 'Daily report generated and uploaded.',
    report_url: row.report_url,
  }),
});

console.log(`uploaded report ${reportDate} to Supabase`);
