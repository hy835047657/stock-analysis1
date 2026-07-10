# Vercel Cron Fallback

Vercel Cron fallback is disabled. The project no longer configures Vercel to dispatch the GitHub Actions workflow automatically.

Reports can still be generated manually from GitHub Actions with `workflow_dispatch`, or locally with:

```bash
npm run ci:daily
```

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

The endpoint is retained for manual/internal use, but no Vercel Cron job calls it:

```text
/api/trigger-daily
```

The endpoint only starts GitHub Actions. It does not run the report pipeline on Vercel, so it avoids Vercel function timeout limits.
