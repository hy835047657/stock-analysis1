import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'data', 'reports');
const PUBLIC_REPORTS_DIR = path.join(ROOT, 'public', 'reports');
const PUBLIC_INDEX = path.join(ROOT, 'public', 'index.html');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function reportDate(filename) {
  const match = filename.match(/daily_(\d{4})(\d{2})(\d{2})\.(html|md)$/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function listReportsFrom(dir) {
  try {
    const files = await fs.readdir(dir);
    return files
      .filter(file => /^daily_\d{8}\.(html|md)$/.test(file))
      .sort()
      .reverse();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function copyReports(files) {
  await fs.mkdir(PUBLIC_REPORTS_DIR, { recursive: true });
  for (const file of files) {
    await fs.copyFile(path.join(REPORTS_DIR, file), path.join(PUBLIC_REPORTS_DIR, file));
  }
}

async function writeIndex(files) {
  await fs.mkdir(path.dirname(PUBLIC_INDEX), { recursive: true });
  const htmlFiles = files.filter(file => file.endsWith('.html'));
  const latest = htmlFiles[0] || '';
  const rows = htmlFiles.map(file => {
    const date = reportDate(file);
    const md = file.replace(/\.html$/, '.md');
    return `<tr><td>${escapeHtml(date)}</td><td><a href="/reports/${escapeHtml(file)}">HTML 日报</a></td><td><a href="/reports/${escapeHtml(md)}">Markdown</a></td></tr>`;
  }).join('\n');
  const latestBlock = latest
    ? `<p><a class="primary" href="/reports/${escapeHtml(latest)}">打开最新日报</a></p>`
    : '<p class="muted">暂无日报。请先运行日报流水线。</p>';

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FinTwit Reports</title>
  <style>
    body { margin: 0; background: #f6f7f9; color: #17202a; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 980px; margin: 0 auto; padding: 36px 18px 64px; }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
    p { color: #657282; }
    a { color: #1f5fbf; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .primary { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border-radius: 6px; background: #1f5fbf; color: #fff; }
    .primary:hover { text-decoration: none; background: #164b99; }
    table { width: 100%; margin-top: 20px; border-collapse: collapse; background: #fff; border: 1px solid #d9e0e8; border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #d9e0e8; text-align: left; }
    th { background: #f0f4f8; color: #657282; }
    tr:last-child td { border-bottom: 0; }
    .muted { color: #657282; }
  </style>
</head>
<body>
  <main>
    <h1>FinTwit Reports</h1>
    <p>自动生成的中文 FinTwit 日报归档。</p>
    ${latestBlock}
    <table>
      <thead><tr><th>日期</th><th>HTML</th><th>Markdown</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="muted">暂无日报</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>`;
  await fs.writeFile(PUBLIC_INDEX, html, 'utf8');
}

const sourceFiles = await listReportsFrom(REPORTS_DIR);
if (sourceFiles.length) {
  await copyReports(sourceFiles);
}

const publicFiles = sourceFiles.length ? sourceFiles : await listReportsFrom(PUBLIC_REPORTS_DIR);
await writeIndex(publicFiles);
console.log(`synced ${publicFiles.length} report files to ${PUBLIC_REPORTS_DIR}`);
