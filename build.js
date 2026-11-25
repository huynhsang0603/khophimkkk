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
    // 1. Xuất file manifest.json chuẩn Nuvio Provider (không bị ghi đè mất scrapers)
    const providerManifest = {
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

    // 2. Xuất file addon-manifest.json chứa 7 danh mục chuẩn Stremio
    const addonManifest = {
        id: "org.github.kkphim.static7",
        version: "1.0.0",
        name: "KKPhim 7 Danh Mục (GitHub Serverless)",
        description: "7 danh mục phim mới nhất từ KKPhim chạy 100% trên GitHub",
        resources: ["catalog"],
        types: ["series", "movie"],
        catalogs: CATALOGS.map(c => ({ type: c.type, id: c.id, name: c.name }))
    };
    fs.writeFileSync("addon-manifest.json", JSON.stringify(addonManifest, null, 2));

    // 3. Xuất 7 file JSON danh sách phim tĩnh vào thư mục catalog/
    for (const cat of CATALOGS) {
        const dir = path.join("catalog", cat.type);
        fs.mkdirSync(dir, { recursive: true });

        try {
            const res = await fetch(cat.url);
            const data = await res.json();
            const items = data?.items || data?.data?.items || [];

            const metas = items.map(item => ({
                id: item.tmdb?.id ? `tmdb:${item.tmdb.id}` : `kk_${item.slug}`,
                type: cat.type,
                name: item.origin_name ? `${item.name} (${item.origin_name})` : item.name,
                poster: fixImg(item.poster_url || item.thumb_url),
                background: fixImg(item.thumb_url || item.poster_url),
                description: [item.episode_current, item.quality, item.lang].filter(Boolean).join(" • ")
            }));

            fs.writeFileSync(path.join(dir, `${cat.id}.json`), JSON.stringify({ metas }, null, 2));
            console.log(`Đã cập nhật xong: ${cat.name} (${metas.length} phim)`);
        } catch (e) {
            console.error(`Lỗi danh mục ${cat.id}:`, e.message);
        }
    }
}

run();
