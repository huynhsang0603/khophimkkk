const fs = require("fs");
const path = require("path");

const KK_API = "https://" + ["phimapi", "com"].join(".");
const KK_IMG = "https://" + ["phimimg", "com"].join(".");
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

async function run() {
    const providerManifest = {
        id: "com.huynhsang0603.kkphim",
        name: "KKPhim Việt Nam",
        version: "1.5.0",
        description: "KKPhim Tiếng Việt chuẩn mặc định - Tự động phát Thuyết Minh liên tục",
        author: "huynhsang0603",
        homepage: "https://github.com",
        repository: "https://github.com",
        scrapers: [{
            id: "kkphim_vn",
            name: "KKPhim (Ưu tiên Thuyết Minh)",
            description: "Giao diện tiếng Việt, tự động chọn Thuyết Minh khi chuyển tập",
            version: "1.5.0",
            type: "all",
            filename: "provider.js",
            supportedTypes: ["movie", "tv"]
        }]
    };
    fs.writeFileSync("manifest.json", JSON.stringify(providerManifest, null, 2));

    fs.mkdirSync("addon", { recursive: true });
    const addonManifest = {
        id: "org.github.kkphim.static7",
        version: "1.5.0",
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
                        const cleanPlot = (movie.content || "").replace(/<[^>]*>?/gm, "").trim();
                        const verticalPoster = fixImg(movie.poster_url || movie.thumb_url);
                        const horizontalThumb = fixImg(movie.thumb_url || movie.poster_url);

                        const mainServer = episodes.reduce((p, c) => ((c.server_data && c.server_data.length) || 0) > ((p.server_data && p.server_data.length) || 0) ? c : p, { server_data: [] });
                        const videos = [];

                        (mainServer.server_data || []).forEach((ep, idx) => {
                            const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                            const epTitleClean = /^\d+$/.test(String(ep.name).trim()) ? `Tập ${ep.name}` : (ep.name || `Tập ${epNum}`);
                            videos.push({
                                id: `${customId}:1:${epNum}`,
                                title: epTitleClean,
                                season: 1,
                                episode: epNum,
                                thumbnail: horizontalThumb,
                                overview: `${movie.name} - ${epTitleClean}. ${cleanPlot.slice(0, 140)}`,
                                released: new Date(Date.now() - (mainServer.server_data.length - idx) * 86400000).toISOString()
                            });
                        });

                        const metaObj = {
                            meta: {
                                id: customId,
                                type: itemMediaType,
                                name: `${movie.name} (${movie.origin_name})`,
                                poster: verticalPoster,
                                background: horizontalThumb,
                                description: cleanPlot,
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
