const fs = require("fs");
const path = require("path");

const KK_API = "https://phimapi.com";
const KK_IMG = "https://phimimg.com";
const CINEMETA_API = "https://strem.io";
const VERSION = "4.0.0";

const PAGES_PER_RUN = 15; // Mỗi lần chạy quét 15 trang mới nhất (~360 phim)
const MAX_DISPLAY_PER_CATALOG = 1000;

const API_HEADERS = {
  accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
};

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
async function processMovieMeta(item, processedSlugs, archiveDb) {
  const customId = `kk_${item.slug}`;
  if (processedSlugs.has(customId)) return;
  processedSlugs.add(customId);

  const existing = archiveDb[customId];
  const isMovie = item.type === "single" || item.episode_total === "1";
  const itemMediaType = isMovie ? "movie" : "series";
  const metaFilePath = path.join("addon", "meta", itemMediaType, `${customId}.json`);

  // Nếu đã có đủ dữ liệu mới (có trường countries và langs) và đã hoàn thành thì bỏ qua
  if (existing && existing.completed && existing.countries && fs.existsSync(metaFilePath)) {
    return;
  }

  const dJson = await fetchJson(`${KK_API}/phim/${item.slug}`);
  const movie = dJson && dJson.movie;
  const episodes = (dJson && dJson.episodes) || [];
  if (!movie) return;

  const actualType = (movie.type === "single" || movie.episode_total === "1") ? "movie" : "series";
  const imdbId = (existing && existing.imdb_id) || (await resolveImdbId(movie, actualType));
  const cleanPlot = (movie.content || "")
    .replace(/<[^>]*>?/gm, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const verticalPoster = fixImg(movie.poster_url || movie.thumb_url);
  const horizontalThumb = fixImg(movie.thumb_url || movie.poster_url);
  const availableLangs = episodes.map((s) => s.server_name).filter(Boolean).join(" | ");
  const genres = Array.isArray(movie.category) ? movie.category.map((c) => c.name).filter(Boolean) : [];
  const countries = Array.isArray(movie.country) ? movie.country.map((c) => c.slug || c.name).filter(Boolean) : [];

  const mainServer = episodes.reduce(
    (p, c) => (((c.server_data && c.server_data.length) || 0) > ((p.server_data && p.server_data.length) || 0) ? c : p),
    { server_data: [] }
  );

  const videos = [];
  const epStreamsMap = {};

  if (actualType === "movie") {
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
      fs.writeFileSync(
      path.join("addon", "stream", "movie", "series", `${customId}.json`),
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
      type: actualType,
      name: movie.origin_name ? `${movie.name} (${movie.origin_name})` : movie.name,
      poster: verticalPoster,
      background: horizontalThumb,
      description: cleanPlot,
      releaseInfo: String(movie.year || ""),
      runtime: movie.time || undefined,
      genres,
      cast: Array.isArray(movie.actor) ? movie.actor.filter(Boolean) : [],
      director: Array.isArray(movie.director) ? movie.director.filter(Boolean) : [],
      videos: actualType === "series" ? videos : undefined
    }
  };
  fs.writeFileSync(path.join("addon", "meta", actualType, `${customId}.json`), JSON.stringify(metaObj));

  const isCompleted = movie.status === "completed" || actualType === "movie";
  archiveDb[customId] = {
    id: customId,
    type: actualType,
    kkType: movie.type || "", // single, series, hoathinh, tvshows
    name: movie.name,
    origin_name: movie.origin_name || "",
    poster: verticalPoster,
    year: Number(movie.year) || 0,
    genres,
    countries,
    langs: `${movie.lang || ""} ${availableLangs}`.toLowerCase(),
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

  const dbPath = path.join("addon", "archive_db.json");
  let archiveDb = {};
  if (fs.existsSync(dbPath)) {
    try { archiveDb = JSON.parse(fs.readFileSync(dbPath, "utf8")); } catch (e) { archiveDb = {}; }
  }

  // Khai báo đầy đủ 9 danh mục chuẩn cho Nuvio TV & Điện thoại
  const addonCatalogs = [
    { type: "series", id: "kk_home", name: "KKPhim - Hôm Nay Xem Gì", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_latest", name: "KKPhim - Phim Mới Cập Nhật", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_2026", name: "KKPhim - Phim Mới 2026 Nhất", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_cn_drama", name: "KKPhim - Phim Bộ Trung Quốc", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_hk", name: "KKPhim - Phim Hồng Kông", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_tm", name: "KKPhim - Phim Thuyết Minh", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_lt", name: "KKPhim - Phim Cổ Trang ", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_anime", name: "KKPhim - Phim Hoạt Hình", extra: [{ name: "genre", isRequired: false, options: GENRES_LIST }] },
    { type: "series", id: "kk_all", name: "KKPhim - Kho Lưu Trữ Mới Nhất (1000 Bộ)", extra: [{ name: "search", isRequired: false }, { name: "genre", isRequired: false, options: GENRES_LIST }] }
  ];

  const addonManifest = {
    id: "org.github.kkphim.static7",
    version: "4.2.0",
    name: "KKPhim 9 Danh Mục (Tiếng Việt)",
    description: "Đầy đủ 9 danh mục + Kho lưu trữ KKPhim cho Nuvio TV & Mobile",
    resources: ["catalog", "meta", "stream"],
    types: ["series", "movie"],
    idPrefixes: ["kk_", "tt"],
    catalogs: addonCatalogs
  };
  fs.writeFileSync(path.join("addon", "manifest.json"), JSON.stringify(addonManifest, null, 2));
  fs.writeFileSync("addon-manifest.json", JSON.stringify(addonManifest, null, 2));

  const processedSlugs = new Set();
  const batchSize = 10;

  // 1. Lấy trang chủ /v1/api/home
  const homeData = await fetchJson(`${KK_API}/v1/api/home`);
  const homeItems = (homeData && homeData.data && homeData.data.items) || (homeData && homeData.items) || [];
  for (let i = 0; i < homeItems.length; i += batchSize) {
    await Promise.all(homeItems.slice(i, i + batchSize).map((item) => processMovieMeta(item, processedSlugs, archiveDb)));
  }

  // 2. Lấy trực tiếp API Năm 2026 (Giữ nguyên cách gọi đã chạy tốt ở bản trước)
  const items2026 = [];
  for (let p = 1; p <= 3; p++) {
    const res2026 = await fetchJson(`${KK_API}/v1/api/year=2026?page=${p}&limit=30`);
    const list = (res2026 && res2026.data && res2026.data.items) || (res2026 && res2026.items) || [];
    items2026.push(...list);
  }
  for (let i = 0; i < items2026.length; i += batchSize) {
    await Promise.all(items2026.slice(i, i + batchSize).map((item) => processMovieMeta(item, processedSlugs, archiveDb)));
  }

  // 3. Quét phim mới cập nhật + quét lùi kho cũ
  const latestItems = [];
  for (let p = 1; p <= PAGES_PER_RUN; p++) {
    const data = await fetchJson(`${KK_API}/danh-sach/phim-moi-cap-nhat?page=${p}`);
    const items = (data && data.items) || [];
    latestItems.push(...items);
  }
  const seedPaths = [
  "/v1/api/quoc-gia/hong-kong",
  "/v1/api/quoc-gia/trung-quoc",
  "/v1/api/danh-sach/phim-thuyet-minh",
  "/v1/api/the-loai/co-",
  "/v1/api/danh-sach/hoat-hinh"
];
  const seedItems = [];
  for (const sp of seedPaths) {
    const res = await fetchJson(`${KK_API}${sp}?page=1&limit=30`);
    const list = (res && res.data && res.data.items) || (res && res.items) || [];
    seedItems.push(...list);
  }

  const statePath = path.join("addon", "crawl_state.json");
  let state = { nextDeepPage: PAGES_PER_RUN + 1 };
  if (fs.existsSync(statePath)) {
    try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (e) {}
  }
  const deepItems = [];
  let reachedEnd = false;
  for (let p = state.nextDeepPage; p < state.nextDeepPage + 5; p++) {
    const data = await fetchJson(`${KK_API}/danh-sach/phim-moi-cap-nhat?page=${p}`);
    const items = (data && data.items) || [];
    if (items.length === 0) { reachedEnd = true; break; }
    deepItems.push(...items);
  }
  state.nextDeepPage = reachedEnd ? 1 : state.nextDeepPage + 5;
  fs.writeFileSync(statePath, JSON.stringify(state));

  const allNewBatch = [...latestItems, ...deepItems, ...seedItems];
  for (let i = 0; i < allNewBatch.length; i += batchSize) {
    await Promise.all(allNewBatch.slice(i, i + batchSize).map((item) => processMovieMeta(item, processedSlugs, archiveDb)));
  }

  // Lưu kho lưu trữ tổng
  fs.writeFileSync(dbPath, JSON.stringify(archiveDb));
  const allSorted = Object.values(archiveDb).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const toMetaCard = (m) => ({
    id: m.id,
    type: m.type,
    name: m.origin_name ? `${m.name} (${m.origin_name})` : m.name,
    poster: m.poster,
    genres: m.genres || []
  });

  const saveCat = (id, list) => {
    const finalMetas = list.slice(0, MAX_DISPLAY_PER_CATALOG).map(toMetaCard);
    fs.writeFileSync(path.join("addon", "catalog", "series", `${id}.json`), JSON.stringify({ metas: finalMetas }));
    console.log(`Xuat xong ${id}: ${finalMetas.length} phim`);
  };

  // Xuất dữ liệu cho cả 9 danh mục
  saveCat("kk_home", homeItems.length > 0 ? homeItems.map((i) => archiveDb[`kk_${i.slug}`]).filter(Boolean) : allSorted.slice(0, 30));
  saveCat("kk_latest", latestItems.map((i) => archiveDb[`kk_${i.slug}`]).filter(Boolean));
  saveCat("kk_2026", items2026.length > 0 ? items2026.map((i) => archiveDb[`kk_${i.slug}`]).filter(Boolean) : allSorted.filter((m) => String(m.year) === "2026"));
  saveCat("kk_cn_drama", allSorted.filter((m) => (m.countries || []).some((c) => c.includes("trung-quoc") || c.includes("Trung Quốc"))));
  saveCat("kk_hk", allSorted.filter((m) => (m.countries || []).some((c) => c.includes("hong-kong") || c.includes("Hồng Kông"))));
  saveCat("kk_tm", allSorted.filter((m) => (m.langs || "").includes("thuyết minh")));
  saveCat("kk_lt", allSorted.filter((m) => (m.countries || []).some((c) => c.includes("trung-quoc") || c.includes("Trung Quốc")) &&
  (m.genres || []).some((g) => g.includes("Cổ Trang"))));

  saveCat("kk_anime", allSorted.filter((m) => m.kkType === "hoathinh" || (m.genres || []).some((g) => g.includes("Hoạt Hình"))));
  saveCat("kk_all", allSorted);

  console.log(`Hoan tat! Tong kho luu tru: ${allSorted.length} phim.`);
}

run();
