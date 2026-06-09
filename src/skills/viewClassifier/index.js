// Skill: viewClassifier
// Classify each tweet into stance / topic / tickers / conviction.
import path from 'node:path';
import crypto from 'node:crypto';
import axios from 'axios';
import {
  loadConfig, loadJson, saveJson, DATA, todayUtcStr,
  extractCashtags, classifyPostKind, tweetUrl, logger,
} from '../../common/index.js';
import { validate as validateTickers } from '../tickerValidator/index.js';

const TOPIC_RULES = {
  PHOTONICS: ['photonics', 'SiPh', 'CPO', 'laser', 'EML', 'NVLink'],
  AI_SEMI:   ['GPU', 'Nvidia', 'Blackwell', 'HBM', 'wafer', 'CoWoS', 'Marvell', 'Broadcom'],
  ENERGY:    ['uranium', 'oil', 'tanker', 'LNG', 'gas', 'WTI', 'Brent'],
  MACRO:     ['Fed', 'rates', 'CPI', 'PCE', 'deficit', 'Treasury', 'DXY', 'yield'],
  CRYPTO:    ['BTC', 'ETH', 'bitcoin', 'ethereum', 'miner'],
};

export function topicOf(text) {
  const t = (text || '').toLowerCase();
  for (const [topic, kws] of Object.entries(TOPIC_RULES)) {
    if (kws.some(kw => t.includes(kw.toLowerCase()))) return topic;
  }
  return 'OTHER';
}

export function stanceOf(text, cfg) {
  const t = (text || '').toLowerCase();
  const kw = cfg.pipeline.position_signal_keywords;
  const flags = cfg.pipeline.red_flag_keywords;
  if (flags.some(f => t.includes(f.toLowerCase()))) return 'RISK_FLAG';
  const longHits  = kw.long.filter(w => t.includes(w)).length;
  const shortHits = kw.short.filter(w => t.includes(w)).length;
  if (longHits  > shortHits && longHits  > 0) return 'LONG';
  if (shortHits > longHits  && shortHits > 0) return 'SHORT';
  return 'NEUTRAL';
}

export function convictionOf(t) {
  const vc = Number(t.view_count) || 0;
  const fc = Number(t.favorite_count) || 0;
  const text = (t.full_text || t.text || '').toLowerCase();
  const strong = ['chokepoint', 'structural', 'thesis', 'highest conviction',
                  '2x', '3x', '5x', '10x', '$1t', 'trillion'];
  let base = 1;
  if (vc > 100000) base += 1;
  if (vc > 500000) base += 1;
  if (fc > 1000)   base += 1;
  if (strong.some(w => text.includes(w))) base += 1;
  return Math.min(base, 5);
}

function llmEnabled() {
  return String(process.env.LLM_CLASSIFIER_ENABLED || '').toLowerCase() === 'true';
}

function cacheKeyFor(item) {
  const id = item.tweet_id || `${item.handle}:${item.created_at}`;
  const hash = crypto.createHash('sha1').update(item.text || '').digest('hex').slice(0, 12);
  return `${item.handle}:${id}:${hash}`;
}

function clampConviction(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeEnum(value, allowed, fallback) {
  const v = String(value || '').toUpperCase();
  return allowed.includes(v) ? v : fallback;
}

function extractResponseText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.content === 'string') return data.content;
  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      for (const c of item.content || []) {
        if (typeof c.text === 'string') parts.push(c.text);
        if (typeof c.output_text === 'string') parts.push(c.output_text);
      }
    }
    if (parts.length) return parts.join('\n');
  }
  const choice = data.choices?.[0]?.message?.content;
  if (typeof choice === 'string') return choice;
  return '';
}

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch {}
  return null;
}

async function callClassifierLLM(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const system = [
    '你是一个金融社媒观点分类器，只做信息整理，不提供投资建议。',
    '请分析输入的英文 X/Twitter 推文，返回严格 JSON，不要输出 Markdown。',
    '字段：stance 只能是 LONG/SHORT/NEUTRAL/RISK_FLAG；topic 只能是 PHOTONICS/AI_SEMI/ENERGY/MACRO/CRYPTO/OTHER；conviction 是 1-5 的整数；summary_zh 是一句 35 字以内中文摘要；translation_zh 是 100 字以内忠实中文翻译。',
    '如果语气不明确、只是新闻转述或没有明确交易观点，stance 用 NEUTRAL。',
  ].join('\n');
  const user = JSON.stringify(input, null, 2);

  const isResponsesEndpoint = /\/responses\/?$/.test(baseURL);
  const payload = isResponsesEndpoint
    ? {
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_output_tokens: 4000,
      }
    : {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 4000,
      };

  const { data } = await axios.post(baseURL, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: Number(process.env.LLM_CLASSIFIER_TIMEOUT_MS || 120000),
  });
  return parseJsonLoose(extractResponseText(data));
}

async function enrichWithLLM(item) {
  try {
    const out = await callClassifierLLM({
      handle: item.handle,
      layer: item.layer,
      created_at: item.created_at,
      tickers: item.tickers,
      rule_guess: {
        topic: item.topic,
        stance: item.stance,
        conviction: item.conviction,
      },
      text: item.text,
    });
    if (!out || typeof out !== 'object') throw new Error('LLM returned non-JSON output');
    return {
      ...item,
      topic: normalizeEnum(out.topic, ['PHOTONICS', 'AI_SEMI', 'ENERGY', 'MACRO', 'CRYPTO', 'OTHER'], item.topic),
      stance: normalizeEnum(out.stance, ['LONG', 'SHORT', 'NEUTRAL', 'RISK_FLAG'], item.stance),
      conviction: clampConviction(out.conviction, item.conviction),
      summary_zh: String(out.summary_zh || '').slice(0, 240),
      translation_zh: String(out.translation_zh || '').slice(0, 1000),
      classifier: 'llm',
    };
  } catch (e) {
    logger.warn({ handle: item.handle, tweet_id: item.tweet_id, err: e.message }, 'LLM classifier failed; using rule result');
    return {
      ...item,
      summary_zh: '',
      translation_zh: '',
      classifier: 'rules',
      classifier_error: e.message,
    };
  }
}

async function enrichBatchWithLLM(items) {
  if (items.length === 0) return [];
  try {
    const out = await callClassifierLLM({
      task: 'classify_and_translate_tweets',
      tweets: items.map((item, index) => ({
        index,
        handle: item.handle,
        layer: item.layer,
        created_at: item.created_at,
        tickers: item.tickers,
        rule_guess: {
          topic: item.topic,
          stance: item.stance,
          conviction: item.conviction,
        },
        text: item.text,
      })),
      output_contract: {
        results: [{
          index: 0,
          stance: 'LONG|SHORT|NEUTRAL|RISK_FLAG',
          topic: 'PHOTONICS|AI_SEMI|ENERGY|MACRO|CRYPTO|OTHER',
          conviction: 'integer 1-5',
          summary_zh: '35 字以内中文摘要',
          translation_zh: '100 字以内忠实中文翻译',
        }],
      },
    });
    const rows = Array.isArray(out?.results) ? out.results : (Array.isArray(out) ? out : []);
    const byIndex = new Map(rows.map(r => [Number(r.index), r]));
    return items.map((item, index) => {
      const row = byIndex.get(index);
      if (!row) return { ...item, classifier: 'rules', classifier_error: 'missing batch result' };
      return {
        ...item,
        topic: normalizeEnum(row.topic, ['PHOTONICS', 'AI_SEMI', 'ENERGY', 'MACRO', 'CRYPTO', 'OTHER'], item.topic),
        stance: normalizeEnum(row.stance, ['LONG', 'SHORT', 'NEUTRAL', 'RISK_FLAG'], item.stance),
        conviction: clampConviction(row.conviction, item.conviction),
        summary_zh: String(row.summary_zh || '').slice(0, 240),
        translation_zh: String(row.translation_zh || '').slice(0, 1000),
        classifier: 'llm',
      };
    });
  } catch (e) {
    logger.warn({ count: items.length, err: e.message }, 'LLM batch classifier failed; falling back to per-tweet');
    const enriched = [];
    for (const item of items) {
      enriched.push(await enrichWithLLM(item));
    }
    return enriched;
  }
}

async function enrichItemsWithLLM(items) {
  const cachePath = path.join(DATA, 'cache', 'llm-classifier.json');
  const cache = (await loadJson(cachePath, {})) || {};
  const batchSize = Math.max(1, Number(process.env.LLM_CLASSIFIER_BATCH_SIZE || 20));
  const concurrency = Math.max(1, Number(process.env.LLM_CLASSIFIER_CONCURRENCY || 2));
  const enriched = new Array(items.length);
  const missing = [];

  items.forEach((item, index) => {
    const key = cacheKeyFor(item);
    if (cache[key]) {
      enriched[index] = { ...item, ...cache[key], classifier_cached: true };
    } else {
      missing.push({ item, index, key });
    }
  });

  const batches = [];
  for (let i = 0; i < missing.length; i += batchSize) {
    batches.push(missing.slice(i, i + batchSize));
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (next < batches.length) {
      const batchIndex = next++;
      const batch = batches[batchIndex];
      const result = await enrichBatchWithLLM(batch.map(row => row.item));
      result.forEach((item, offset) => {
        const row = batch[offset];
        enriched[row.index] = item;
        cache[row.key] = {
          topic: item.topic,
          stance: item.stance,
          conviction: item.conviction,
          summary_zh: item.summary_zh,
          translation_zh: item.translation_zh,
          classifier: item.classifier,
          classifier_error: item.classifier_error,
        };
      });
      logger.info(`LLM classified batch ${batchIndex + 1}/${batches.length} (${batch.length} tweets)`);
    }
  });
  await Promise.all(workers);

  if (missing.length) {
    await saveJson(cachePath, cache);
  }
  logger.info(`LLM cache hit ${items.length - missing.length}/${items.length}`);
  return enriched;
}

export async function classifyAll() {
  const cfg = loadConfig();
  const dateDir = path.join(DATA, 'raw', todayUtcStr());
  const outDir  = path.join(DATA, 'processed', todayUtcStr());
  const cashtagPat = cfg.pipeline.cashtag_regex;

  // Pre-collect all unique cashtags, batch-validate once
  const allTags = new Set();
  const bloggerData = {};
  for (const b of cfg.bloggers) {
    const h = b.handle;
    const tweets = (await loadJson(path.join(dateDir, `${h}.json`), [])) || [];
    bloggerData[h] = { b, tweets };
    for (const t of tweets) {
      const text = t.full_text || t.text || '';
      for (const c of extractCashtags(text, cashtagPat)) {
        allTags.add(c.replace(/^\$/, '').toUpperCase());
      }
    }
  }
  let validSet = new Set();
  if (allTags.size > 0) {
    const verdict = await validateTickers([...allTags].sort());
    validSet = new Set(Object.entries(verdict).filter(([, ok]) => ok).map(([s]) => s));
    const rejected = [...allTags].filter(s => !validSet.has(s)).sort();
    if (rejected.length) {
      logger.info(`ticker_validator dropped ${rejected.length} false positives: ${rejected.join(', ')}`);
    }
  }

  const overall = {};
  const useLLM = llmEnabled();
  if (useLLM) logger.info('LLM classifier enabled');
  for (const [h, { b, tweets }] of Object.entries(bloggerData)) {
    const items = [];
    for (const t of tweets) {
      const text = t.full_text || t.text || '';
      const tid  = t.tweet_id || t.id_str || t.id;
      const rawTags = extractCashtags(text, cashtagPat);
      const tickers = rawTags.filter(c => validSet.has(c.replace(/^\$/, '').toUpperCase()));
      const item = {
        handle: h,
        layer: b.layer,
        window_hours: t._window_hours ?? cfg.pipeline.window_hours,
        tweet_id: tid,
        url: tweetUrl(h, tid),
        created_at: t.created_at_datetime || t.created_at,
        kind: classifyPostKind(t),
        topic: topicOf(text),
        stance: stanceOf(text, cfg),
        tickers,
        tickers_raw: rawTags,
        conviction: convictionOf(t),
        view_count: t.view_count || 0,
        favorite_count: t.favorite_count || 0,
        text,
        summary_zh: '',
        translation_zh: '',
        classifier: 'rules',
      };
      items.push(item);
    }
    const finalItems = useLLM ? await enrichItemsWithLLM(items) : items;
    await saveJson(path.join(outDir, `${h}.json`), finalItems);
    overall[h] = finalItems;
    logger.info(`[${h}] classified ${finalItems.length} tweets`);
  }
  await saveJson(path.join(outDir, '_all_classified.json'), overall);
  return overall;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  classifyAll().catch(e => { logger.error(e); process.exit(1); });
}
