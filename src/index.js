/**
 * FINAL WORKER – REAL DEBUG VERSION
 */

const DEFAULT_FALLBACK_OG_IMAGE = "https://sabriev.com/images/events-og.jpg";
const SHARE_ORIGIN = "https://share.sabriev.com";

const BOT_UA =
/facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // IMAGE PROXY
    if (url.pathname.startsWith("/og-image/")) {
      const id = url.pathname.split("/og-image/")[1];
      return handleImageProxy(id, env);
    }

    const match = url.pathname.match(/^\/events\/([0-9a-f-]{36})$/i);
    if (!match) return new Response("Not found", { status: 404 });

    const eventId = match[1];
    const ua = request.headers.get("user-agent") || "";
    const isBot = BOT_UA.test(ua);
    const forceOg = url.searchParams.get("og") === "1";

    const shareUrl = `${SHARE_ORIGIN}/events/${eventId}`;

    const event = await getEvent(eventId, env);

    const og = {
      title: event?.title || "FALLBACK TITLE",
      description: event?.description || "FALLBACK DESC",
      image: `${SHARE_ORIGIN}/og-image/${eventId}`,
    };

    if (isBot || forceOg) {
      return buildHtml({
        ...og,
        url: shareUrl,
        debug: event || { error: "NO DATA" },
      });
    }

    return Response.redirect(`https://sabriev.com/events/${eventId}`, 302);
  },
};


// 🔥 REAL FETCH + RAW DEBUG
async function getEvent(eventId, env) {
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

    const data = await res.json();
    const e = data?.[0];

    if (!e) return null;

    // ⚠️ ТУК СМЕНИ С ТВОИТЕ КОЛОНИ СЛЕД DEBUG
    return {
      title: e.title,
      description: e.description,
      image: e.image_url,
      raw: e
    };

  } catch {
    return null;
  }
}


// IMAGE PROXY
async function handleImageProxy(eventId, env) {
  const event = await getEvent(eventId, env);
  const img = event?.image || DEFAULT_FALLBACK_OG_IMAGE;

  const res = await fetch(img);

  return new Response(res.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000",
    },
  });
}


// HTML
function buildHtml({ title, description, image, url, debug }) {
  return new Response(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>

<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${image}" />
<meta property="og:url" content="${url}" />

<meta name="x-debug" content='${JSON.stringify(debug)}' />

</head>
<body>${title}</body>
</html>`, {
    headers: { "Content-Type": "text/html" },
  });
}
