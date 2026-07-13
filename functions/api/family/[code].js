// Good Kids sync API — stores one JSON blob per family code in KV.
// GET  /api/family/:code  -> family data (404 if none)
// PUT  /api/family/:code  -> save family data

const CODE_RE = /^[a-z0-9][a-z0-9-]{4,38}[a-z0-9]$/;
const MAX_BYTES = 512 * 1024;

function bad(status, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ params, env }) {
  const code = String(params.code || '').toLowerCase();
  if (!CODE_RE.test(code)) return bad(400, 'invalid code');
  const value = await env.GOODKIDS.get('family:' + code);
  if (value === null) return bad(404, 'not found');
  return new Response(value, {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequestPut({ params, env, request }) {
  const code = String(params.code || '').toLowerCase();
  if (!CODE_RE.test(code)) return bad(400, 'invalid code');
  const body = await request.text();
  if (body.length > MAX_BYTES) return bad(413, 'too large');
  let data;
  try { data = JSON.parse(body); } catch { return bad(400, 'invalid json'); }
  if (!data || !Array.isArray(data.kids) || !Array.isArray(data.log)) {
    return bad(400, 'invalid data');
  }
  await env.GOODKIDS.put('family:' + code, body);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
}
