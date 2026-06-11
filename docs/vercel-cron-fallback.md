# Vercel Cron Fallback

GitHub Actions scheduled workflows are best-effort and may occasionally be delayed or skipped. This project keeps the GitHub schedule, and also provides a Vercel Cron fallback that dispatches the same workflow every day at 09:30 Asia/Shanghai.

## Required Vercel Environment Variables

Set these in Vercel Project Settings > Environment Variables:

| Name | Value |
| --- | --- |
| `GH_WORKFLOW_TOKEN` | A GitHub fine-grained personal access token that can dispatch Actions for this repo. |
| `CRON_SECRET` | Any long random string. Vercel sends it as a bearer token when calling the cron endpoint. |

Optional overrides:

| Name | Default |
| --- | --- |
| `GH_OWNER` | `hy835047657` |
| `GH_REPO` | `stock-analysis1` |
| `GH_WORKFLOW` | `daily.yml` |
| `GH_REF` | `main` |

## Endpoint

Vercel Cron calls:

```text
/api/trigger-daily
```

The endpoint only starts GitHub Actions. It does not run the report pipeline on Vercel, so it avoids Vercel function timeout limits.
