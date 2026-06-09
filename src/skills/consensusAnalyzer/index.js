// Skill: consensusAnalyzer
// Compute weighted long/short scores per ticker across all bloggers.
import path from 'node:path';
import {
  loadConfig, loadJson, saveJson, DATA, todayUtcStr, logger,
} from '../../common/index.js';

export async function analyze() {
  const cfg = loadConfig();
  const weightOf = Object.fromEntries(cfg.bloggers.map(b => [b.handle, b.weight ?? 1.0]));
  const today = todayUtcStr();
  const outDir = path.join(DATA, 'processed', today);
  const cls = (await loadJson(path.join(outDir, '_all_classified.json'), {})) || {};

  // per-ticker aggregation
  const agg = {}; // {ticker: {long_w, short_w, neutral_w, by: [{handle,stance,url}], topics: Set}}
  const topicCount = {}; // {topic: {count, bloggers: Set}}

  for (const [h, items] of Object.entries(cls)) {
    const w = weightOf[h] ?? 1.0;
    for (const it of items) {
      if (it.topic && it.topic !== 'OTHER') {
        topicCount[it.topic] ??= { count: 0, bloggers: new Set() };
        topicCount[it.topic].count += 1;
        topicCount[it.topic].bloggers.add(h);
      }
      for (const tk of it.tickers || []) {
        const t = tk.replace(/^\$/, '');
        agg[t] ??= { long_w: 0, short_w: 0, neutral_w: 0, by: [], topics: new Set() };
        if (it.stance === 'LONG')  agg[t].long_w  += w;
        if (it.stance === 'SHORT') agg[t].short_w += w;
        if (it.stance === 'NEUTRAL') agg[t].neutral_w += w;
        agg[t].by.push({ handle: h, stance: it.stance, url: it.url });
        if (it.topic) agg[t].topics.add(it.topic);
      }
    }
  }

  const longCons = [];
  const shortCons = [];
  const divergence = [];

  for (const [tk, a] of Object.entries(agg)) {
    const longTriggered  = a.long_w  > a.short_w * 1.5 && a.long_w  > 0;
    const shortTriggered = a.short_w > a.long_w  * 1.5 && a.short_w > 0;

    if (longTriggered) {
      const supporters = a.by.filter(x => x.stance === 'LONG');
      const nUnique = new Set(supporters.map(x => x.handle)).size;
      if (nUnique < 2) continue;
      longCons.push({
        ticker: tk, score: Number(a.long_w.toFixed(2)),
        n_bloggers: nUnique, by: supporters,
      });
    } else if (shortTriggered) {
      const supporters = a.by.filter(x => x.stance === 'SHORT');
      const nUnique = new Set(supporters.map(x => x.handle)).size;
      if (nUnique < 2) continue;
      shortCons.push({
        ticker: tk, score: Number(a.short_w.toFixed(2)),
        n_bloggers: nUnique, by: supporters,
      });
    } else if (a.long_w > 0 && a.short_w > 0) {
      const allHandles = new Set(a.by.map(x => x.handle));
      if (allHandles.size < 2) continue;
      divergence.push({
        ticker: tk,
        long_w: Number(a.long_w.toFixed(2)),
        short_w: Number(a.short_w.toFixed(2)),
        n_bloggers: allHandles.size,
      });
    }
  }

  longCons.sort((a, b) => b.score - a.score);
  shortCons.sort((a, b) => b.score - a.score);

  const topicHeat = Object.entries(topicCount)
    .map(([topic, { count, bloggers }]) => ({
      topic, count, bloggers: [...bloggers].sort(),
    }))
    .sort((a, b) => b.count - a.count);

  const out = {
    consensus_long: longCons,
    consensus_short: shortCons,
    divergence,
    topic_heat: topicHeat,
  };
  await saveJson(path.join(outDir, '_consensus.json'), out);
  logger.info(`consensus: long=${longCons.length}, short=${shortCons.length}, divergence=${divergence.length}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  analyze().catch(e => { logger.error(e); process.exit(1); });
}
