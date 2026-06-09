// Report generator + push to Lark / Slack.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import nunjucks from 'nunjucks';
import {
  loadConfig, loadJson, DATA, nowUtc, todayUtcStr, logger,
} from '../common/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function reportDateStr() {
  return process.env.REPORT_DATE || todayUtcStr();
}

function compactDateStr(date) {
  return date.replace(/-/g, '');
}

function buildWeekly(cfg, cls) {
  const wcfg = (cfg.output || {}).weekly_section || {};
  if (!wcfg.enabled) return {};
  const target = Number(wcfg.weekday ?? 2);
  if (nowUtc().getUTCDay() !== target) return {};
  const includeLayers = new Set(wcfg.include_layers || []);
  if (includeLayers.size === 0) return {};

  const byBlogger = Object.fromEntries(cfg.bloggers.map(b => [b.handle, b]));
  const bucket = {};
  for (const [h, items] of Object.entries(cls)) {
    const b = byBlogger[h];
    if (!b || !includeLayers.has(b.layer)) continue;
    const sorted = [...items].sort((a, c) => (c.view_count || 0) - (a.view_count || 0)).slice(0, 10);
    if (sorted.length === 0) continue;
    bucket[h] = {
      layer: b.layer,
      function: b.function || '',
      window_hours: sorted[0].window_hours || 168,
      items: sorted,
    };
  }
  return bucket;
}

function buildBloggerSummaries(cfg, cls) {
  const byBlogger = Object.fromEntries(cfg.bloggers.map(b => [b.handle, b]));
  return Object.entries(cls)
    .map(([handle, items]) => {
      const b = byBlogger[handle] || {};
      const sorted = [...(items || [])].sort((a, c) => (c.view_count || 0) - (a.view_count || 0));
      const highlights = sorted
        .slice(0, 3)
        .map(it => it.summary_zh || it.translation_zh || (it.text || '').slice(0, 120))
        .filter(Boolean);
      return {
        handle,
        layer: b.layer || '',
        function: b.function || '',
        count: sorted.length,
        highlights,
        items: sorted,
      };
    })
    .filter(x => x.count > 0);
}

export async function buildReport() {
  const cfg = loadConfig();
  const date = reportDateStr();
  const todayDir = path.join(DATA, 'processed', date);
  const cls  = (await loadJson(path.join(todayDir, '_all_classified.json'), {})) || {};
  const cons = (await loadJson(path.join(todayDir, '_consensus.json'), {})) || {};
  const pos  = (await loadJson(path.join(todayDir, '_position_diffs.json'), {})) || {};
  const risk = (await loadJson(path.join(todayDir, '_risk.json'),
                               { red_flags: [], generic_risk_posts: [] })) || {};
  const bt   = (await loadJson(path.join(todayDir, '_backtest.json'), {})) || {};

  const weeklyLayers = new Set(Object.keys(cfg.pipeline.layer_overrides || {}));
  const flat = [];
  for (const items of Object.values(cls)) {
    for (const t of items) {
      if (!weeklyLayers.has(t.layer)) flat.push(t);
    }
  }
  flat.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  const allItems = Object.values(cls).flat();
  const missingTranslations = allItems.filter(t => !(t.translation_zh || t.summary_zh)).length;
  if (String(process.env.LLM_CLASSIFIER_ENABLED || '').toLowerCase() === 'true' && missingTranslations > 0) {
    logger.warn(`report has ${missingTranslations}/${allItems.length} tweets without LLM translation; markdown/html will fall back to original text`);
  }

  const weekly = buildWeekly(cfg, cls);
  const bloggerSummaries = buildBloggerSummaries(cfg, cls);

  const env = nunjucks.configure(__dirname, { autoescape: false, throwOnUndefined: false });
  // Enable iterating `for k, v in obj` over plain objects
  env.addFilter('items', (obj) => Object.entries(obj));

  // Convert objects to entries arrays for `{% for k, v in obj %}`
  const ctx = {
    date,
    generated_at: nowUtc().toISOString().replace(/\..+$/, ''),
    window_hours: Number(process.env.PIPELINE_WINDOW_HOURS || cfg.pipeline.window_hours),
    blogger_count: cfg.bloggers.length,
    tweet_count: flat.length,
    topic_heat: cons.topic_heat || [],
    consensus_long: cons.consensus_long || [],
    consensus_short: cons.consensus_short || [],
    divergence: cons.divergence || [],
    position_diffs: Object.entries(pos),
    risk,
    backtest: Object.entries(bt),
    top_tweets: flat,
    blogger_summaries: bloggerSummaries,
    weekly: Object.entries(weekly),
    weekly_has_any: Object.keys(weekly).length > 0,
    disclaimer: cfg.disclaimer,
  };

  const tplPath = path.join(__dirname, 'report_template.njk');
  const md = env.renderString(await fs.readFile(tplPath, 'utf8'), ctx);
  const htmlTplPath = path.join(__dirname, 'report_template.html.njk');
  const html = env.renderString(await fs.readFile(htmlTplPath, 'utf8'), ctx);

  const outPath = path.join(DATA, 'reports', `daily_${compactDateStr(date)}.md`);
  const htmlPath = path.join(DATA, 'reports', `daily_${compactDateStr(date)}.html`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, md, 'utf8');
  await fs.writeFile(htmlPath, html, 'utf8');
  logger.info(`report written -> ${outPath}`);
  logger.info(`html report written -> ${htmlPath} (weekly section: ${ctx.weekly_has_any ? 'ON' : 'off'})`);
  return { md, html, path: outPath, htmlPath };
}

function htmlReportUrl(htmlPath) {
  const rawBase = (process.env.REPORT_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const base = rawBase && !rawBase.endsWith('/reports') ? `${rawBase}/reports` : rawBase;
  if (!base || !htmlPath) return '';
  return `${base}/${path.basename(htmlPath)}`;
}

export async function pushLark(md, { htmlPath } = {}) {
  const hook = (process.env.LARK_WEBHOOK || '').trim();
  if (!hook) return;
  const title = `📊 FinTwit 每日简报 — ${todayUtcStr()}`;
  const url = htmlReportUrl(htmlPath);
  const content = url ? `**HTML 页面**：[打开日报](${url})\n\n${md}` : md;
  const payload = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: title } },
      elements: [{ tag: 'markdown', content: content.slice(0, 30000) }],
    },
  };
  try {
    const r = await axios.post(hook, payload, { timeout: 10000 });
    logger.info(`lark push status=${r.status}`);
  } catch (e) {
    logger.warn(`lark push failed: ${e.message}`);
  }
}

export async function pushSlack(md) {
  const hook = (process.env.SLACK_WEBHOOK || '').trim();
  if (!hook) return;
  try {
    const r = await axios.post(hook, { text: md.slice(0, 30000) }, { timeout: 10000 });
    logger.info(`slack push status=${r.status}`);
  } catch (e) {
    logger.warn(`slack push failed: ${e.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildReport().then(({ md, htmlPath }) => Promise.all([pushLark(md, { htmlPath }), pushSlack(md)]))
    .catch(e => { logger.error(e); process.exit(1); });
}
