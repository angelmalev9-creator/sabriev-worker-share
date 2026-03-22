/**
 * Cloudflare Worker – Dynamic OG Meta for share.sabriev.com/events/:id
 *
 * Required env vars:
 *   SITE_ORIGIN
 *
 * Optional env vars:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   FALLBACK_IMAGE
 */

const DEFAULT_FALLBACK_OG_IMAGE = "https://sabriev.com/images/events-og.jpg";
const SHARE_ORIGIN = "https://share.sabriev.com";

// Important: include modern Meta/Facebook crawlers
const BOT_UA =
  /facebookexternalhit|Facebot|meta-externalagent|meta-externalfetcher|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|Googlebot|bingbot|Baiduspider|YandexBot|vkShare|Viber|Pinterest|Embedly|Iframely|Applebot|redditbot|Snapchat|SkypeUriPreview/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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

    const ogData = event
      ? {
          title: cleanText(event.title || "Събитие"),
          description: truncate(event.description || "", 180),
          imageUrl: cleanText(event.image_url || event.imageUrl || fallbackImage),
        }
      : {
          title: "Събитие – Психолог Сердар Сабриев",
          description:
            "Предстоящи събития, семинари и групови занимания с психолог Сердар Сабриев.",
          imageUrl: fallbackImage,
        };

    // Bots and ?og=1 get pure OG page with NO redirect
    if (isBot || forceOg) {
      return buildOgResponse({
        title: ogData.title,
        description: ogData.description,
        imageUrl: ogData.imageUrl,
        canonicalUrl: shareEventUrl,
        redirectUrl: realEventUrl,
        shouldRedirect: false,
        debug: {
          mode: forceOg ? "debug" : "bot",
          eventId,
          found: !!event,
          ua,
        },
      });
    }

    // Real users get OG page + redirect to actual site
    return buildOgResponse({
      title: ogData.title,
      description: ogData.description,
      imageUrl: ogData.imageUrl,
      canonicalUrl: shareEventUrl,
      redirectUrl: realEventUrl,
      shouldRedirect: true,
      debug: {
        mode: "user",
        eventId,
        found: !!event,
        ua,
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
  canonicalUrl,
  redirectUrl,
  shouldRedirect,
  debug = {},
}) {
  const safeTitle = esc(title);
  const safeDescription = esc(description);
  const safeImageUrl = esc(imageUrl);
  const safeCanonicalUrl = esc(canonicalUrl);
  const safeRedirectUrl = esc(redirectUrl);

  const debugComment = `<!-- ${esc(
    JSON.stringify({
      worker: "sabriev-events-og",
      ...debug,
    })
  )} -->`;

  const redirectMeta = shouldRedirect
    ? `<meta http-equiv="refresh" content="0;url=${safeRedirectUrl}" />`
    : "";

  const redirectScript = shouldRedirect
    ? `<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>`
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
  <meta property="og:url" content="${safeCanonicalUrl}" />
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

  ${redirectMeta}
  ${debugComment}
</head>
<body>
  ${redirectScript}
  <p>${shouldRedirect ? "Пренасочване към" : "Преглед на събитие"} <a href="${safeRedirectUrl}">${safeTitle}</a></p>
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
  "03b68d3e-1275-4e50-acc4-af18c2218167": {
    title: "Приказките, които ни разболяват",
    description:
      'Всеки в живота си чува, вижда и усеща различни "приказки". Тези приказки може да са поучителни, да са позитивни или да носят товар. Независимо какви са приказките в твоя живот не бива да допускаш те да доведат до душевно разболяване.',
    image_url:
      "https://ymeanxgocsvaqeboljhh.supabase.co/storage/v1/object/public/event-images/events/1773921509376-3y7rprvwgmd.png",
  },
  "c3977841-106c-4f53-a44a-0dad99d64d23": {
    title: "Живот по сценарий: приказките, които определят изборите ни",
    description:
      "Ако искате да се потопите в света на приказките и да разберете как те влияят на вашите житейски решения, то това е вашето събитие!",
    image_url:
      "https://ymeanxgocsvaqeboljhh.supabase.co/storage/v1/object/public/event-images/event-fairy-tales.jpg",
  },
  "b0e5dda9-d6f2-4996-ac0e-1c708fb39d5a": {
    title: "Историите, които възпитават",
    description:
      "По време на събитието ще се пренесете в едно времево пространство на магии, наричания и добрословене. Ще разгледаме как историите и посланията могат да дадат положителен тласък на личността в нейното съществуване.",
    image_url:
      "https://ymeanxgocsvaqeboljhh.supabase.co/storage/v1/object/public/event-images/events/1773998499966-1y0tcfcz07xh.jpg",
  },
  "af6f909f-1612-4818-9102-52f6ae2af297": {
    title: "Професионалното прегаряне или как да се погрижа за себе си?",
    description:
      "Това обучение е създадено специално за учители, директори, заместник-директори и психолози, които ежедневно работят в интензивна среда и често поставят себе си на последно място.",
    image_url:
      "https://ymeanxgocsvaqeboljhh.supabase.co/storage/v1/object/public/event-images/events/1773997349935-zp49t1rsrgr.jpg",
  },
  "734ace72-713a-40f5-9449-bee997992ab5": {
    title: "Приказките, които ни разболяват",
    description:
      'Всеки в живота си чува, вижда и усеща различни "приказки". Тези приказки може да са поучителни, да са позитивни или да носят товар.',
    image_url:
      "https://ymeanxgocsvaqeboljhh.supabase.co/storage/v1/object/public/event-images/events/1773921338334-ny6fref6xj.png",
  },
  "e3f554a6-b560-4ddd-a608-1050ba46e508": {
    title: "Здраве и патология в партньорските отношения",
    description:
      "Имаме удоволствието да Ви поканим на едно събитие, посветено на най-важната, но често и най-трудна сфера в живота ни - партньорските отношения.",
    image_url:
      "https://ymeanxgocsvaqeboljhh.supabase.co/storage/v1/object/public/event-images/events/1773998500018-5fzhwqpu6yq.webp",
  },
  "c2897a2f-c29a-4b41-a2fe-f0e6ecce9da9": {
    title: "Паник атаките и как да се справя с тях",
    description:
      "Паник атаките могат да превърнат ежедневието в предизвикателство, но с правилните знания и техники справянето е възможно.",
    image_url:
      "https://ymeanxgocsvaqeboljhh.supabase.co/storage/v1/object/public/event-images/events/1773998500126-9jr6ruoepx7.webp",
  },
};
