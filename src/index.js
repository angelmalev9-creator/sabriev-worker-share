/**
 * Cloudflare Worker – Dynamic OG Meta (FINAL FIXED)
 */

const DEFAULT_FALLBACK_OG_IMAGE = "https://sabriev.com/images/events-og.jpg";
const SHARE_ORIGIN = "https://share.sabriev.com";

const BOT_UA =
  /facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|Googlebot|bingbot|Baiduspider|YandexBot|vkShare|Viber|Pinterest|Embedly|Iframely|Applebot|redditbot|Snapchat|SkypeUriPreview/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // IMAGE PROXY
    if (url.pathname.startsWith("/og-image/")) {
      const id = url.pathname.split("/og-image/")[1];
      return handleImageProxy(id, env);
    }

    const match = url.pathname.match(/^\/events\/([0-9a-f-]{36})\/?$/i);
    if (!match) return new Response("Not found", { status: 404 });

    const eventId = match[1];
    const ua = request.headers.get("user-agent") || "";
    const isBot = BOT_UA.test(ua);
    const forceOg = url.searchParams.get("og") === "1";

    const siteOrigin = (env.SITE_ORIGIN || "https://sabriev.com").replace(/\/$/, "");

    const shareUrl = `${SHARE_ORIGIN}/events/${eventId}`;
    const realUrl = `${siteOrigin}/events/${eventId}`;

    const event = await getEvent(eventId, env);

    const ogImage = `${SHARE_ORIGIN}/og-image/${eventId}`;

    const og = {
      title: event?.title || "Събитие – Психолог Сердар Сабриев",
      description:
        event?.description ||
        "Предстоящи събития, семинари и групови занимания.",
      image: ogImage,
    };

    if (isBot || forceOg) {
      return buildHtml({
        ...og,
        url: shareUrl,
        debug: {
          eventId,
          found: !!event,
          title: event?.title || null,
          image: event?.image || null,
        },
      });
    }

    return Response.redirect(realUrl, 302);
  },
};



// 🔥 SMART EVENT FETCH (NO GUESSING ANYMORE)
async function getEvent(eventId, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/events?id=eq.${eventId}&select=*`,
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!res.ok) return null;

    const rows = await res.json();
    const e = rows?.[0];
    if (!e) return null;

    // 🔥 AUTO DETECT TITLE
    const title =
      e.title ||
      e.name ||
      e.event_title ||
      Object.values(e).find(
        v => typeof v === "string" && v.length > 10 && v.length < 120
      );

    // 🔥 AUTO DETECT IMAGE
    const image =
      e.image_url ||
      e.image ||
      e.cover ||
      e.thumbnail ||
      Object.values(e).find(
        v =>
          typeof v === "string" &&
          v.startsWith("http") &&
          (v.includes("supabase") || v.includes("storage"))
      );

    // 🔥 AUTO DETECT DESCRIPTION
    const description =
      e.description ||
      e.desc ||
      Object.values(e).find(
        v => typeof v === "string" && v.length > 50
      );

    return { title, description, image };

  } catch (err) {
    console.error("Supabase fetch error:", err);
    return null;
  }
}



// 🔥 IMAGE PROXY (FACEBOOK FIX)
async function handleImageProxy(eventId, env) {
  const event = await getEvent(eventId, env);

  const imageUrl = event?.image || DEFAULT_FALLBACK_OG_IMAGE;

  try {
    const res = await fetch(imageUrl);

    if (!res.ok) throw new Error();

    let type = res.headers.get("content-type");

    if (!type || !type.startsWith("image/")) {
      type = "image/jpeg";
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=31536000",
      },
    });

  } catch {
    return fetch(DEFAULT_FALLBACK_OG_IMAGE);
  }
}



// 🔥 OG HTML
function buildHtml({ title, description, image, url, debug }) {
  return new Response(
`<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="utf-8" />

<title>${esc(title)}</title>

<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />

<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:secure_url" content="${esc(image)}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(image)}" />

<meta name="x-debug" content="${esc(JSON.stringify(debug))}" />

</head>
<body>${esc(title)}</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}



// UTILS
function esc(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
