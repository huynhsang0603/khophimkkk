const fs = require("fs");
const path = require("path");

const KK_API = "https://phimapi.com";
const KK_IMG = "https://phimimg.com";
const TMDB_KEY = "439c478a771f35c05022d9feabcca01c";
const API_HEADERS = { "accept": "application/json", "User-Agent": "Mozilla/5.0" };

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

async function resolveImdbId(movieObj, mediaType) {
    if (movieObj?.imdb?.id && /^tt\d+/i.test(String(movieObj.imdb.id))) {
        return String(movieObj.imdb.id).toLowerCase();
    }
    const tmdbType = (movieObj?.tmdb?.type === "movie" || mediaType === "movie") ? "movie" : "tv";
    if (movieObj?.tmdb?.id) {
        try {
            const res = await fetch(`https://themoviedb.org{tmdbType}/${movieObj.tmdb.id}/external_ids?api_key=${TMDB_KEY}`);
            const json = await res.json();
            if (json?.imdb_id && /^tt\d+/i.test(json.imdb_id)) return json.imdb_id.toLowerCase();
        } catch (e) {}
    }
    const query = movieObj?.origin_name || movieObj?.name;
    if (query) {
        try {
            const yearParam = movieObj?.year ? `&year=${movieObj.year}&first_air_date_year=${movieObj.year}` : "";
            const sRes = await fetch(`https://themoviedb.org{TMDB_KEY}&query=${encodeURIComponent(query)}${yearParam}`);
            const sJson = await sRes.json();
            const best = sJson?.results?.[0];
            if (best && (best.media_type === "movie" || best.media_type === "tv")) {
                const eRes = await fetch(`https://themoviedb.org{best.media_type}/${best.id}/external_ids?api_key=${TMDB_KEY}`);
                const eJson = await eRes.json();
                if (eJson?.imdb_id && /^tt\d+/i.test(eJson.imdb_id)) return eJson.imdb_id.toLowerCase();
            }
        } catch (e) {}
    }
    return null;
}

async function run() {
    const providerManifest = {
        id: "com.huynhsang0603.kkphim",
        name: "KKPhim Việt Nam",
        version: "1.0.5",
        description: "Nguồn phim KKPhim Thuyết Minh & Vietsub cho Nuvio",
        author: "huynhsang0603",
        scrapers: [{
            id: "kkphim_vn",
            name: "KKPhim (Thuyết Minh & Vietsub)",
            description: "Tự động lấy Thuyết Minh và Vietsub từ KKPhim",
            version: "1.0.5",
            type: "all",
            filename: "provider.js",
            supportedTypes: ["movie", "tv"],
            idPrefixes: ["kk_", "tmdb:", "tt"]
        }]
    };
    fs.writeFileSync("manifest.json", JSON.stringify(providerManifest, null, 2));

    fs.mkdirSync("addon", { recursive: true });
    const addonManifest = {
        id: "org.github.kkphim.static7",
        version: "1.0.6",
        name: "KKPhim 7 Danh Mục (GitHub Serverless)",
        description: "7 danh mục phim mới nhất từ KKPhim chạy 100% trên GitHub",
        resources: ["catalog", "meta"],
        types: ["series", "movie"],
        idPrefixes: ["kk_", "tmdb:", "tt"],
        catalogs: CATALOGS.map(c => ({ type: c.type, id: c.id, name: c.name }))
    };
    fs.writeFileSync(path.join("addon", "manifest.json"), JSON.stringify(addonManifest, null, 2));

    fs.mkdirSync(path.join("addon", "meta", "series"), { recursive: true });
    fs.mkdirSync(path.join("addon", "meta", "movie"), { recursive: true });
    const slugToStandardId = new Map();

    for (const cat of CATALOGS) {
        const dir = path.join("addon", "catalog", cat.type);
        fs.mkdirSync(dir, { recursive: true });
        try {
            const res = await fetch(cat.url, { headers: API_HEADERS });
            const data = await res.json();
            const items = data?.items || data?.data?.items || [];

            for (const item of items) {
                const itemMediaType = item.type === "single" ? "movie" : cat.type;
                if (slugToStandardId.has(item.slug)) {
                    item._standardId = slugToStandardId.get(item.slug);
                    continue;
                }
                const targetMetaDir = path.join("addon", "meta", itemMediaType);
                try {
                    const dRes = await fetch(`${KK_API}/phim/${item.slug}`, { headers: API_HEADERS });
                    const dJson = await dRes.json();
                    const movie = dJson?.movie;
                    const episodes = dJson?.episodes || [];

                    if (movie) {
                        const resolvedImdb = await resolveImdbId(movie, itemMediaType);
                        const tmdbId = movie.tmdb?.id;
                        const standardId = resolvedImdb ? resolvedImdb : (tmdbId ? `tmdb:${tmdbId}` : `kk_${item.slug}`);
                        item._standardId = standardId;
                        slugToStandardId.set(item.slug, standardId);

                        const videos = [];
                        const epThumb = fixImg(movie.thumb_url || movie.poster_url);
                        const mainServer = episodes.reduce((p, c) => (c.server_data?.length || 0) > (p.server_data?.length || 0) ? c : p, { server_data: [] });

                        (mainServer.server_data || []).forEach((ep, idx) => {
                            const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                            videos.push({
                                id: `${standardId}:1:${epNum}`,
                                title: ep.name || `Tập ${epNum}`,
                                season: 1,
                                episode: epNum,
                                thumbnail: epThumb,
                                overview: `${movie.name} - ${ep.name || `Tập ${epNum}`}`,
                                released: new Date().toISOString()
                            });
                        });

                        const metaObj = {
                            meta: {
                                id: standardId,
                                imdb_id: resolvedImdb || undefined,
                                type: itemMediaType,
                                name: movie.name,
                                poster: fixImg(movie.poster_url || movie.thumb_url),
                                background: epThumb,
                                description: (movie.content || "").replace(/<[^>]*>?/gm, ""),
                                releaseInfo: String(movie.year || ""),
                                videos: itemMediaType === "series" ? videos : undefined
                            }
                        };
                        fs.writeFileSync(path.join(targetMetaDir, `${standardId.replace(/:/g, "_")}.json`), JSON.stringify(metaObj, null, 2));
                    }
                } catch (err) {
                    const fallback = `kk_${item.slug}`;
                    item._standardId = fallback;
                    slugToStandardId.set(item.slug, fallback);
                }
            }

            const metas = items.map(item => {
                const itemMediaType = item.type === "single" ? "movie" : cat.type;
                const stdId = item._standardId || `kk_${item.slug}`;
                return {
                    id: stdId,
                    imdb_id: stdId.startsWith("tt") ? stdId : undefined,
                    type: itemMediaType,
                    name: item.origin_name ? `${item.name} (${item.origin_name})` : item.name,
                    poster: fixImg(item.poster_url || item.thumb_url),
                    background: fixImg(item.thumb_url || item.poster_url),
                    description: [item.episode_current, item.quality, item.lang].filter(Boolean).join(" • ")
                };
            });

            fs.writeFileSync(path.join(dir, `${cat.id}.json`), JSON.stringify({ metas }, null, 2));
            console.log(`Xong: ${cat.name} (${metas.length} phim)`);
        } catch (e) {}
    }
}

run();
