// Dry run WITH mock data: inject synthetic tweets for 4 bloggers so every
// report section has visible content. Still no TwexAPI / yfinance calls.
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  loadConfig, saveJson, DATA, todayUtcStr, logger, nowUtc,
} from './src/common/index.js';
import { classifyAll }  from './src/skills/viewClassifier/index.js';
import { updateLedger } from './src/skills/positionTracker/index.js';
import { analyze as runConsensus } from './src/skills/consensusAnalyzer/index.js';
import { analyze as runRisk }      from './src/skills/riskAlert/index.js';
import { buildReport }  from './src/agent/reporter.js';

function fakeTweet({ id, text, hoursAgo = 2, views = 50000, faves = 500, layer = 'L1_industry' }) {
  const ts = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  return {
    tweet_id: String(id),
    full_text: text,
    created_at_datetime: ts,
    view_count: views,
    favorite_count: faves,
    _window_hours: 24,
    _layer: layer,
  };
}

async function stubWithMockData() {
  const cfg = loadConfig();
  const dateDir = path.join(DATA, 'raw', todayUtcStr());
  await fs.mkdir(dateDir, { recursive: true });

  const mocks = {
    // L1: Beth — bullish $NVDA + $AVGO
    Beth_Kindig: [
      fakeTweet({ id: 1001, layer: 'L1_industry',
        text: 'Long $NVDA and $AVGO into year end — Blackwell ramp accelerating, structural thesis intact, 3x potential over 24 months',
        views: 320000, faves: 4500 }),
      fakeTweet({ id: 1002, layer: 'L1_industry',
        text: 'Added more $AVGO this week, CPO photonics narrative is just beginning' }),
    ],
    // L2: aleabit — bullish $AVGO (overlap with Beth → consensus)
    aleabitoreddit: [
      fakeTweet({ id: 2001, layer: 'L2_single_stock',
        text: 'Loaded $AVGO on the dip. Chokepoint thesis on optics is structural. PT 5x current.',
        views: 280000, faves: 6200 }),
      fakeTweet({ id: 2002, layer: 'L2_single_stock',
        text: 'Selling some $TSLA, trimmed position. Demand cycle softening.', views: 150000 }),
    ],
    // L5: Kobeissi — generic risk chatter (no specific ticker)
    KobeissiLetter: [
      fakeTweet({ id: 5001, layer: 'L5_market_tape',
        text: 'BREAKING: SEC announces new probe into crypto exchanges. Fraud allegations under review.',
        views: 850000, faves: 12000 }),
    ],
    // L6: muddywaters — short $AVGO (overlaps with consensus_long → highest-priority red flag)
    muddywatersre: [
      fakeTweet({ id: 6001, layer: 'L6_risk',
        text: 'We are SHORT $AVGO. Full short report tomorrow — accounting irregularities in services segment, going concern risk.',
        views: 1200000, faves: 18000 }),
    ],
  };

  const summary = {};
  for (const b of cfg.bloggers) {
    const tweets = mocks[b.handle] || [];
    const outPath = path.join(dateDir, `${b.handle}.json`);
    await saveJson(outPath, tweets);
    summary[b.handle] = {
      count: tweets.length, path: outPath,
      window_hours: 24, layer: b.layer, mocked: true,
    };
  }
  await saveJson(path.join(dateDir, '_summary.json'), summary);
  logger.info(`mocked ${Object.values(mocks).flat().length} synthetic tweets across ${Object.keys(mocks).length} bloggers`);
}

// Patch tickerValidator to skip yfinance network lookup during dry run —
// just trust everything except blacklist.
async function patchValidatorForDryRun() {
  const mod = await import('./src/skills/tickerValidator/index.js');
  const cfg = loadConfig();
  const blacklist = new Set(cfg.pipeline.ticker_validation.always_invalid || []);
  // monkey-patch via cache: prime the cache so no network call is made
  const cachePath = path.join(DATA, 'cache', 'ticker_cache.json');
  const cache = {};
  const now = nowUtc().toISOString();
  // common tickers used in mocks
  for (const sym of ['NVDA','AVGO','TSLA','AAPL']) {
    cache[sym] = { valid: true, name: `Mock ${sym}`, checked_at: now };
  }
  for (const sym of blacklist) {
    cache[sym] = { valid: false, name: null, checked_at: now };
  }
  await saveJson(cachePath, cache);
  logger.info(`primed ticker cache with ${Object.keys(cache).length} entries (no network calls)`);
}

async function main() {
  logger.info('=== DRY RUN (MOCK DATA, no TwexAPI, no yfinance network) ===');
  await stubWithMockData();
  await patchValidatorForDryRun();
  await classifyAll();
  await updateLedger();
  await runConsensus();
  await runRisk();
  const { md, path: rpath } = await buildReport();
  logger.info(`=== DRY RUN complete · report at ${rpath} ===`);
  logger.info(`report length: ${md.length} chars`);
}

main().catch(e => { logger.error({ err: e.message, stack: e.stack }, 'dry run failed'); process.exit(1); });
