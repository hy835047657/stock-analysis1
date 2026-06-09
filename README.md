# FinTwit Tracker (Node.js)

> An open-source Agent + Skills system that tracks overseas stock bloggers on X (Twitter), aggregates daily views, classifies opinions, tracks position changes, backtests historical calls, surfaces multi-blogger consensus/divergence, and pushes daily risk alerts.

**This tool does NOT provide investment advice. It is purely an information-aggregation, attribution, and backtesting layer. Always do your own research.**

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│       Orchestrator (Node.js, ESM)  ·  node-cron 15:10 CST      │
└───┬────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────┐  ┌──────────────────┐  ┌───────────────────┐
│ tweet       │─▶│ view             │─▶│ position          │
│ Fetcher     │  │ Classifier       │  │ Tracker           │
└─────────────┘  └──────────────────┘  └───────────────────┘
       │                  │                      │
       │                  ▼                      ▼
       │           ┌────────────────┐   ┌──────────────────┐
       │           │ ticker         │   │ consensus        │
       │           │ Validator      │   │ Analyzer         │
       │           │ (yahoo-finance)│   └──────────────────┘
       │           └────────────────┘             │
       ▼                                          ▼
┌────────────────┐                       ┌──────────────────────┐
│ backtest       │                       │ riskAlert → reporter │
│ (yahoo-finance)│                       │ → Lark / Slack push  │
└────────────────┘                       └──────────────────────┘
```

## Watchlist (v1.1, 9 bloggers)

| Handle | Layer | Function | Window |
|---|---|---|---|
| @dylan522p | L1 Industry depth | AI / semi supply chain | 24h |
| @Beth_Kindig | L1 Industry depth | AI large-cap long-term | 24h |
| @aleabitoreddit | L2 Single-stock alpha | AI photonics / chokepoint | 24h |
| @HKuppy | L2 Single-stock alpha | Cycles / energy / uranium | 24h |
| @altcap | L3 Institutional benchmark | Altimeter 13F proxy | 24h |
| @xiaomustock | L2 Single-stock alpha | US stock fundamentals / AI semi | 24h |
| @KobeissiLetter | L5 Market tape | Sentiment + technicals | 24h |
| @muddywatersre | L6 Risk radar | Activist short | **7d** |
| @sprucepointcap | L6 Risk radar | Activist short | **7d** |

> **Per-layer windows**: L4/L6 bloggers run on a 7-day window and surface in a dedicated **Weekly Digest** section that appears once per week (default Tuesday UTC). High-frequency bloggers stay on the 24h daily cycle.

> **Ticker validation**: every cashtag is validated via `yahoo-finance2` before entering the pipeline. False positives like `$NASA`, `$CEO`, `$SEC` are dropped. Results are cached for 7 days. See `pipeline.ticker_validation` in `config/watchlist.yaml`.

## Quick Start

```bash
git clone <your-repo>/fintwit-tracker-node
cd fintwit-tracker-node
cp .env.example .env       # fill in TWEX_API_KEY, LARK_WEBHOOK, OPENAI_API_KEY
npm install
npm start                  # run-once smoke test
npm run schedule           # start daily cron
npm run ci:daily           # generate report, sync public HTML, upload Supabase when configured
npm test                   # run vitest suite
```

## Secret Management

- Local runs read secrets from `.env`. This file is intentionally ignored by Git and must not be committed.
- `TWEX_API_KEY` is required for fetching X/Twitter posts through TwexAPI.
- `LARK_WEBHOOK` and `SLACK_WEBHOOK` are optional push channels.
- For GitHub Actions, add the same names under repository **Settings → Secrets and variables → Actions**:
  - `TWEX_API_KEY`
  - `LARK_WEBHOOK`
  - `SLACK_WEBHOOK`
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`
  - `OPENAI_MODEL`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Add these non-secret repository variables under **Settings → Secrets and variables → Actions → Variables**:
  - `REPORT_PUBLIC_BASE_URL` such as `https://your-app.vercel.app/reports`
  - `LLM_CLASSIFIER_ENABLED=true`
  - `LLM_CLASSIFIER_BATCH_SIZE=8`
  - `LLM_CLASSIFIER_TIMEOUT_MS=120000`
  - `PIPELINE_WINDOW_HOURS=56`
  - `TWEX_REUSE_RAW=false`
- Rotate the TwexAPI key if it is ever committed, shared publicly, or exposed in logs.

## Cloud Deployment

This repo is prepared for a Vercel + GitHub Actions + Supabase deployment:

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Push this repository to GitHub and add the secrets/variables listed above.
3. Import the GitHub repo into Vercel. `vercel.json` uses `npm run build:vercel` and serves the static `public` directory.
4. Set `REPORT_PUBLIC_BASE_URL` to your Vercel report path, for example `https://your-app.vercel.app/reports`.
5. GitHub Actions runs every day at 15:10 Asia/Shanghai. It fetches tweets, runs the LLM classifier, generates Markdown + HTML, uploads structured data to Supabase, commits the `public/reports` archive, and triggers Vercel redeploy through the GitHub push.

The daily Lark card includes the public HTML link when `REPORT_PUBLIC_BASE_URL` is configured.

## Project Layout

```
fintwit-tracker-node/
├── package.json
├── config/watchlist.yaml
├── src/
│   ├── common/index.js               # config loader, logger, json io, helpers
│   ├── skills/
│   │   ├── tweetFetcher/             # TwexAPI client with per-layer windows
│   │   ├── viewClassifier/           # stance/topic/conviction classifier
│   │   ├── tickerValidator/          # yahoo-finance2 + blacklist/whitelist + cache
│   │   ├── positionTracker/          # ledger maintenance + diffs
│   │   ├── consensusAnalyzer/        # weighted consensus voting
│   │   ├── backtest/                 # forward-return scoring via yfinance
│   │   └── riskAlert/                # L6 ticker red flags + cross-ref
│   └── agent/
│       ├── orchestrator.js           # CLI entry + cron schedule
│       ├── reporter.js               # nunjucks render + Lark/Slack push
│       └── report_template.njk
├── tests/pipeline.test.js            # vitest suite
├── scripts/
│   ├── sync-public-reports.js        # copies generated reports into public/
│   └── upload-report-to-supabase.js  # writes report payloads to Supabase REST API
├── supabase/schema.sql               # cloud storage schema
├── vercel.json                       # static Vercel build config
└── .github/workflows/daily.yml       # 07:10 UTC cron
```

## Tech Stack

- **Runtime**: Node.js ≥ 20 (ESM)
- **HTTP**: axios + axios-retry (exponential backoff, 3 retries)
- **Config**: js-yaml + dotenv
- **Templating**: nunjucks (Jinja-compatible)
- **Logging**: pino + pino-pretty
- **Scheduling**: node-cron (in-process) / GitHub Actions (cloud)
- **Market data**: yahoo-finance2
- **Testing**: vitest

## License

MIT.
