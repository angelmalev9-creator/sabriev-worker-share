/**
 * Cloudflare Worker – Dynamic OG Meta for share.sabriev.com/events/:id
 *
 * Required env vars:
 *   SITE_ORIGIN
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *
 * Optional env vars:
 *   FALLBACK_IMAGE
 *   FB_APP_ID
 */

const DEFAULT_FALLBACK_OG_IMAGE = "https://sabriev.com/images/events-og.jpg";
const SHARE_ORIGIN = "https://share.sabriev.com";

const BOT_UA =
  /facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|Googlebot|bingbot|Baiduspider|YandexBot|vkShare|Viber|Pinterest|Embedly|Iframely|Applebot|redditbot|Snapchat|SkypeUriPreview/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // health/debug
    if (url.pathname === "/health") {
      return json({
        ok: true,
        hasSiteOrigin: !!env.SITE_ORIGIN,
        hasSupabaseUrl: !!env.SUPABASE_URL,
        hasSupabaseAnonKey: !!env.SUPABASE_ANON_KEY,
      });
    }

    // OG image proxy
    if (url.pathname.startsWith("/og-image/")) {
      const eventId = extractEventId(url.pathname, "/og-image/");
      if (!eventId) return new Response("Not found", { status: 404 });
      return handleImageProxy(eventId, env);
    }

    const eventId = extractEventId(url.pathname, "/events/");
    if (!eventId) {
      return new Response("Not found", { status: 404 });
    }

    const ua = request.headers.get("user-agent") || "";
    const isBot = BOT_UA.test(ua);
    const forceOg = url.searchParams.get("og") === "1";

    const siteOrigin = (env.SITE_ORIGIN || "https://sabriev.com").replace(/\/$/, "");
    const fallbackImage = env.FALLBACK_IMAGE || DEFAULT_FALLBACK_OG_IMAGE;
    const shareEventUrl = `${SHARE_ORIGIN}/events/${eventId}`;
    const realEventUrl = `${siteOrigin}/events/${eventId}`;

    const eventResult = await getEvent(eventId, env);
    const event = eventResult.event;

    const title = cleanText(event?.title || "Събитие – Психолог Сердар Сабриев");

    const description = truncate(
      event?.description || "Предстоящи събития, семинари и групови занимания.",
      180
    );

    const imageUrl = event
      ? `${SHARE_ORIGIN}/og-image/${eventId}`
      : fallbackImage;

    if (isBot || forceOg) {
      return buildOgResponse({
        title,
        description,
        imageUrl,
        ogUrl: shareEventUrl,
        canonicalUrl: shareEventUrl,
        fbAppId: env.FB_APP_ID || "",
        debug: {
          mode: forceOg ? "debug" : "bot",
          eventId,
          found: !!event,
          fetchStatus: eventResult.status,
          fetchReason: eventResult.reason,
        },
      });
    }

    return Response.redirect(realEventUrl, 302);
  },
};

// ─── Helpers ────────────────────────────────────────────────

function extractEventId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/$/, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rest)
    ? rest
    : null;
}

async function getEvent(eventId, env) {
  if (!env.SUPABASE_URL) {
    return { event: null, status: "error", reason: "missing SUPABASE_URL" };
  }
  if (!env.SUPABASE_ANON_KEY) {
    return { event: null, status: "error", reason: "missing SUPABASE_ANON_KEY" };
  }

  const baseUrl = String(env.SUPABASE_URL).replace(/\/$/, "");
  const query = new URLSearchParams({
    select: "id,title,description,image_url",
    id: `eq.${eventId}`,
    is_active: "eq.true",
  });

  const endpoint = `${baseUrl}/rest/v1/events?${query.toString()}`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      cf: { cacheTtl: 60, cacheEverything: true },
    });

    const rawText = await safeReadText(res);

    if (!res.ok) {
      return {
        event: null,
        status: "http_error",
        reason: `supabase ${res.status}: ${rawText.slice(0, 300)}`,
      };
    }

    let rows;
    try {
      rows = JSON.parse(rawText);
    } catch {
      return {
        event: null,
        status: "parse_error",
        reason: `invalid JSON: ${rawText.slice(0, 300)}`,
      };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return { event: null, status: "not_found", reason: "no matching active event" };
    }

    return { event: rows[0], status: "ok", reason: "event loaded" };
  } catch (err) {
    return { event: null, status: "fetch_error", reason: err?.message || String(err) };
  }
}

async function handleImageProxy(eventId, env) {
  const fallbackImage = env.FALLBACK_IMAGE || DEFAULT_FALLBACK_OG_IMAGE;
  const eventResult = await getEvent(eventId, env);
  const imageUrl = eventResult.event?.image_url || fallbackImage;

  try {
    const imgRes = await fetch(imageUrl, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    });

    if (!imgRes.ok) {
      return proxyFallbackImage(fallbackImage);
    }

    let contentType = imgRes.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      contentType = detectImageType(imageUrl) || "image/jpeg";
    }

    return new Response(imgRes.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return proxyFallbackImage(fallbackImage);
  }
}

async function proxyFallbackImage(fallbackImage) {
  try {
    const res = await fetch(fallbackImage);
    const contentType =
      res.headers.get("content-type") || detectImageType(fallbackImage) || "image/jpeg";
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return new Response("Image unavailable", { status: 500 });
  }
}

function detectImageType(url) {
  const l = String(url).toLowerCase();
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".webp")) return "image/webp";
  if (l.endsWith(".gif")) return "image/gif";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function buildOgResponse({ title, description, imageUrl, ogUrl, canonicalUrl, fbAppId, debug = {} }) {
  const t = esc(title);
  const d = esc(description);
  const img = esc(imageUrl);
  const u = esc(ogUrl);
  const c = esc(canonicalUrl);
  const fb = esc(fbAppId || "");

  const fbMeta = fb ? `<meta property="fb:app_id" content="${fb}" />` : "";

  const html = `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>${t}</title>
  <meta name="description" content="${d}" />
  <link rel="canonical" href="${c}" />

  <meta property="og:type" content="article" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:url" content="${u}" />
  <meta property="og:image" content="${img}" />
  <meta property="og:image:secure_url" content="${img}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${t}" />
  <meta property="og:locale" content="bg_BG" />
  <meta property="og:site_name" content="Психолог Сердар Сабриев" />
  ${fbMeta}

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${img}" />

  <!-- debug: ${esc(JSON.stringify(debug))} -->
</head>
<body>
  <p>${t}</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, max) {
  const s = cleanText(value);
  if (!s) return "Вижте повече за събитието на Сердар Сабриев.";
  return s.length <= max ? s : s.slice(0, max - 1).trim() + "…";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function safeReadText(res) {
  try { return await res.text(); } catch { return ""; }
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}
