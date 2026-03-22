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
      const eventId = extractEventIdFromOgImagePath(url.pathname);
      if (!eventId) return new Response("Not found", { status: 404 });
      return handleImageProxy(eventId, env);
    }

    const eventId = extractEventIdFromEventPath(url.pathname);
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

    const title =
      cleanText(
        event?.title ||
          event?.name ||
          event?.event_title ||
          "Събитие – Психолог Сердар Сабриев"
      );

    const description = truncate(
      event?.description ||
        event?.desc ||
        event?.content ||
        "Предстоящи събития, семинари и групови занимания.",
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
          hasSupabaseUrl: !!env.SUPABASE_URL,
          hasSupabaseAnonKey: !!env.SUPABASE_ANON_KEY,
          rawKeys: event ? Object.keys(event) : [],
          titleValue:
            event?.title || event?.name || event?.event_title || null,
          imageValue:
            event?.image_url ||
            event?.image ||
            event?.cover ||
            event?.thumbnail ||
            event?.banner ||
            null,
        },
      });
    }

    return Response.redirect(realEventUrl, 302);
  },
};

function extractEventIdFromEventPath(pathname) {
  const match = pathname.match(/^\/events\/([0-9a-f-]{36})\/?$/i);
  return match ? match[1] : null;
}

function extractEventIdFromOgImagePath(pathname) {
  const match = pathname.match(/^\/og-image\/([0-9a-f-]{36})\/?$/i);
  return match ? match[1] : null;
}

async function getEvent(eventId, env) {
  if (!env.SUPABASE_URL) {
    return { event: null, status: "error", reason: "missing SUPABASE_URL" };
  }

  if (!env.SUPABASE_ANON_KEY) {
    return {
      event: null,
      status: "error",
      reason: "missing SUPABASE_ANON_KEY",
    };
  }

  const baseUrl = String(env.SUPABASE_URL).replace(/\/$/, "");
  const query = new URLSearchParams({
    select: "*",
    id: `eq.${eventId}`,
  });

  const endpoint = `${baseUrl}/rest/v1/events?${query.toString()}`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      cf: {
        cacheTtl: 60,
        cacheEverything: true,
      },
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
        reason: `invalid JSON from Supabase: ${rawText.slice(0, 300)}`,
      };
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        event: null,
        status: "not_found",
        reason: "no matching row in events",
      };
    }

    const row = rows[0];

    return {
      event: normalizeEventRow(row),
      status: "ok",
      reason: "event loaded",
    };
  } catch (err) {
    return {
      event: null,
      status: "fetch_error",
      reason: err?.message || String(err),
    };
  }
}

function normalizeEventRow(row) {
  return {
    ...row,
    title:
      row.title ??
      row.name ??
      row.event_title ??
      row.heading ??
      null,
    description:
      row.description ??
      row.desc ??
      row.content ??
      row.text ??
      null,
    image_url:
      row.image_url ??
      row.image ??
      row.cover ??
      row.thumbnail ??
      row.banner ??
      row.photo ??
      null,
  };
}

async function handleImageProxy(eventId, env) {
  const fallbackImage = env.FALLBACK_IMAGE || DEFAULT_FALLBACK_OG_IMAGE;
  const eventResult = await getEvent(eventId, env);
  const imageUrl = eventResult.event?.image_url || fallbackImage;

  try {
    const imgRes = await fetch(imageUrl, {
      cf: {
        cacheTtl: 86400,
        cacheEverything: true,
      },
    });

    if (!imgRes.ok) {
      return await proxyFallbackImage(
        fallbackImage,
        `image fetch failed: ${imgRes.status}`
      );
    }

    let contentType = imgRes.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      contentType = detectImageContentTypeFromUrl(imageUrl) || "image/jpeg";
    }

    return new Response(imgRes.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-OG-Image-Source": imageUrl,
      },
    });
  } catch (err) {
    return await proxyFallbackImage(
      fallbackImage,
      err?.message || "unknown image proxy error"
    );
  }
}

async function proxyFallbackImage(fallbackImage, reason) {
  try {
    const res = await fetch(fallbackImage);
    const contentType =
      res.headers.get("content-type") ||
      detectImageContentTypeFromUrl(fallbackImage) ||
      "image/jpeg";

    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-OG-Image-Fallback": "1",
        "X-OG-Image-Reason": reason,
      },
    });
  } catch {
    return new Response("Fallback image unavailable", { status: 500 });
  }
}

function detectImageContentTypeFromUrl(url) {
  const lower = String(url).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function buildOgResponse({
  title,
  description,
  imageUrl,
  ogUrl,
  canonicalUrl,
  fbAppId,
  debug = {},
}) {
  const safeTitle = esc(title);
  const safeDescription = esc(description);
  const safeImageUrl = esc(imageUrl);
  const safeOgUrl = esc(ogUrl);
  const safeCanonicalUrl = esc(canonicalUrl);
  const safeFbAppId = esc(fbAppId || "");

  const debugComment = `<!-- ${esc(
    JSON.stringify({
      worker: "sabriev-events-og",
      ...debug,
    })
  )} -->`;

  const fbAppMeta = safeFbAppId
    ? `<meta property="fb:app_id" content="${safeFbAppId}" />`
    : "";

  const html = `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  <link rel="canonical" href="${safeCanonicalUrl}" />

  <meta property="og:type" content="article" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="${safeOgUrl}" />
  <meta property="og:image" content="${safeImageUrl}" />
  <meta property="og:image:secure_url" content="${safeImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${safeTitle}" />
  <meta property="og:locale" content="bg_BG" />
  <meta property="og:site_name" content="Психолог Сердар Сабриев" />
  ${fbAppMeta}

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${safeImageUrl}" />

  <meta name="x-debug" content="${esc(JSON.stringify(debug))}" />
  ${debugComment}
</head>
<body>
  <p>${safeTitle}</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-OG-Worker": "sabriev-events-og",
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
  const normalized = cleanText(value);
  if (!normalized) return "Вижте повече за събитието на Сердар Сабриев.";
  return normalized.length <= max
    ? normalized
    : normalized.slice(0, max - 1).trim() + "…";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init.status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}
