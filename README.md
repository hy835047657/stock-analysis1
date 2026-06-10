# FinTwit Signal Radar

> Track influential FinTwit accounts, classify market views with an LLM, translate key tweets into Chinese, detect consensus/risk signals, and publish a daily HTML report through GitHub Actions, Vercel, Supabase, and Lark.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![GitHub Actions](https://img.shields.io/badge/Automation-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com/)
[![Supabase](https://img.shields.io/badge/Storage-Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

FinTwit Signal Radar is an open-source Node.js agent for people who follow overseas stock and macro voices on X/Twitter. It fetches recent posts from selected accounts, validates tickers, uses an LLM to classify investment views, translates important content into Chinese, tracks position changes, detects multi-blogger consensus, and sends a daily report to Lark or Slack.

This project is designed for self-hosting. You can run it locally, or deploy it as a lightweight cloud workflow with GitHub Actions for scheduling, Vercel for public HTML reports, and Supabase for structured report storage.

**Disclaimer:** This tool does not provide investment advice. It is an information aggregation, translation, attribution, and backtesting layer. Always verify sources and make independent decisions.

## Why This Exists

FinTwit is noisy, fast-moving, and mostly English-first. Useful signals are easy to miss, especially when they are scattered across long threads, quote tweets, and account-specific jargon.

This project tries to turn that stream into a repeatable daily workflow:

- Which tickers are being discussed by high-signal accounts?
- Are multiple bloggers converging on the same long/short/risk view?
- Which posts are merely market commentary, and which contain an actionable view?
- What changed since the previous report?
- Can a Chinese-speaking reader scan the important tweets without reading every original post?

## Features

- **Account watchlist by layer**: industry experts, single-stock analysts, institutional voices, market tape, and short-seller risk accounts.
- **TwexAPI tweet fetching**: configurable windows, with 7-day overrides for risk-oriented accounts.
- **LLM view classification**: stance, topic, conviction, reasoning, Chinese summary, and Chinese translation.
- **Ticker validation**: filters false-positive cashtags such as `$CEO`, `$SEC`, and `$AI`.
- **Position tracking**: compares new views with previous views and records changed signals.
- **Consensus detection**: highlights tickers mentioned by multiple bloggers with weighted agreement.
- **Risk radar**: surfaces activist short reports, accounting concerns, delisting risk, and regulatory warnings.
- **Chinese daily report**: Markdown and HTML output with blogger-level tweet summaries and detail links.
- **Lark / Slack push**: webhook-based daily delivery.
- **Cloud-ready deployment**: GitHub Actions + Vercel + Supabase.

## Example Output

The generated report includes:

- Hot topics and tickers
- Multi-blogger consensus
- Risk radar
- Blogger-by-blogger translated summaries
- High-engagement tweets
- Weekly macro and risk digest
- HTML page link for easier reading on mobile

After Vercel deployment, reports are published under:

```text
https://your-app.vercel.app/reports/daily_YYYYMMDD.html
```

## Architecture

```text
┌────────────────────────────────────────────────────────────────┐
│       Orchestrator (Node.js, ESM)  ·  GitHub Actions 09:30 CST │
└───┬────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────┐  ┌──────────────────┐  ┌───────────────────┐
│ tweet       │─▶│ view             │─▶│ position          │
│ Fetcher     │  │ Classifier + LLM │  │ Tracker           │
└─────────────┘  └──────────────────┘  └───────────────────┘
       │                  │                      │
       │                  ▼                      ▼
       │           ┌────────────────┐   ┌──────────────────┐
       │           │ ticker         │   │ consensus        │
       │           │ Validator      │   │ Analyzer         │
       │           └────────────────┘   └──────────────────┘
       ▼                                          │
┌────────────────┐                                ▼
│ backtest       │                       ┌──────────────────────┐
│ ledger         │                       │ riskAlert → reporter │
└────────────────┘                       │ → HTML / Lark / DB   │
                                         └──────────────────────┘
```

## Watchlist

The default watchlist includes 9 accounts. You can edit `config/watchlist.yaml` to add, remove, or reweight accounts.

| Handle | Layer | Function | Window |
|---|---|---|---|
| @dylan522p | L1 Industry depth | AI / semi supply chain | 24h |
| @Beth_Kindig | L1 Industry depth | AI large-cap long-term | 24h |
| @aleabitoreddit | L2 Single-stock alpha | AI photonics / chokepoint | 24h |
| @HKuppy | L2 Single-stock alpha | Cycles / energy / uranium | 24h |
| @altcap | L3 Institutional benchmark | Altimeter 13F proxy | 24h |
| @xiaomustock | L2 Single-stock alpha | US stock fundamentals / AI semi | 24h |
| @KobeissiLetter | L5 Market tape | Sentiment + technicals | 24h |
| @muddywatersre | L6 Risk radar | Activist short | 7d |
| @sprucepointcap | L6 Risk radar | Activist short | 7d |

Layer-specific windows are configured in `config/watchlist.yaml`. Risk accounts keep a 168-hour window by default.

## Quick Start

```bash
git clone https://github.com/hy835047657/stock-analysis1.git
cd stock-analysis1
cp .env.example .env
npm install
npm test
npm start
```

Required local environment variables:

```env
TWEX_API_KEY=your_twexapi_key
OPENAI_API_KEY=your_openai_compatible_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Optional push and cloud variables:

```env
LARK_WEBHOOK=
SLACK_WEBHOOK=
REPORT_PUBLIC_BASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Common Commands

```bash
npm start                  # run once locally
npm run schedule           # run local cron process
npm run ci:daily           # generate report, sync public HTML, upload Supabase if configured
npm run build:vercel       # prepare static Vercel output
npm test                   # run tests
```

## Cloud Deployment

This repo is prepared for Vercel + GitHub Actions + Supabase:

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Add GitHub repository secrets under `Settings -> Secrets and variables -> Actions`.
3. Import the repo into Vercel. The included `vercel.json` serves the `public` directory.
4. Set `REPORT_PUBLIC_BASE_URL` to your Vercel URL. Both `https://your-app.vercel.app` and `https://your-app.vercel.app/reports` are supported.
5. GitHub Actions runs every day at 09:30 Asia/Shanghai, with backup checks at 09:45 and 10:00. If the daily report already exists, backup runs skip automatically.

Recommended GitHub Secrets:

```text
TWEX_API_KEY
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_MODEL
LARK_WEBHOOK
SLACK_WEBHOOK
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Recommended GitHub Variables:

```text
REPORT_PUBLIC_BASE_URL
LLM_CLASSIFIER_ENABLED=true
LLM_CLASSIFIER_BATCH_SIZE=20
LLM_CLASSIFIER_CONCURRENCY=2
LLM_CLASSIFIER_TIMEOUT_MS=120000
PIPELINE_WINDOW_HOURS=56
TWEX_REUSE_RAW=false
TWEX_FETCH_CONCURRENCY=3
PUBLIC_REPORT_WAIT_SECONDS=90
PUBLIC_REPORT_WAIT_INTERVAL_SECONDS=5
```

## Project Layout

```text
fintwit-tracker-node/
├── config/watchlist.yaml
├── src/
│   ├── agent/
│   │   ├── orchestrator.js
│   │   ├── reporter.js
│   │   ├── report_template.njk
│   │   └── report_template.html.njk
│   ├── common/
│   └── skills/
│       ├── tweetFetcher/
│       ├── viewClassifier/
│       ├── tickerValidator/
│       ├── positionTracker/
│       ├── consensusAnalyzer/
│       ├── backtest/
│       └── riskAlert/
├── scripts/
│   ├── sync-public-reports.js
│   └── upload-report-to-supabase.js
├── supabase/schema.sql
├── public/
├── tests/
├── vercel.json
└── .github/workflows/daily.yml
```

## Contributing

Contributions are welcome. Good first issues include:

- Add more data providers besides TwexAPI.
- Improve Chinese report templates.
- Add screenshots and example reports.
- Add more robust backtesting metrics.
- Add webhook or streaming support if the upstream provider supports it.
- Build a small dashboard on top of Supabase report data.

Please keep secrets out of commits. Use `.env` locally and GitHub Secrets in cloud deployments.

## Roadmap

- Public demo report with sanitized sample data
- Better per-blogger performance analytics
- Optional Supabase-powered dashboard
- Real-time alert mode for selected accounts
- More multilingual output formats

## License

MIT.
