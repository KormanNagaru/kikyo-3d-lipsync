// Pages Function: /api/model
// GET     → streams the currently active GLB from R2
// POST    → replaces the active GLB (streamed to R2, not buffered in RAM)
// DELETE  → clears the active GLB, reverts to bundled default
//
// Binding (see wrangler.toml): env.MODELS — R2 bucket
// Auth disabled — this is an open test page.

const OBJECT_KEY = 'current.glb';
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — plenty for any realistic GLB
const GLB_MAGIC = [0x67, 0x6C, 0x54, 0x46]; // ASCII "glTF" — first 4 bytes of any GLB file

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
  if (!request.body) return json(400, { error: 'empty body' });

  // Require Content-Length so R2 can accept the stream with a known length.
  // fetch() with a Blob body sets this automatically.
  const len = parseInt(request.headers.get('content-length') || '', 10);
  if (!Number.isFinite(len) || len <= 0) {
    return json(400, { error: 'Content-Length header required' });
  }
  if (len > MAX_BYTES) {
    return json(413, { error: 'file too large', limit: MAX_BYTES });
  }

  // Validate the GLB magic on the first 4 bytes as the stream flows through.
  // No full-payload buffering — memory footprint is bounded by one chunk.
  let headBuf = new Uint8Array(0);
  const validator = new TransformStream({
    transform(chunk, controller) {
      if (headBuf.byteLength < 4) {
        const take = Math.min(4 - headBuf.byteLength, chunk.byteLength);
        const merged = new Uint8Array(headBuf.byteLength + take);
        merged.set(headBuf, 0);
        merged.set(chunk.subarray(0, take), headBuf.byteLength);
        headBuf = merged;
        if (headBuf.byteLength >= 4) {
          for (let i = 0; i < 4; i++) {
            if (headBuf[i] !== GLB_MAGIC[i]) {
              controller.error(new Error('bad-magic'));
              return;
            }
          }
        }
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (headBuf.byteLength < 4) controller.error(new Error('bad-magic'));
    },
  });

  // R2.put() needs a ReadableStream of known length — FixedLengthStream
  // provides that while preserving streaming semantics end-to-end.
  const fixed = new FixedLengthStream(len);
  const pipePromise = request.body
    .pipeThrough(validator)
    .pipeTo(fixed.writable)
    .catch(err => { throw err; });

  try {
    const [putResult] = await Promise.all([
      env.MODELS.put(OBJECT_KEY, fixed.readable, {
        httpMetadata: { contentType: 'model/gltf-binary' },
      }),
      pipePromise,
    ]);
    return json(200, { ok: true, size: len, etag: putResult?.httpEtag });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('bad-magic')) return json(400, { error: 'not a GLB file — first 4 bytes must be "glTF"' });
    return json(500, { error: 'upload failed: ' + msg });
  }
}

export async function onRequestDelete({ env }) {
  await env.MODELS.delete(OBJECT_KEY);
  return json(200, { ok: true });
}
