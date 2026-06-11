const DEFAULT_OWNER = 'hy835047657';
const DEFAULT_REPO = 'stock-analysis1';
const DEFAULT_WORKFLOW = 'daily.yml';
const DEFAULT_REF = 'main';

function json(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBearer(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || readBearer(req) !== cronSecret) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  const token = process.env.GH_WORKFLOW_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    json(res, 500, { ok: false, error: 'missing_GH_WORKFLOW_TOKEN' });
    return;
  }

  const owner = process.env.GH_OWNER || DEFAULT_OWNER;
  const repo = process.env.GH_REPO || DEFAULT_REPO;
  const workflow = process.env.GH_WORKFLOW || DEFAULT_WORKFLOW;
  const ref = process.env.GH_REF || DEFAULT_REF;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ ref }),
  });

  if (!response.ok) {
    const text = await response.text();
    json(res, response.status, {
      ok: false,
      error: 'github_dispatch_failed',
      status: response.status,
      detail: text.slice(0, 500),
    });
    return;
  }

  json(res, 202, {
    ok: true,
    workflow,
    ref,
    triggered_at: new Date().toISOString(),
  });
}
