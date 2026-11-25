const fs = require("fs");
const path = require("path");

const KK_API = "https://phimapi.com";
const KK_IMG = "https://phimimg.com";

const CATALOGS = [
    { type: "series", id: "kk_hot", name: "KKPhim - Hôm Nay Xem Gì", url: `${KK_API}/danh-sach/phim-moi-cap-nhat-v3?page=1` },
    { type: "series", id: "kk_updated", name: "KKPhim - Phim Mới Cập Nhật", url: `${KK_API}/danh-sach/phim-moi-cap-nhat?page=1` },
    { type: "series", id: "kk_2026", name: "KKPhim - Phim Mới 2026 Nhất", url: `${KK_API}/v1/api/nam/2026?page=1&limit=30` },
    { type: "series", id: "kk_cn_drama", name: "KKPhim - Phim Bộ Trung Quốc", url: `${KK_API}/v1/api/quoc-gia/trung-quoc?page=1&limit=30` },
    { type: "series", id: "kk_tv", name: "KKPhim - Phim Truyền Hình", url: `${KK_API}/v1/api/danh-sach/phim-bo?page=1&limit=30` },
    { type: "series", id: "kk_anime", name: "KKPhim - Phim Hoạt Hình", url: `${KK_API}/v1/api/danh-sach/hoat-hinh?page=1&limit=30` },
    { type: "movie", id: "kk_movies", name: "KKPhim - Phim Lẻ Mới", url: `${KK_API}/v1/api/danh-sach/phim-le?page=1&limit=30` }
];

function fixImg(url) {
    if (!url) return "";
    return url.startsWith("http") ? url : `${KK_IMG}/${url.replace(/^\/+/, "")}`;
}

async function run() {
    // 1. Xuất file manifest.json cho Nuvio Provider (Nguồn phát)
    const providerManifest = {
        id: "com.huynhsang0603.kkphim",
        name: "KKPhim Việt Nam",
        version: "1.0.0",
        description: "Nguồn phim KKPhim Thuyết Minh & Vietsub cho Nuvio",
        author: "huynhsang0603",
        scrapers: [
            {
                id: "kkphim_vn",
                name: "KKPhim (Thuyết Minh & Vietsub)",
                description: "Tự động lấy Thuyết Minh và Vietsub từ KKPhim",
                version: "1.0.0",
                type: "all",
                filename: "provider.js",
                supportedTypes: ["movie", "tv"]
            }
        ]
    };
    fs.writeFileSync("manifest.json", JSON.stringify(providerManifest, null, 2));

    // 2. Xuất file manifest.json chuẩn Stremio vào thư mục con "addon/"
    fs.mkdirSync("addon", { recursive: true });
    const addonManifest = {
        id: "org.github.kkphim.static7",
        version: "1.0.2",
        name: "KKPhim 7 Danh Mục (GitHub Serverless)",
        description: "7 danh mục phim mới nhất từ KKPhim chạy 100% trên GitHub",
        resources: ["catalog", "meta"],
        types: ["series", "movie"],
        idPrefixes: ["kk_", "tmdb:"],
        catalogs: CATALOGS.map(c => ({ type: c.type, id: c.id, name: c.name }))
    };
    fs.writeFileSync(path.join("addon", "manifest.json"), JSON.stringify(addonManifest, null, 2));

    const processedSlugs = new Set();

    // 3. Xuất 7 file JSON danh sách phim tĩnh và chi tiết từng tập có poster
    for (const cat of CATALOGS) {
        const dir = path.join("addon", "catalog", cat.type);
        const metaDir = path.join("addon", "meta", cat.type);
        fs.mkdirSync(dir, { recursive: true });
        fs.mkdirSync(metaDir, { recursive: true });

        try {
            const res = await fetch(cat.url);
            const data = await res.json();
            const items = data?.items || data?.data?.items || [];

            const metas = items.map(item => ({
                id: `kk_${item.slug}`,
                type: cat.type,
                name: item.origin_name ? `${item.name} (${item.origin_name})` : item.name,
                poster: fixImg(item.poster_url || item.thumb_url),
                background: fixImg(item.thumb_url || item.poster_url),
                description: [item.episode_current, item.quality, item.lang].filter(Boolean).join(" • ")
            }));

            fs.writeFileSync(path.join(dir, `${cat.id}.json`), JSON.stringify({ metas }, null, 2));
            console.log(`Đã cập nhật danh mục: ${cat.name} (${metas.length} phim)`);

            for (const item of items) {
                if (processedSlugs.has(item.slug)) continue;
                processedSlugs.add(item.slug);

                try {
                    const detailRes = await fetch(`${KK_API}/phim/${item.slug}`);
                    const detailJson = await detailRes.json();
                    const movie = detailJson?.movie;
                    const episodes = detailJson?.episodes || [];

                    if (movie) {
                        const videos = [];
                        const epThumb = fixImg(movie.thumb_url || movie.poster_url);
                        const mainServer = episodes.reduce((prev, curr) => 
                            (curr.server_data?.length || 0) > (prev.server_data?.length || 0) ? curr : prev
                        , { server_data: [] });

                        (mainServer.server_data || []).forEach((ep, idx) => {
                            const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                            videos.push({
                                id: `kk_${item.slug}:1:${epNum}`,
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
                                id: `kk_${item.slug}`,
                                type: cat.type,
                                name: movie.name,
                                poster: fixImg(movie.poster_url || movie.thumb_url),
                                background: epThumb,
                                description: (movie.content || "").replace(/<[^>]*>?/gm, ""),
                                releaseInfo: String(movie.year || ""),
                                videos: cat.type === "series" ? videos : undefined
                            }
                        };

                        fs.writeFileSync(path.join(metaDir, `kk_${item.slug}.json`), JSON.stringify(metaObj, null, 2));
                    }
                } catch (err) {}
            }
        } catch (e) {
            console.error(`Lỗi danh mục ${cat.id}:`, e.message);
        }
    }
}

run();
