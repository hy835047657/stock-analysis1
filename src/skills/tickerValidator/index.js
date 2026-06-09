// Skill: tickerValidator
// Validates cashtags via yahoo-finance2 + blacklist/whitelist + cache.
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
import {
  loadConfig, loadJson, saveJson, DATA, nowUtc, logger,
} from '../../common/index.js';

// yahoo-finance2 v2.x exports a class; one shared instance suffices.
const yf = new YahooFinance();
try { yf.suppressNotices?.(['ripHistorical', 'yahooSurvey']); } catch {}

const CACHE_PATH = path.join(DATA, 'cache', 'ticker_cache.json');

async function yfLookup(symbol) {
  try {
    const q = await yf.quote(symbol, {}, { validateResult: false });
    if (q && (q.regularMarketPrice != null || q.regularMarketPreviousClose != null)) {
      return { valid: true, name: q.shortName || q.longName || null };
    }
    return { valid: false, name: null };
  } catch (e) {
    logger.debug(`yfinance lookup failed for ${symbol}: ${e.message}`);
    return { valid: false, name: null };
  }
}

export async function validate(symbols) {
  const cfg = loadConfig();
  const vcfg = cfg.pipeline.ticker_validation || {};
  if (vcfg.enabled === false) {
    return Object.fromEntries(symbols.map(s => [s.toUpperCase().replace(/^\$/, ''), true]));
  }

  const alwaysValid = new Set(vcfg.always_valid || []);
  const alwaysInvalid = new Set(vcfg.always_invalid || []);
  const ttlMs = (vcfg.cache_ttl_hours ?? 168) * 3600 * 1000;
  const cache = (await loadJson(CACHE_PATH, {})) || {};
  const now = nowUtc();
  const result = {};
  let dirty = false;

  for (const raw of symbols) {
    const s = raw.toUpperCase().replace(/^\$/, '');
    if (alwaysInvalid.has(s)) { result[s] = false; continue; }
    if (alwaysValid.has(s))   { result[s] = true;  continue; }

    const entry = cache[s];
    if (entry) {
      const checked = new Date(entry.checked_at);
      if (!isNaN(checked.getTime()) && (now - checked) < ttlMs) {
        result[s] = !!entry.valid;
        continue;
      }
    }

    const { valid, name } = await yfLookup(s);
    cache[s] = { valid, name, checked_at: now.toISOString() };
    dirty = true;
    result[s] = valid;
    logger.info(`yfinance check $${s}: ${valid ? 'VALID' : 'INVALID'}${name ? ` (${name})` : ''}`);
  }

  if (dirty) await saveJson(CACHE_PATH, cache);
  return result;
}

export async function filterTickers(rawCashtags) {
  const bare = rawCashtags.map(s => s.replace(/^\$/, ''));
  const verdict = await validate(bare);
  return bare.filter(s => verdict[s]).map(s => `$${s}`);
}

// CLI: node src/skills/tickerValidator/index.js NVDA NASA SIVE
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const syms = (args.length ? args : ['NVDA', 'NASA', 'AAPL', 'CEO', 'SIVE'])
    .map(a => a.toUpperCase().replace(/^\$/, ''));
  validate(syms).then(v => { console.log(v); });
}
