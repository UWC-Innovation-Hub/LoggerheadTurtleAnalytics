/**
 * Cloudflare Pages Function — API proxy to Google Apps Script.
 * Handles CORS and forwards POST requests to the Apps Script doPost endpoint.
 *
 * Apps Script web apps return 302 redirects without CORS headers,
 * so this Worker follows the redirect server-side and returns the
 * JSON response with proper CORS headers to the browser.
 *
 * Cacheable actions (like fetchAllDashboardData) are stored in KV with
 * a 60-second TTL so that auto-refresh cycles across all clients hit
 * the edge instead of Apps Script.
 */

const ALLOWED_ORIGINS = [
  'http://localhost:8788',  // local dev
];

// Actions whose responses are identical for all authenticated users
// and safe to serve from cache without per-request auth.
const CACHEABLE_ACTIONS = new Set(['fetchAllDashboardData']);
const CACHE_TTL_SECONDS = 60;

function getCorsOrigin(request, env) {
  var origin = request.headers.get('Origin') || '';
  // In production, add the Cloudflare Pages domain to ALLOWED_ORIGINS
  // For Pages Functions, same-origin requests don't need CORS
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  // Allow the pages.dev domain dynamically
  if (origin.endsWith('.pages.dev')) {
    return origin;
  }
  // Same-origin requests from Cloudflare Pages won't have a mismatched Origin
  return origin || '*';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function onRequestOptions(context) {
  var origin = getCorsOrigin(context.request, context.env);
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function onRequestPost(context) {
  var origin = getCorsOrigin(context.request, context.env);
  var appsScriptUrl = context.env.APPS_SCRIPT_URL;
  var kv = context.env.DASHBOARD_CACHE; // KV namespace — may be undefined in dev

  if (!appsScriptUrl) {
    return new Response(
      JSON.stringify({ success: false, error: 'APPS_SCRIPT_URL not configured' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      }
    );
  }

  try {
    var body = await context.request.text();

    // Parse request to determine action & params for cache keying
    var parsed = {};
    try { parsed = JSON.parse(body); } catch (e) { /* non-JSON body, pass through */ }

    var action = parsed.action || '';
    var period = (parsed.params && parsed.params.period) || '';

    // ── KV Cache: check for cached response ──
    var cacheKey = null;
    if (kv && CACHEABLE_ACTIONS.has(action) && period) {
      cacheKey = 'cache:v1:' + action + ':' + period;
      try {
        var cached = await kv.get(cacheKey);
        if (cached !== null) {
          // Validate cached value is real dashboard JSON before serving.
          // Bad/corrupted entries are deleted and we fall through to origin.
          var isValid = false;
          try {
            var parsed_cached = JSON.parse(cached);
            isValid = parsed_cached &&
                      parsed_cached.overview &&
                      parsed_cached.overview.success === true &&
                      parsed_cached.overview.data;
          } catch (e) { /* not valid JSON */ }

          if (isValid) {
            return new Response(cached, {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Cache': 'HIT',
                'Cache-Control': 'no-store',
                ...corsHeaders(origin),
              },
            });
          } else {
            // Corrupted cache entry — purge it
            context.waitUntil(kv.delete(cacheKey));
          }
        }
      } catch (kvErr) {
        // KV read failed — fall through to origin
        console.error('[KV] Read error:', kvErr);
      }
    }

    // ── Cache MISS or non-cacheable: forward to Apps Script ──
    var response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body, // Forward original body (includes session token for auth)
      redirect: 'follow',
    });

    var data = await response.text();

    // ── KV Cache: store successful response ──
    if (cacheKey && kv && data) {
      try {
        var respObj = JSON.parse(data);
        // Only cache if the response is a fully successful dashboard payload:
        // must have overview.success === true AND actual data present.
        // Never cache auth errors, partial failures, or empty responses.
        if (respObj &&
            respObj.overview && respObj.overview.success === true &&
            respObj.overview.data) {
          context.waitUntil(
            kv.put(cacheKey, data, { expirationTtl: CACHE_TTL_SECONDS })
          );
        }
      } catch (e) {
        // Non-JSON response or parse error — don't cache
      }
    }

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': cacheKey ? 'MISS' : 'BYPASS',
        'Cache-Control': 'no-store',
        ...corsHeaders(origin),
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      }
    );
  }
}
