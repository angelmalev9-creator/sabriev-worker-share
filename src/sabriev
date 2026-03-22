/**
 * Cloudflare Worker – Dynamic OG Meta for /events/:id
 *
 * Environment variables (set in Cloudflare dashboard → Worker Settings → Variables):
 *   SUPABASE_URL            – e.g. https://ymeanxgocsvaqeboljhh.supabase.co
 *   SUPABASE_ANON_KEY       – the public anon key
 *   SITE_ORIGIN             – e.g. https://sabriev.com  (no trailing slash)
 *   FALLBACK_IMAGE          – (optional) default OG image URL
 *
 * Route trigger: sabriev.com/events/*
 */

const BOT_UA =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|Googlebot|bingbot|Baiduspider|YandexBot|vkShare|Viber|Pinterest|Embedly|Iframely|Applebot|redditbot|Snapchat/i;

const FALLBACK_OG_IMAGE = "https://sabriev.com/images/events-og.jpg";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/events\/([0-9a-f-]{36})\/?$/i);

    // Not an event detail route → pass through to origin
    if (!match) {
      return fetch(request);
    }

    const eventId = match[1];
    const ua = request.headers.get("user-agent") || "";

    // Regular visitors → proxy to origin (SPA handles rendering)
    if (!BOT_UA.test(ua)) {
      return fetch(request);
    }

    // --- Bot / crawler path ---
    const siteOrigin = env.SITE_ORIGIN || "https://sabriev.com";
    const fallbackImage = env.FALLBACK_IMAGE || FALLBACK_OG_IMAGE;

    let event = null;

    // Try fetching from Supabase if keys are configured
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        event = await fetchEventFromSupabase(eventId, env);
      } catch (err) {
        console.error("Supabase fetch failed:", err.message);
      }
    }

    // Fallback: local event map (fill in while you don't have env vars)
    if (!event) {
      event = LOCAL_EVENT_MAP[eventId] || null;
    }

    // If still nothing, return a generic OG page
    if (!event) {
      return buildOgResponse({
        title: "Събитие – Психолог Сердар Сабриев",
        description:
          "Предстоящи събития, семинари и групови занимания с психолог Сердар Сабриев.",
        imageUrl: fallbackImage,
        eventUrl: `${siteOrigin}/events/${eventId}`,
        siteOrigin,
      });
    }

    const eventUrl = `${siteOrigin}/events/${eventId}`;
    const imageUrl = event.image_url || event.imageUrl || fallbackImage;
    const description = truncate(event.description || "", 155);

    return buildOgResponse({
      title: `${event.title} – Психолог Сердар Сабриев`,
      description,
      imageUrl,
      eventUrl,
      siteOrigin,
    });
  },
};

// ─── Supabase fetch ──────────────────────────────────────────────────────────

async function fetchEventFromSupabase(eventId, env) {
  const params = new URLSearchParams({
    select: "title,description,image_url",
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
      cf: { cacheTtl: 300 }, // cache 5 min at edge
    }
  );

  if (!res.ok) return null;

  const rows = await res.json();
  return rows.length ? rows[0] : null;
}

// ─── HTML builder ────────────────────────────────────────────────────────────

function buildOgResponse({ title, description, imageUrl, eventUrl, siteOrigin }) {
  const html = `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(eventUrl)}" />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(eventUrl)}" />
  <meta property="og:image" content="${esc(imageUrl)}" />
  <meta property="og:image:secure_url" content="${esc(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(title)}" />
  <meta property="og:locale" content="bg_BG" />
  <meta property="og:site_name" content="Психолог Сердар Сабриев" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(imageUrl)}" />

  <!-- Redirect real visitors that slip through -->
  <meta http-equiv="refresh" content="0;url=${esc(eventUrl)}" />
</head>
<body>
  <script>window.location.replace(${JSON.stringify(eventUrl)});</script>
  <p>Пренасочване към <a href="${esc(eventUrl)}">${esc(title)}</a>…</p>
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, max) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : normalized.slice(0, max - 1).trim() + "…";
}

// ─── Local fallback map (optional, remove once env vars are set) ─────────────

const LOCAL_EVENT_MAP = {
  // "some-uuid": {
  //   title: "Примерно събитие",
  //   description: "Кратко описание на събитието.",
  //   imageUrl: "https://sabriev.com/images/example.jpg",
  // },
};
