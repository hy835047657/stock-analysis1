import 'dotenv/config';

function todayUtcStr() {
  return new Date().toISOString().slice(0, 10);
}

function compactDate(date) {
  return date.replace(/-/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const rawBase = (process.env.REPORT_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const base = rawBase && !rawBase.endsWith('/reports') ? `${rawBase}/reports` : rawBase;
if (!base) {
  console.log('Public report wait skipped: REPORT_PUBLIC_BASE_URL is not configured.');
  process.exit(0);
}

const reportDate = process.env.REPORT_DATE || todayUtcStr();
const url = `${base}/daily_${compactDate(reportDate)}.html`;
const timeoutMs = Number(process.env.PUBLIC_REPORT_WAIT_SECONDS || 300) * 1000;
const intervalMs = Number(process.env.PUBLIC_REPORT_WAIT_INTERVAL_SECONDS || 10) * 1000;
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    const res = await fetch(`${url}?_=${Date.now()}`, { method: 'GET' });
    if (res.ok) {
      console.log(`public report is ready: ${url}`);
      process.exit(0);
    }
    console.log(`public report not ready yet: ${res.status}`);
  } catch (e) {
    console.log(`public report check failed: ${e.message}`);
  }
  await sleep(intervalMs);
}

console.log(`public report was not confirmed within ${timeoutMs / 1000}s: ${url}`);
