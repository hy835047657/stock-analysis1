// Skill: riskAlert
// Surface tickers mentioned by L6_risk bloggers; cross-ref with consensus_long.
import path from 'node:path';
import {
  loadConfig, loadJson, saveJson, DATA, todayUtcStr, logger,
} from '../../common/index.js';

function reportDateStr() {
  return process.env.REPORT_DATE || todayUtcStr();
}

export async function analyze() {
  const cfg = loadConfig();
  const today = reportDateStr();
  const outDir = path.join(DATA, 'processed', today);
  const cls  = (await loadJson(path.join(outDir, '_all_classified.json'), {})) || {};
  const cons = (await loadJson(path.join(outDir, '_consensus.json'), {})) || {};
  const longSet = new Set((cons.consensus_long || []).map(c => c.ticker));

  const riskHandles = new Set(
    cfg.bloggers.filter(b => b.layer === 'L6_risk').map(b => b.handle)
  );

  const flagsByTicker = {}; // {ticker: {risk_sources: [...]}}
  const generic = [];

  for (const [h, items] of Object.entries(cls)) {
    const fromRiskLayer = riskHandles.has(h);
    for (const it of items) {
      // generic risk chatter: any blogger, RISK_FLAG stance, no specific ticker
      if (it.stance === 'RISK_FLAG' && (!it.tickers || it.tickers.length === 0)) {
        const snippetZh = it.translation_zh || it.summary_zh || it.text || '';
        generic.push({
          handle: h,
          url: it.url,
          snippet: (it.text || '').slice(0, 200),
          snippet_zh: snippetZh.slice(0, 260),
        });
      }
      // ticker-bound red flags: must come from L6 layer
      if (!fromRiskLayer) continue;
      for (const tk of it.tickers || []) {
        const t = tk.replace(/^\$/, '');
        const snippetZh = it.translation_zh || it.summary_zh || it.text || '';
        flagsByTicker[t] ??= { ticker: t, risk_sources: [], in_long_consensus: longSet.has(t) };
        flagsByTicker[t].risk_sources.push({
          handle: h,
          stance: it.stance,
          url: it.url,
          snippet: (it.text || '').slice(0, 200),
          snippet_zh: snippetZh.slice(0, 260),
        });
      }
    }
  }

  const redFlags = Object.values(flagsByTicker).sort((a, b) => {
    if (a.in_long_consensus !== b.in_long_consensus) return a.in_long_consensus ? -1 : 1;
    return b.risk_sources.length - a.risk_sources.length;
  });

  const out = {
    red_flags: redFlags,
    generic_risk_posts: generic.slice(0, 10),
  };
  await saveJson(path.join(outDir, '_risk.json'), out);
  logger.info(`risk: red_flags=${redFlags.length}, generic=${generic.length}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  analyze().catch(e => { logger.error(e); process.exit(1); });
}
