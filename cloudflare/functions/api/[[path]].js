/**
 * Cloudflare Pages Function — API proxy to Google Apps Script.
 * Handles CORS and forwards POST requests to the Apps Script doPost endpoint.
 *
 * Apps Script web apps return 302 redirects without CORS headers,
 * so this Worker follows the redirect server-side and returns the
 * JSON response with proper CORS headers to the browser.
 */

const ALLOWED_ORIGINS = [
  'http://localhost:8788',  // local dev
];

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

    // Forward to Apps Script — follow the Google 302 redirect
    var response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      redirect: 'follow',
    });

    var data = await response.text();

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
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
