/**
 * Cloudflare Worker – Dynamic OG Meta for share.sabriev.com/events/:id
 */

const DEFAULT_FALLBACK_OG_IMAGE = "https://sabriev.com/images/events-og.jpg";
const SHARE_ORIGIN = "https://share.sabriev.com";

const BOT_UA =
  /facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|Googlebot|bingbot|Baiduspider|YandexBot|vkShare|Viber|Pinterest|Embedly|Iframely|Applebot|redditbot|Snapchat|SkypeUriPreview/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ✅ IMAGE PROXY ROUTE (НОВО)
    if (url.pathname.startsWith("/og-image/")) {
      const id = url.pathname.split("/og-image/")[1];
      return handleImageProxy(id, env);
    }

    const match = url.pathname.match(/^\/events\/([0-9a-f-]{36})\/?$/i);

    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const eventId = match[1];
    const ua = request.headers.get("user-agent") || "";
    const isBot = BOT_UA.test(ua);
    const forceOg = url.searchParams.get("og") === "1";

    const siteOrigin = (env.SITE_ORIGIN || "https://sabriev.com").replace(/\/$/, "");
    const fallbackImage = env.FALLBACK_IMAGE || DEFAULT_FALLBACK_OG_IMAGE;

    const shareEventUrl = `${SHARE_ORIGIN}/events/${eventId}`;
    const realEventUrl = `${siteOrigin}/events/${eventId}`;

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

    // ✅ ВАЖНО: използваме proxy image URL
    const proxyImageUrl = `${SHARE_ORIGIN}/og-image/${eventId}`;

    const ogData = event
      ? {
          title: cleanText(event.title || "Събитие"),
          description: truncate(event.description || "", 180),
          imageUrl: proxyImageUrl,
        }
      : {
          title: "Събитие – Психолог Сердар Сабриев",
          description:
            "Предстоящи събития, семинари и групови занимания с психолог Сердар Сабриев.",
          imageUrl: proxyImageUrl,
        };

    if (isBot || forceOg) {
      return buildOgResponse({
        title: ogData.title,
        description: ogData.description,
        imageUrl: ogData.imageUrl,
        ogUrl: shareEventUrl,
        canonicalUrl: shareEventUrl,
        debug: {
          mode: forceOg ? "debug" : "bot",
          eventId,
          found: !!event,
        },
      });
    }

    return Response.redirect(realEventUrl, 302);
  },
};


// 🔥 IMAGE PROXY (ТОВА РЕШАВА FACEBOOK ПРОБЛЕМА)
async function handleImageProxy(eventId, env) {
  let event = null;

  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    event = await fetchEventFromSupabase(eventId, env);
  }

  if (!event) {
    event = LOCAL_EVENT_MAP[eventId];
  }

  if (!event?.image_url) {
    return fetch(DEFAULT_FALLBACK_OG_IMAGE);
  }

  const imgRes = await fetch(event.image_url);

  if (!imgRes.ok) {
    return new Response("Image fetch failed", { status: 500 });
  }

  // 🔥 FORCE VALID IMAGE TYPE
  let contentType = imgRes.headers.get("content-type");

  if (!contentType || !contentType.startsWith("image/")) {
    contentType = "image/jpeg";
  }

  return new Response(imgRes.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000",
    },
  });
}


// 🔥 SUPABASE FETCH
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
    }
  );

  if (!res.ok) return null;

  const rows = await res.json();
  return rows?.[0] || null;
}


// 🔥 OG HTML
function buildOgResponse({
  title,
  description,
  imageUrl,
  ogUrl,
  canonicalUrl,
  debug = {},
}) {
  const html = `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>

<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(ogUrl)}" />
<meta property="og:image" content="${esc(imageUrl)}" />
<meta property="og:image:secure_url" content="${esc(imageUrl)}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(imageUrl)}" />

</head>
<body>${esc(title)}</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}


// UTILS
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(v, max) {
  v = cleanText(v);
  return v.length <= max ? v : v.slice(0, max) + "...";
}

function cleanText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}


// LOCAL FALLBACK
const LOCAL_EVENT_MAP = {}; // остави си твоя (не го пипам)
