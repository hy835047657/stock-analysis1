// Skill: tweetFetcher
// Fetch last-N-hours tweets for each blogger via TwexAPI.
// Output: data/raw/{date}/{handle}.json
import path from 'node:path';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import {
  loadConfig, loadJson, nowUtc, hoursAgo, todayUtcStr, saveJson, sleep, logger, DATA,
} from '../../common/index.js';

const TWEX_BASE = 'https://api.twexapi.io/twitter';

const http = axios.create({ timeout: 30000 });
axiosRetry(http, {
  retries: 3,
  retryDelay: (count) => Math.min(2000 * 2 ** count, 20000),
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    (err.response && err.response.status >= 500),
});

async function fetchOne(handle, limit, token) {
  const url = `${TWEX_BASE}/${handle}/tweets-replies/${limit}`;
  const { data } = await http.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // TwexAPI response shape: list or dict containing tweets
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['data', 'tweets', 'results']) {
      if (Array.isArray(data[k])) return data[k];
    }
    return [data];
  }
  return [];
}

function windowHoursFor(blogger, cfg) {
  const overrides = cfg.pipeline.layer_overrides || {};
  const defaultWindow = Number(process.env.PIPELINE_WINDOW_HOURS || cfg.pipeline.window_hours);
  return Number(overrides[blogger.layer] ?? defaultWindow);
}

function reuseRawEnabled() {
  return String(process.env.TWEX_REUSE_RAW || '').toLowerCase() === 'true';
}

export async function fetchAll() {
  const cfg = loadConfig();
  const token = process.env.TWEX_API_KEY;
  if (!token) throw new Error('TWEX_API_KEY not set');

  const defaultWindow = cfg.pipeline.window_hours;
  const limit = cfg.pipeline.per_account_limit;
  const minViews = cfg.pipeline.min_view_count ?? 0;
  const dateDir = path.join(DATA, 'raw', todayUtcStr());

  const summary = {};
  for (const b of cfg.bloggers) {
    const h = b.handle;
    const win = windowHoursFor(b, cfg);
    const cutoff = hoursAgo(win);
    const outPath = path.join(dateDir, `${h}.json`);

    let raw;
    const cached = reuseRawEnabled() ? await loadJson(outPath, null) : null;
    if (Array.isArray(cached)) {
      raw = cached;
      logger.info(`[${h}] reusing cached raw data from ${outPath}`);
    } else {
      try {
        raw = await fetchOne(h, limit, token);
      } catch (e) {
        logger.error({ handle: h, err: e.message }, 'fetch failed');
        summary[h] = { error: e.message, count: 0, window_hours: win, layer: b.layer };
        continue;
      }
    }

    const filtered = [];
    for (const t of raw) {
      const ts = t.created_at_datetime || t.created_at;
      let dt;
      try {
        dt = new Date(String(ts).replace('Z', '+00:00'));
        if (isNaN(dt.getTime())) continue;
      } catch { continue; }
      if (dt < cutoff) continue;

      let vc = 0;
      try { vc = parseInt(t.view_count || 0, 10); }
      catch { vc = 0; }
      if (isNaN(vc)) vc = 0;
      t.view_count = vc;
      if (vc < minViews) continue;

      t._window_hours = win;
      t._layer = b.layer;
      filtered.push(t);
    }

    await saveJson(outPath, filtered);
    summary[h] = {
      count: filtered.length,
      path: outPath,
      window_hours: win,
      layer: b.layer,
    };
    const tag = win > defaultWindow ? ' [WEEKLY]' : '';
    logger.info(`[${h}]${tag} kept ${filtered.length}/${raw.length} tweets in last ${win}h`);
    await sleep(500);
  }
  await saveJson(path.join(dateDir, '_summary.json'), summary);
  return summary;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAll().catch(e => { logger.error(e); process.exit(1); });
}
