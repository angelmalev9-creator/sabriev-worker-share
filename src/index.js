/**
 * Cloudflare Worker – Dynamic OG Meta for /events/:id
 *
 * Environment variables:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SITE_ORIGIN
 *   FALLBACK_IMAGE
 *
 * Route trigger:
 *   sabriev.com/events/*
 *
 * Debug:
 *   Add ?og=1 to force OG response in a normal browser
 */

const BOT_UA =
  /facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|Googlebot|bingbot|Baiduspider|YandexBot|vkShare|Viber|Pinterest|Embedly|Iframely|Applebot|redditbot|Snapchat|SkypeUriPreview/i;

const FALLBACK_OG_IMAGE = "https://sabriev.com/images/events-og.jpg";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/events\/([0-9a-f-]{36})\/?$/i);

    if (!match) {
      return fetch(request);
    }

    const eventId = match[1];
    const ua = request.headers.get("user-agent") || "";
    const forceOg = url.searchParams.get("og") === "1";
    const isBot = BOT_UA.test(ua);

    if (!forceOg && !isBot) {
      return fetch(request);
    }

    const siteOrigin = (env.SITE_ORIGIN || "https://sabriev.com").replace(/\/$/, "");
    const fallbackImage = env.FALLBACK_IMAGE || FALLBACK_OG_IMAGE;
    const eventUrl = `${siteOrigin}/events/${eventId}`;

    let event = null;

    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        event = await fetchEventFromSupabase(eventId, env);
      } catch (err) {
        console.error("Supabase fetch failed:", err?.message || String(err));
      }
    }

    if (!event) {
      event = LOCAL_EVENT_MAP[eventId] || null;
    }

    if (!event) {
      return buildOgResponse({
        title: "Събитие – Психолог Сердар Сабриев",
        description:
          "Предстоящи събития, семинари и групови занимания с психолог Сердар Сабриев.",
        imageUrl: fallbackImage,
        eventUrl,
        isDebugView: forceOg,
        debug: {
          ua,
          reason: "event_not_found",
        },
      });
    }

    const title = cleanText(event.title || "Събитие");
    const description = truncate(event.description || "", 155);
    const imageUrl = cleanText(event.image_url || event.imageUrl || fallbackImage);

    return buildOgResponse({
      title: `${title} – Психолог Сердар Сабриев`,
      description,
      imageUrl,
      eventUrl,
      isDebugView: forceOg,
      debug: {
        ua,
        reason: "event_found",
        eventId,
        imageUrl,
      },
    });
  },
};

async function fetchEventFromSupabase(eventId, env) {
  const params = new URLSearchParams({
    select: "id,title,description,image_url,is_active",
    id: `eq.${eventId}`,
    is_active: "eq.true",
  });

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/events?${params.toString()}`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: true,
      },
    }
  );

  if (!res.ok) {
    const text = await safeReadText(res);
    console.error("Supabase error:", res.status, text);
    return null;
  }

  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildOgResponse({
  title,
  description,
  imageUrl,
  eventUrl,
  isDebugView = false,
  debug = {},
}) {
  const safeTitle = esc(title);
  const safeDescription = esc(description);
  const safeImageUrl = esc(imageUrl);
  const safeEventUrl = esc(eventUrl);

  const debugComment = `<!-- ${esc(
    JSON.stringify({
      worker: "sabriev-events-og",
      ...debug,
    })
  )} -->`;

  const html = `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  <link rel="canonical" href="${safeEventUrl}" />

  <meta property="og:type" content="article" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="${safeEventUrl}" />
  <meta property="og:image" content="${safeImageUrl}" />
  <meta property="og:image:secure_url" content="${safeImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${safeTitle}" />
  <meta property="og:locale" content="bg_BG" />
  <meta property="og:site_name" content="Психолог Сердар Сабриев" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${safeImageUrl}" />

  ${isDebugView ? "" : `<meta http-equiv="refresh" content="0;url=${safeEventUrl}" />`}
  ${debugComment}
</head>
<body>
  ${isDebugView ? "" : `<script>window.location.replace(${JSON.stringify(eventUrl)});</script>`}
  <p>${isDebugView ? "OG debug mode" : "Пренасочване към"} <a href="${safeEventUrl}">${safeTitle}</a></p>
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

const LOCAL_EVENT_MAP = {
  // "uuid-here": {
  //   title: "Примерно събитие",
  //   description: "Кратко описание на събитието.",
  //   imageUrl: "https://sabriev.com/images/example.jpg",
  // },
};
