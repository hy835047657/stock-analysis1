// Skill: backtest
// For each ticker in the ledger, compute forward returns since first mention.
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
import {
  loadConfig, loadJson, saveJson, DATA, todayUtcStr, logger, nowUtc,
} from '../../common/index.js';

const yf = new YahooFinance();
try { yf.suppressNotices?.(['ripHistorical', 'yahooSurvey']); } catch {}

const TICKER_FIX = {
  SIVE: 'SIVE.ST',
  XFAB: 'XFAB.PA',
  SOI:  'SOI.PA',
};

const HORIZONS = [1, 7, 30, 90, 180];

function daysBetween(d1, d2) {
  return Math.floor((d2 - d1) / (24 * 3600 * 1000));
}

async function fetchPrice(symbol, from) {
  const fixed = TICKER_FIX[symbol] || symbol;
  try {
    const rows = await yf.historical(fixed, {
      period1: from,
      period2: nowUtc(),
      interval: '1d',
    });
    return rows;
  } catch (e) {
    logger.debug(`historical fetch failed ${fixed}: ${e.message}`);
    return null;
  }
}

function closestClose(rows, target) {
  if (!rows || rows.length === 0) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const r of rows) {
    const delta = Math.abs(r.date - target);
    if (delta < bestDelta) { best = r; bestDelta = delta; }
  }
  return best ? best.close : null;
}

export async function scoreAll() {
  const cfg = loadConfig();
  const ledger = (await loadJson(path.join(DATA, 'processed', 'ledger.json'), {})) || {};
  const today = todayUtcStr();
  const outDir = path.join(DATA, 'processed', today);
  const result = {};

  for (const b of cfg.bloggers) {
    const h = b.handle;
    const positions = ledger[h];
    if (!positions || Object.keys(positions).length === 0) {
      result[h] = { n: 0, win_rate_30d: null, calls: [] };
      continue;
    }
    const calls = [];
    for (const [tk, hist] of Object.entries(positions)) {
      const first = hist[0];
      if (!first) continue;
      const startDate = new Date(first.date + 'T00:00:00Z');
      // skip calls less than 14 days old (not resolvable)
      if (daysBetween(startDate, nowUtc()) < 14) continue;
      const rows = await fetchPrice(tk, startDate);
      if (!rows || rows.length === 0) continue;
      const entry = closestClose(rows, startDate);
      if (entry == null) continue;
      const rets = {};
      for (const days of HORIZONS) {
        const target = new Date(startDate.getTime() + days * 24 * 3600 * 1000);
        if (target > nowUtc()) { rets[`ret_${days}d`] = null; continue; }
        const px = closestClose(rows, target);
        rets[`ret_${days}d`] = px ? Number(((px - entry) / entry).toFixed(4)) : null;
      }
      calls.push({
        ticker: tk,
        stance: first.stance,
        first_seen: first.date,
        entry,
        ...rets,
      });
    }
    const resolved = calls.filter(c => c.ret_30d != null);
    let wr30 = null;
    if (resolved.length > 0) {
      const wins = resolved.filter(c =>
        (c.stance === 'LONG'  && c.ret_30d > 0) ||
        (c.stance === 'SHORT' && c.ret_30d < 0)).length;
      wr30 = Number((wins / resolved.length * 100).toFixed(1));
    }
    result[h] = { n: calls.length, win_rate_30d: wr30, calls };
    logger.info(`[${h}] backtested ${calls.length} calls, 30d win-rate=${wr30 ?? 'n/a'}`);
  }

  await saveJson(path.join(outDir, '_backtest.json'), result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scoreAll().catch(e => { logger.error(e); process.exit(1); });
}
