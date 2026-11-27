const fs = require("fs");
const path = require("path");

const KK_API = "https://phimapi.com";
const KK_IMG = "https://phimimg.com";
const CINEMETA_API = "https://strem.io";
const VERSION = "1.8.0";

const API_HEADERS = {
  accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
};

const CATALOGS = [
  { type: "series", id: "kk_home", name: "KKPhim - Hôm Nay Xem Gì", url: `${KK_API}/v1/api/home` },
  { type: "series", id: "kk_hk", name: "KKPhim - Phim Hồng Kông", url: `${KK_API}/v1/api/quoc-gia/hong-kong?page=1&limit=30` },
  { type: "series", id: "kk_2026", name: "KKPhim - Phim Mới 2026 Nhất", url: `${KK_API}/v1/api/nam/2026?page=1&limit=30` },
  { type: "series", id: "kk_cn_drama", name: "KKPhim - Phim Bộ Trung Quốc", url: `${KK_API}/v1/api/quoc-gia/trung-quoc?page=1&limit=30` },
  { type: "series", id: "kk_tm", name: "KKPhim - Phim Thuyết Minh", url: `${KK_API}/v1/api/danh-sach/phim-bo?sort_lang=thuyet-minh&limit=30` },
  { type: "series", id: "kk_lt", name: "KKPhim - Phim Lồng Tiếng", url: `${KK_API}/v1/api/danh-sach/phim-bo?sort_lang=long-tieng&limit=30` },
  { type: "series", id: "kk_anime", name: "KKPhim - Phim Hoạt Hình", url: `${KK_API}/v1/api/danh-sach/hoat-hinh?page=1&limit=30` }
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

// Tự động tìm mã IMDb (tt...) từ dữ liệu KKPhim hoặc tra cứu qua Cinemeta
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
  const json = await fetchJson(searchUrl, 6000);
  const metas = (json && json.metas) || [];
  if (metas.length === 0) return "";

  if (targetYear) {
    const exactYear = metas.find((m) => String(m.releaseInfo || "").startsWith(targetYear));
    if (exactYear && /^tt\d+/i.test(exactYear.id)) return exactYear.id.toLowerCase();
  }

  const first = metas.shift();
  return first && /^tt\d+/i.test(first.id) ? first.id.toLowerCase() : "";
}

async function processMovieMeta(item, defaultType, processedSlugs) {
  const isMovie = item.type === "single" || item.episode_total === "1";
  const itemMediaType = isMovie ? "movie" : defaultType;
  const customId = `kk_${item.slug}`;

  if (processedSlugs.has(customId)) return;
  processedSlugs.add(customId);

  const dJson = await fetchJson(`${KK_API}/phim/${item.slug}`);
  const movie = dJson && dJson.movie;
  const episodes = (dJson && dJson.episodes) || [];
  if (!movie) return;

  const imdbId = await resolveImdbId(movie, itemMediaType);
  const cleanPlot = (movie.content || "")
    .replace(/<[^>]*>?/gm, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const verticalPoster = fixImg(movie.poster_url || movie.thumb_url);
  const horizontalThumb = fixImg(movie.thumb_url || movie.poster_url);
  const availableLangs = episodes.map((s) => s.server_name).filter(Boolean).join(" | ");

  const mainServer = episodes.reduce(
    (p, c) =>
      ((c.server_data && c.server_data.length) || 0) > ((p.server_data && p.server_data.length) || 0)
        ? c
        : p,
    { server_data: [] }
  );

  // Gắn prefix IMDb nếu có để Stremio/Nuvio tự nhận phụ đề rời (Vietsub)
  const videoPrefix = imdbId || customId;
  const videos = [];

  (mainServer.server_data || []).forEach((ep, idx) => {
    const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || idx + 1;
    const epTitleClean = /^\d+$/.test(String(ep.name).trim())
      ? `Tập ${ep.name}`
      : ep.name || `Tập ${epNum}`;

    const epMetaTag = [movie.quality, availableLangs, imdbId ? `IMDb: ${imdbId}` : ""]
      .filter(Boolean)
      .join(" • ");
    const epOverview = `[${epTitleClean}${epMetaTag ? ` - ${epMetaTag}` : ""}] ${cleanPlot}`;

    videos.push({
      id: `${videoPrefix}:1:${epNum}`,
      title: `${movie.name} - ${epTitleClean}`,
      season: 1,
      episode: epNum,
      thumbnail: horizontalThumb || verticalPoster,
      poster: verticalPoster,
      overview: epOverview,
      description: epOverview,
      released: new Date(Date.now() - (mainServer.server_data.length - idx) * 86400000).toISOString()
    });
  });

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
      genres: Array.isArray(movie.category) ? movie.category.map((c) => c.name).filter(Boolean) : [],
      cast: Array.isArray(movie.actor) ? movie.actor.filter(Boolean) : [],
      director: Array.isArray(movie.director) ? movie.director.filter(Boolean) : [],
      videos: itemMediaType === "series" ? videos : undefined
    }
  };

  const targetMetaDir = path.join("addon", "meta", itemMediaType);
  fs.writeFileSync(path.join(targetMetaDir, `${customId}.json`), JSON.stringify(metaObj, null, 2));
}

async function run() {
  // 1. Cập nhật Manifest cho Nuvio (v1.8.0)
  const providerManifest = {
    id: "com.huynhsang0603.kkphim",
    name: "KKPhim Việt Nam",
    version: VERSION,
    description: "KKPhim Tiếng Việt gọn gàng - 1 luồng Thuyết Minh & 1 luồng Vietsub (Tối ưu TV 32-bit)",
    author: "huynhsang0603",
    homepage: "https://github.com",
    repository: "https://github.com",
    scrapers: [
      {
        id: "kkphim_vn",
        name: "KKPhim",
        description: "Giao diện tiếng Việt, gọn 1 luồng Thuyết Minh & 1 luồng Vietsub",
        version: VERSION,
        type: "all",
        filename: "provider.js",
        supportedTypes: ["movie", "series", "tv"]
      }
    ]
  };
  fs.writeFileSync("manifest.json", JSON.stringify(providerManifest, null, 2));
  fs.writeFileSync("provider-manifest.json", JSON.stringify(providerManifest, null, 2));

  // 2. Cập nhật Manifest cho Stremio Addon
  fs.mkdirSync("addon", { recursive: true });
  const addonManifest = {
    id: "org.github.kkphim.static7",
    version: VERSION,
    name: "KKPhim 7 Danh Mục (Tiếng Việt)",
    description: "7 danh mục phim mới nhất từ KKPhim kèm mã IMDb lấy Vietsub",
    resources: ["catalog", "meta"],
    types: ["series", "movie"],
    idPrefixes: ["kk_", "tt"],
    catalogs: CATALOGS.map((c) => ({
      type: c.type,
      id: c.id,
      name: c.name
    }))
  };
  fs.writeFileSync(path.join("addon", "manifest.json"), JSON.stringify(addonManifest, null, 2));
  fs.writeFileSync("addon-manifest.json", JSON.stringify(addonManifest, null, 2));

  fs.mkdirSync(path.join("addon", "meta", "series"), { recursive: true });
  fs.mkdirSync(path.join("addon", "meta", "movie"), { recursive: true });
  const processedSlugs = new Set();

  // 3. Quét danh mục và tạo dữ liệu chi tiết theo lô (5 phim/lượt để chạy nhanh & không bị chặn API)
  for (const cat of CATALOGS) {
    const dir = path.join("addon", "catalog", cat.type);
    fs.mkdirSync(dir, { recursive: true });

    const data = await fetchJson(cat.url);
    const items = (data && data.items) || (data && data.data && data.data.items) || [];

    const batchSize = 5;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map((item) => processMovieMeta(item, cat.type, processedSlugs)));
    }

    const metas = items.map((item) => {
      const isMovie = item.type === "single" || item.episode_total === "1";
      const itemMediaType = isMovie ? "movie" : cat.type;
      const rawImdb = item.imdb && item.imdb.id && /^tt\d+/i.test(String(item.imdb.id))
        ? String(item.imdb.id).toLowerCase()
        : undefined;

      return {
        id: `kk_${item.slug}`,
        imdb_id: rawImdb,
        type: itemMediaType,
        name: item.origin_name ? `${item.name} (${item.origin_name})` : item.name,
        poster: fixImg(item.poster_url || item.thumb_url),
        background: fixImg(item.thumb_url || item.poster_url),
        releaseInfo: String(item.year || ""),
        description: [item.episode_current, item.quality, item.lang].filter(Boolean).join(" • ")
      };
    });

    fs.writeFileSync(path.join(dir, `${cat.id}.json`), JSON.stringify({ metas }, null, 2));
    console.log(`Xong: ${cat.name} (${metas.length} phim)`);
  }
}

run();
