const fs = require("fs");
const path = require("path");

const KK_API = "https://" + ["phimapi", "com"].join(".");
const KK_IMG = "https://" + ["phimimg", "com"].join(".");
const CINEMETA_API = "https://" + ["v3-cinemeta", "strem", "io"].join(".");
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
    if (movieObj && movieObj.imdb && movieObj.imdb.id && /^tt\d+/i.test(String(movieObj.imdb.id))) {
        return String(movieObj.imdb.id).toLowerCase();
    }
    const query = (movieObj && movieObj.origin_name) || "";
    if (!query) return null;

    try {
        const typeStr = mediaType === "movie" ? "movie" : "series";
        const sUrl = `${CINEMETA_API}/catalog/${typeStr}/top/search=${encodeURIComponent(query)}.json`;
        const res = await fetch(sUrl);
        const json = await res.json();
        const metas = (json && json.metas) || [];
        const year = movieObj.year ? String(movieObj.year) : "";

        let best = null;
        if (year && metas.length > 0) {
            best = metas.find(m => m.id && /^tt\d+/i.test(m.id) && String(m.releaseInfo || "").includes(year));
        }
        if (!best && metas.length > 0) {
            best = metas.find(m => m.id && /^tt\d+/i.test(m.id));
        }
        if (best && best.id) return best.id.toLowerCase();
    } catch (e) {}
    return null;
}

async function run() {
    const providerManifest = {
        id: "com.huynhsang0603.kkphim",
        name: "KKPhim Việt Nam",
        version: "1.4.0",
        description: "KKPhim tách riêng Thuyết Minh (Phần 1) & Vietsub (Phần 2) kèm Poster từng tập",
        author: "huynhsang0603",
        homepage: "https://github.com",
        repository: "https://github.com",
        scrapers: [{
            id: "kkphim_vn",
            name: "KKPhim (Thuyết Minh & Vietsub)",
            description: "Phân tách riêng Thuyết Minh / Vietsub, tự động chuyển tập 5s",
            version: "1.4.0",
            type: "all",
            filename: "provider.js",
            supportedTypes: ["movie", "tv"]
        }]
    };
    fs.writeFileSync("manifest.json", JSON.stringify(providerManifest, null, 2));

    fs.mkdirSync("addon", { recursive: true });
    const addonManifest = {
        id: "org.github.kkphim.static7",
        version: "1.4.0",
        name: "KKPhim 7 Danh Mục (Tiếng Việt)",
        description: "7 danh mục phim mới nhất từ KKPhim chạy 100% trên GitHub",
        resources: ["catalog", "meta"],
        types: ["series", "movie"],
        idPrefixes: ["kk_"],
        catalogs: CATALOGS.map(c => ({
            type: c.type,
            id: c.id,
            name: c.name
        }))
    };
    fs.writeFileSync(path.join("addon", "manifest.json"), JSON.stringify(addonManifest, null, 2));

    fs.mkdirSync(path.join("addon", "meta", "series"), { recursive: true });
    fs.mkdirSync(path.join("addon", "meta", "movie"), { recursive: true });
    const processedSlugs = new Set();
    for (const cat of CATALOGS) {
        const dir = path.join("addon", "catalog", cat.type);
        fs.mkdirSync(dir, { recursive: true });
        try {
            const res = await fetch(cat.url, { headers: API_HEADERS });
            const data = await res.json();
            const items = (data && data.items) || (data && data.data && data.data.items) || [];

            for (const item of items) {
                const itemMediaType = item.type === "single" ? "movie" : cat.type;
                const customId = `kk_${item.slug}`;

                if (processedSlugs.has(customId)) continue;
                processedSlugs.add(customId);

                const targetMetaDir = path.join("addon", "meta", itemMediaType);
                try {
                    const dRes = await fetch(`${KK_API}/phim/${item.slug}`, { headers: API_HEADERS });
                    const dJson = await dRes.json();
                    const movie = dJson && dJson.movie;
                    const episodes = (dJson && dJson.episodes) || [];

                    if (movie) {
                        const resolvedImdb = await resolveImdbId(movie, itemMediaType);
                        const cleanPlot = (movie.content || "").replace(/<[^>]*>?/gm, "").trim();
                        const verticalPoster = fixImg(movie.poster_url || movie.thumb_url);
                        const horizontalThumb = fixImg(movie.thumb_url || movie.poster_url);

                        const dubServer = episodes.find(s => /thuyết minh|lồng tiếng/i.test(s.server_name || ""));
                        const subServer = episodes.find(s => !/thuyết minh|lồng tiếng/i.test(s.server_name || ""));
                        const videos = [];

                        // Phần 1 (Season 1): Danh sách toàn bộ tập Thuyết Minh / Lồng Tiếng (nếu có)
                        if (dubServer && Array.isArray(dubServer.server_data)) {
                            const dubLabel = dubServer.server_name || "Thuyết Minh";
                            dubServer.server_data.forEach((ep, idx) => {
                                const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                                const epTitleClean = /^\d+$/.test(String(ep.name).trim()) ? `Tập ${ep.name}` : (ep.name || `Tập ${epNum}`);
                                videos.push({
                                    id: `${customId}:1:${epNum}`,
                                    title: `${epTitleClean} (${dubLabel})`,
                                    season: 1,
                                    episode: epNum,
                                    thumbnail: horizontalThumb,
                                    overview: `[${dubLabel}] ${movie.name} - ${epTitleClean}. ${cleanPlot.slice(0, 140)}`,
                                    released: new Date(Date.now() - (dubServer.server_data.length - idx) * 86400000).toISOString()
                                });
                            });
                        }

                        // Phần 2 (Season 2) [hoặc Phần 1 nếu chỉ có Vietsub]: Danh sách toàn bộ tập Vietsub
                        if (subServer && Array.isArray(subServer.server_data)) {
                            const subSeason = dubServer ? 2 : 1;
                            const subLabel = subServer.server_name || "Vietsub";
                            subServer.server_data.forEach((ep, idx) => {
                                const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                                const epTitleClean = /^\d+$/.test(String(ep.name).trim()) ? `Tập ${ep.name}` : (ep.name || `Tập ${epNum}`);
                                videos.push({
                                    id: `${customId}:${subSeason}:${epNum}`,
                                    title: `${epTitleClean} (${subLabel})`,
                                    season: subSeason,
                                    episode: epNum,
                                    thumbnail: horizontalThumb,
                                    overview: `[${subLabel}] ${movie.name} - ${epTitleClean}. ${cleanPlot.slice(0, 140)}`,
                                    released: new Date(Date.now() - (subServer.server_data.length - idx) * 86400000).toISOString()
                                });
                            });
                        }

                        const availableLangs = episodes.map(s => s.server_name).filter(Boolean).join(" | ");
                        const metaObj = {
                            meta: {
                                id: customId,
                                imdb_id: resolvedImdb || undefined,
                                type: itemMediaType,
                                name: `${movie.name} (${movie.origin_name})`,
                                poster: verticalPoster,
                                background: horizontalThumb,
                                description: `[${availableLangs}] ${cleanPlot}`,
                                releaseInfo: String(movie.year || ""),
                                videos: itemMediaType === "series" ? videos : undefined
                            }
                        };
                        fs.writeFileSync(path.join(targetMetaDir, `${customId}.json`), JSON.stringify(metaObj, null, 2));
                    }
                } catch (err) {}
            }

            const metas = items.map(item => {
                const itemMediaType = item.type === "single" ? "movie" : cat.type;
                return {
                    id: `kk_${item.slug}`,
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
