const fs = require("fs");
const path = require("path");

const KK_API = "https://phimapi.com";
const KK_IMG = "https://phimimg.com";
const CINEMETA_API = "https://strem.io";
const VERSION = "3.5.0";

const PAGES_PER_RUN = 5;
const MAX_DISPLAY_PER_CATALOG = 1000;

const API_HEADERS = {
  accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
};

const CATALOGS = [
  { type: "series", id: "kk_home", name: "KKPhim - Hôm Nay Xem Gì", url: `${KK_API}/v1/api/home`, pages: 1 },
  { type: "series", id: "kk_2026", name: "KKPhim - Phim Mới 2026 Nhất", url: `${KK_API}/v1/api/nam/2026?page=1&limit=30`, pages: 2 },
  { type: "series", id: "kk_cn_drama", name: "KKPhim - Phim Bộ Trung Quốc", url: `${KK_API}/v1/api/quoc-gia/trung-quoc?page=1`, pages: 2 },
  { type: "series", id: "kk_hk", name: "KKPhim - Phim Hồng Kông", url: `${KK_API}/v1/api/quoc-gia/hong-kong?page=1`, pages: 2 },
  { type: "series", id: "kk_tm", name: "KKPhim - Phim Thuyết Minh", url: `${KK_API}/v1/api/danh-sach/phim-bo?page=1&sort_lang=thuyet-minh`, pages: 2 },
  { type: "series", id: "kk_lt", name: "KKPhim - Phim Lồng Tiếng", url: `${KK_API}/v1/api/danh-sach/phim-bo?page=1&sort_lang=long-tieng`, pages: 2 },
  { type: "series", id: "kk_anime", name: "KKPhim - Phim Hoạt Hình", url: `${KK_API}/v1/api/danh-sach/hoat-hinh?page=1`, pages: 2 }
];


const GENRES_LIST = [
  "Hành Động", "Tình Cảm", "Hài Hước", "Cổ Trang", "Tâm Lý",
  "Hình Sự", "Chiến Tranh", "Võ Thuật", "Viễn Tưởng", "Phiêu Lưu",
  "Khoa Học", "Kinh Dị", "Thần Thoại", "Chính Kịch", "Bí Ẩn"
];

function fixImg(url) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${KK_IMG}/${url.replace(/^\/+/, "")}`;
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: API_HEADERS, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveImdbId(movie, mediaType) {
  const directImdb = movie && movie.imdb && movie.imdb.id;
  if (directImdb && /^tt\d+/i.test(String(directImdb).trim())) {
    return String(directImdb).trim().toLowerCase();
  }
  const queryTitle = (movie.origin_name || movie.name || "").trim();
  if (!queryTitle) return "";
  const typePath = mediaType === "movie" ? "movie" : "series";
  const targetYear = String(movie.year || "").trim();

  const searchUrl = `${CINEMETA_API}/catalog/${typePath}/top/search=${encodeURIComponent(queryTitle)}.json`;
  const json = await fetchJson(searchUrl, 5000);
  const metas = (json && json.metas) || [];
  if (metas.length === 0) return "";

  if (targetYear) {
    const exactYear = metas.find((m) => String(m.releaseInfo || "").startsWith(targetYear));
    if (exactYear && /^tt\d+/i.test(exactYear.id)) return exactYear.id.toLowerCase();
  }
  const first = metas.shift();
  return first && /^tt\d+/i.test(first.id) ? first.id.toLowerCase() : "";
}
async function processMovieMeta(item, defaultType, processedSlugs, archiveDb) {
  const isMovie = item.type === "single" || item.episode_total === "1";
  const itemMediaType = isMovie ? "movie" : defaultType;
  const customId = `kk_${item.slug}`;

  if (processedSlugs.has(customId)) return;
  processedSlugs.add(customId);

  const existing = archiveDb[customId];
  const metaFilePath = path.join("addon", "meta", itemMediaType, `${customId}.json`);
  if (existing && existing.completed && fs.existsSync(metaFilePath)) {
    return;
  }

  const dJson = await fetchJson(`${KK_API}/phim/${item.slug}`);
  const movie = dJson && dJson.movie;
  const episodes = (dJson && dJson.episodes) || [];
  if (!movie) return;

  const imdbId = (existing && existing.imdb_id) || (await resolveImdbId(movie, itemMediaType));
  const cleanPlot = (movie.content || "")
    .replace(/<[^>]*>?/gm, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const verticalPoster = fixImg(movie.poster_url || movie.thumb_url);
  const horizontalThumb = fixImg(movie.thumb_url || movie.poster_url);
  const availableLangs = episodes.map((s) => s.server_name).filter(Boolean).join(" | ");
  const genres = Array.isArray(movie.category) ? movie.category.map((c) => c.name).filter(Boolean) : [];

  const mainServer = episodes.reduce(
    (p, c) => (((c.server_data && c.server_data.length) || 0) > ((p.server_data && p.server_data.length) || 0) ? c : p),
    { server_data: [] }
  );

  const videos = [];
  const epStreamsMap = {};

  if (itemMediaType === "movie") {
    const movieStreams = [];
    episodes.forEach((server) => {
      (server.server_data || []).forEach((ep) => {
        if (ep.link_m3u8) {
          movieStreams.push({
            name: `KKPhim (${server.server_name})`,
            title: `${movie.name} - ${ep.name || "Full"} (${movie.quality || "HD"})`,
            url: ep.link_m3u8
          });
        }
      });
    });
    fs.writeFileSync(
      path.join("addon", "stream", "movie", `${customId}.json`),
      JSON.stringify({ streams: movieStreams })
    );
  } else {
    (mainServer.server_data || []).forEach((ep, idx) => {
      const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || idx + 1;
      const epTitleClean = /^\d+$/.test(String(ep.name).trim()) ? `Tập ${ep.name}` : ep.name || `Tập ${epNum}`;
      const videoId = `${customId}:1:${epNum}`;
      const epMetaTag = [movie.quality, availableLangs, imdbId ? `IMDb: ${imdbId}` : ""].filter(Boolean).join(" • ");
      const epOverview = `[${epTitleClean}${epMetaTag ? ` - ${epMetaTag}` : ""}] ${cleanPlot}`;

      videos.push({
        id: videoId,
        title: `${movie.name} - ${epTitleClean}`,
        season: 1,
        episode: epNum,
        thumbnail: horizontalThumb || verticalPoster,
        poster: verticalPoster,
        overview: epOverview,
        description: epOverview,
        released: new Date(Date.now() - (mainServer.server_data.length - idx) * 86400000).toISOString()
      });
      epStreamsMap[videoId] = [];
    });

    episodes.forEach((server) => {
      (server.server_data || []).forEach((ep, idx) => {
        const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || idx + 1;
        const videoId = `${customId}:1:${epNum}`;
        if (ep.link_m3u8 && epStreamsMap[videoId]) {
          epStreamsMap[videoId].push({
            name: `KKPhim (${server.server_name})`,
            title: `${ep.name || `Tập ${epNum}`} - ${movie.quality || "HD"}`,
            url: ep.link_m3u8
          });
        }
      });
    });

    for (const [videoId, streams] of Object.entries(epStreamsMap)) {
      fs.writeFileSync(path.join("addon", "stream", "series", `${videoId}.json`), JSON.stringify({ streams }));
    }
  }

  const metaObj = {
    meta: {
      id: customId,
      imdb_id: imdbId || undefined,
      type: itemMediaType,
      name: movie.origin_name ? `${movie.name} (${movie.origin_name})` : movie.name,
      poster: verticalPoster,
      background: horizontalThumb,
      description: cleanPlot,
      releaseInfo: String(movie.year || ""),
      runtime: movie.time || undefined,
      genres,
      cast: Array.isArray(movie.actor) ? movie.actor.filter(Boolean) : [],
      director: Array.isArray(movie.director) ? movie.director.filter(Boolean) : [],
      videos: itemMediaType === "series" ? videos : undefined
    }
  };
  fs.writeFileSync(metaFilePath, JSON.stringify(metaObj));

  const isCompleted = movie.status === "completed" || itemMediaType === "movie";
  archiveDb[customId] = {
    id: customId,
    type: itemMediaType,
    name: movie.name,
    origin_name: movie.origin_name || "",
    poster: verticalPoster,
    genres,
    imdb_id: imdbId,
    completed: isCompleted,
    updatedAt: Date.now()
  };
}
async function run() {
  [
    "addon/catalog/series",
    "addon/catalog/movie",
    "addon/meta/series",
    "addon/meta/movie",
    "addon/stream/series",
    "addon/stream/movie"
  ].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

  // Tự động lấy năm mới nhất từ API /nam-phat-hanh (2026)
  const yearsData = await fetchJson(`${KK_API}/nam-phat-hanh`);
  const latestYear = (yearsData && yearsData.data && yearsData.data.items && yearsData.data.items[0] && yearsData.data.items[0].year) || 2026;


  const catLatest = CATALOGS.find((c) => c.id === "kk_2026");
  if (catLatest) {
    catLatest.name = `KKPhim - Phim Mới ${latestYear} Nhất`;
    catLatest.url = `${KK_API}/v1/api/nam/${latestYear}?page=1&limit=64`;
  }

  const dbPath = path.join("addon", "archive_db.json");
  let archiveDb = {};
  if (fs.existsSync(dbPath)) {
    try {
      archiveDb = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    } catch (e) {
      archiveDb = {};
    }
  }

  const providerManifest = {
    id: "com.huynhsang0603.kkphim",
    name: "KKPhim Việt Nam",
    version: VERSION,
    description: "KKPhim Tiếng Việt gọn gàng - 1 luồng Thuyết Minh & 1 luồng Vietsub",
    author: "huynhsang0603",
    homepage: "https://github.com",
    repository: "https://github.com",
    idPrefixes: ["kk_", "tt", "tmdb:"],
    scrapers: [
      {
        id: "kkphim_vn",
        name: "KKPhim",
        description: "Giao diện tiếng Việt, gọn 1 luồng Thuyết Minh & 1 luồng Vietsub",
        version: VERSION,
        type: "all",
        filename: "provider.js",
        idPrefixes: ["kk_", "tt", "tmdb:"],
        supportedTypes: ["movie", "series", "tv"]
      }
    ]
  };
  fs.writeFileSync("manifest.json", JSON.stringify(providerManifest, null, 2));
  fs.writeFileSync("provider-manifest.json", JSON.stringify(providerManifest, null, 2));

  const addonCatalogs = [
    ...CATALOGS.map((c) => ({
      type: c.type,
      id: c.id,
      name: c.name,
      extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }]
    })),
    {
      type: "series",
      id: "kk_all",
      name: "KKPhim - Kho Lưu Trữ Mới Nhất (1000 Bộ)",
      extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }]
    }
  ];

  const addonManifest = {
    id: "org.github.kkphim.static7",
    version: VERSION,
    name: "KKPhim 7 Danh Mục (Tiếng Việt)",
    description: "7 danh mục trang chủ + Kho lưu trữ KKPhim cho cả Điện thoại và Tivi",
    resources: ["catalog", "meta", "stream"],
    types: ["series", "movie"],
    idPrefixes: ["kk_", "tt"],
    catalogs: addonCatalogs
  };
  fs.writeFileSync(path.join("addon", "manifest.json"), JSON.stringify(addonManifest, null, 2));
  fs.writeFileSync("addon-manifest.json", JSON.stringify(addonManifest, null, 2));

  const processedSlugs = new Set();
  const batchSize = 10;

  for (const cat of CATALOGS) {
    const dir = path.join("addon", "catalog", cat.type);
    const catItems = [];

    for (let p = 1; p <= cat.pages; p++) {
      const pageUrl = cat.url.includes("page=1") ? cat.url.replace("page=1", `page=${p}`) : cat.url;
      const data = await fetchJson(pageUrl);
      const items = (data && data.items) || (data && data.data && data.data.items) || [];
      catItems.push(...items);
    }

    for (let i = 0; i < catItems.length; i += batchSize) {
      const batch = catItems.slice(i, i + batchSize);
      await Promise.all(batch.map((item) => processMovieMeta(item, cat.type, processedSlugs, archiveDb)));
    }

    const metas = catItems.map((item) => {
      const isMovie = item.type === "single" || item.episode_total === "1";
      const customId = `kk_${item.slug}`;
      return {
        id: customId,
        type: isMovie ? "movie" : cat.type,
        name: item.name,
        poster: fixImg(item.poster_url || item.thumb_url),
        genres: (archiveDb[customId] && archiveDb[customId].genres) || []
      };
    });

    fs.writeFileSync(path.join(dir, `${cat.id}.json`), JSON.stringify({ metas }));
  }

  const statePath = path.join("addon", "crawl_state.json");
  let state = { nextDeepPage: 1 };
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch (e) {}
  }

  const deepItems = [];
  let reachedEnd = false;

  for (let p = state.nextDeepPage; p < state.nextDeepPage + PAGES_PER_RUN; p++) {
    const data = await fetchJson(`${KK_API}/danh-sach/phim-moi-cap-nhat?page=${p}`);
    const items = (data && data.items) || [];
    if (items.length === 0) {
      reachedEnd = true;
      break;
    }
    deepItems.push(...items);
  }

  for (let i = 0; i < deepItems.length; i += batchSize) {
    const batch = deepItems.slice(i, i + batchSize);
    await Promise.all(batch.map((item) => processMovieMeta(item, "series", processedSlugs, archiveDb)));
  }

  state.nextDeepPage = reachedEnd ? 1 : state.nextDeepPage + PAGES_PER_RUN;
  fs.writeFileSync(statePath, JSON.stringify(state));

  const sortedArchive = Object.values(archiveDb).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  fs.writeFileSync(dbPath, JSON.stringify(archiveDb));

  const allMetas = sortedArchive.slice(0, MAX_DISPLAY_PER_CATALOG).map((m) => ({
    id: m.id,
    type: m.type,
    name: m.origin_name ? `${m.name} (${m.origin_name})` : m.name,
    poster: m.poster,
    genres: m.genres || []
  }));
  fs.writeFileSync(path.join("addon", "catalog", "series", "kk_all.json"), JSON.stringify({ metas: allMetas }));

  console.log(`Hoan tat! Kho luu tru: ${sortedArchive.length} phim.`);
}

run();
