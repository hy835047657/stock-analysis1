// Skill: positionTracker
// Maintains ledger.json: {handle: {ticker: [{date, stance, conviction, url}]}}
// Diffs today's mentions vs prior ledger -> new / reinforced / stale.
import path from 'node:path';
import {
  loadConfig, loadJson, saveJson, DATA, todayUtcStr, logger,
} from '../../common/index.js';

const LEDGER_PATH = path.join(DATA, 'processed', 'ledger.json');

export async function updateLedger() {
  const cfg = loadConfig();
  const trackHandles = new Set(cfg.bloggers.filter(b => b.track_positions).map(b => b.handle));
  const today = todayUtcStr();
  const outDir = path.join(DATA, 'processed', today);
  const cls = (await loadJson(path.join(outDir, '_all_classified.json'), {})) || {};
  const ledger = (await loadJson(LEDGER_PATH, {})) || {};

  const diffs = {};

  for (const [h, items] of Object.entries(cls)) {
    if (!trackHandles.has(h)) continue;

    const prior = ledger[h] || {};
    const todayMentions = {};
    // collect today's mentions per ticker, keep max conviction
    for (const it of items) {
      if (!it.tickers || it.tickers.length === 0) continue;
      if (!['LONG', 'SHORT'].includes(it.stance)) continue;
      for (const tk of it.tickers) {
        const t = tk.replace(/^\$/, '');
        const cur = todayMentions[t];
        if (!cur || it.conviction > cur.conviction) {
          todayMentions[t] = {
            stance: it.stance,
            conviction: it.conviction,
            url: it.url,
          };
        }
      }
    }

    const newMentions = [];
    const reinforced = [];

    for (const [tk, m] of Object.entries(todayMentions)) {
      const hist = prior[tk] || [];
      const last = hist[hist.length - 1];
      if (!last) {
        newMentions.push({ ticker: tk, ...m });
      } else if (m.conviction > (last.conviction || 0)) {
        reinforced.push({ ticker: tk, from: last.conviction, to: m.conviction });
      }
      hist.push({ date: today, ...m });
      prior[tk] = hist.slice(-20); // keep last 20 entries
    }

    ledger[h] = prior;
    diffs[h] = { new: newMentions, reinforced };
  }

  await saveJson(LEDGER_PATH, ledger);
  await saveJson(path.join(outDir, '_position_diffs.json'), diffs);
  logger.info(`position ledger updated for ${Object.keys(diffs).length} bloggers`);
  return diffs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  updateLedger().catch(e => { logger.error(e); process.exit(1); });
}
