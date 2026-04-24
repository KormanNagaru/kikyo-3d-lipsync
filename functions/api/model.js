// Pages Function: /api/model
// GET     → streams the currently active GLB from R2 (public)
// POST    → replaces the active GLB (admin only, requires X-Admin-Pwd header)
// DELETE  → clears the active GLB, reverts to bundled default (admin only)
//
// Bindings (see wrangler.toml + Cloudflare Pages dashboard):
//   env.MODELS         — R2 bucket
//   env.ADMIN_PASSWORD — secret shared with the admin

const OBJECT_KEY = 'current.glb';
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — plenty for any realistic GLB

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pwd',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

function authorized(request, env) {
  const pwd = request.headers.get('x-admin-pwd');
  return pwd && env.ADMIN_PASSWORD && pwd === env.ADMIN_PASSWORD;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const obj = await env.MODELS.get(OBJECT_KEY);
  if (!obj) return json(404, { error: 'no model uploaded' });
  return new Response(obj.body, {
    headers: {
      'content-type':  obj.httpMetadata?.contentType || 'model/gltf-binary',
      'cache-control': 'public, max-age=30',
      'etag':          obj.httpEtag,
      ...CORS,
    },
  });
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json(401, { error: 'unauthorized' });

  const lenHeader = request.headers.get('content-length');
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BYTES) {
    return json(413, { error: 'file too large', limit: MAX_BYTES });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) {
    return json(413, { error: 'file too large', limit: MAX_BYTES });
  }
  if (body.byteLength === 0) {
    return json(400, { error: 'empty body' });
  }

  await env.MODELS.put(OBJECT_KEY, body, {
    httpMetadata: { contentType: 'model/gltf-binary' },
  });
  return json(200, { ok: true, size: body.byteLength });
}

export async function onRequestDelete({ request, env }) {
  if (!authorized(request, env)) return json(401, { error: 'unauthorized' });
  await env.MODELS.delete(OBJECT_KEY);
  return json(200, { ok: true });
}
