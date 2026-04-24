// Pages Function: /api/model
// GET     → streams the currently active GLB from R2
// POST    → replaces the active GLB
// DELETE  → clears the active GLB, reverts to bundled default
//
// Binding (see wrangler.toml): env.MODELS — R2 bucket
// Auth disabled — this is an open test page.

const OBJECT_KEY = 'current.glb';
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — plenty for any realistic GLB

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
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

export async function onRequestDelete({ env }) {
  await env.MODELS.delete(OBJECT_KEY);
  return json(200, { ok: true });
}
