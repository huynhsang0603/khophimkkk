const KK_API = "https://phimapi.com";
const TMDB_KEY = "439c478a771f35c05022d9feabcca01c";

const FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json"
};

async function getMovieTitleFromTmdb(tmdbId, mediaType) {
    if (!tmdbId) return null;
    if (typeof tmdbId === "object") {
        return {
            viTitle: tmdbId.title || tmdbId.name || "",
            origTitle: tmdbId.original_title || tmdbId.original_name || ""
        };
    }
    const cleanId = String(tmdbId).replace(/\D/g, "");
    if (!cleanId) return null;

    const typePath = (mediaType === "movie") ? "movie" : "tv";
    try {
        const [viRes, origRes] = await Promise.all([
            fetch(`https://themoviedb.org{typePath}/${cleanId}?api_key=${TMDB_KEY}&language=vi-VN`),
            fetch(`https://themoviedb.org{typePath}/${cleanId}?api_key=${TMDB_KEY}`)
        ]);
        const viJson = await viRes.json();
        const origJson = await origRes.json();
        return {
            viTitle: viJson.title || viJson.name || "",
            origTitle: origJson.original_title || origJson.original_name || origJson.title || origJson.name || ""
        };
    } catch (e) {
        return null;
    }
}

async function searchKkphim(keyword) {
    if (!keyword) return [];
    try {
        const res = await fetch(`${KK_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword.trim())}&limit=5`, {
            headers: FETCH_HEADERS
        });
        const json = await res.json();
        return json?.data?.items || [];
    } catch (e) {
        return [];
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        // Hỗ trợ cả trường hợp Nuvio truyền tham số dạng Object { id, type, season, episode }
        let rawId = String(tmdbId || "");
        let type = mediaType;
        let epTarget = parseInt(String(episodeNum || "1").replace(/\D/g, ""), 10) || 1;

        if (tmdbId && typeof tmdbId === "object" && tmdbId.id) {
            rawId = String(tmdbId.id);
            type = tmdbId.type || mediaType;
            epTarget = parseInt(String(tmdbId.episode || episodeNum || "1").replace(/\D/g, ""), 10) || 1;
        }

        // Tách số tập từ ID dạng kk_slug:1:5 hoặc tt12345:1:5
        if (rawId.includes(":")) {
            const parts = rawId.split(":");
            if (parts.length >= 3) {
                const parsedEp = parseInt(parts[2], 10);
                if (!isNaN(parsedEp)) epTarget = parsedEp;
            }
        }

        let detailJson = null;

        // Trường hợp 1: Phim lấy từ 7 danh mục KKPhim (ID bắt đầu bằng kk_)
        if (rawId.startsWith("kk_")) {
            const baseId = rawId.split(":")[0];
            const slug = baseId.replace(/^kk_/, "");
            const detailRes = await fetch(`${KK_API}/phim/${slug}`, { headers: FETCH_HEADERS });
            detailJson = await detailRes.json();
        } else {
            // Trường hợp 2: Tra cứu trực tiếp qua API TMDB của KKPhim
            const baseId = rawId.split(":")[0];
            const cleanId = baseId.replace(/\D/g, "");
            const kkType = (type === "movie") ? "movie" : "tv";
            if (cleanId) {
                try {
                    const directRes = await fetch(`${KK_API}/tmdb/${kkType}/${cleanId}`, { headers: FETCH_HEADERS });
                    const directData = await directRes.json();
                    if (directData && directData.status && directData.episodes) {
                        detailJson = directData;
                    }
                } catch (e) {}
            }

            // Trường hợp 3: Tìm kiếm theo tên tiếng Việt / tên gốc từ TMDB
            if (!detailJson || !detailJson.episodes) {
                const info = await getMovieTitleFromTmdb(baseId, type);
                if (!info || (!info.viTitle && !info.origTitle)) return [];

                let items = await searchKkphim(info.viTitle);
                if (items.length === 0 && info.origTitle) {
                    items = await searchKkphim(info.origTitle);
                }
                if (items.length === 0) return [];

                const matched = items[0];
                const detailRes = await fetch(`${KK_API}/phim/${matched.slug}`, { headers: FETCH_HEADERS });
                detailJson = await detailRes.json();
            }
        }

        if (!detailJson || !detailJson.episodes) return [];

        const movieName = detailJson?.movie?.name || "KKPhim";
        const episodes = detailJson?.episodes || [];
        const dubStreams = [];
        const subStreams = [];

        for (const server of episodes) {
            const serverName = server.server_name || "";
            const isDub = /thuyết minh|lồng tiếng/i.test(serverName);
            const serverData = server.server_data || [];

            const targetEp = serverData.find(e => {
                const label = String(e.name || "").trim().toLowerCase();
                const cleanNum = parseInt(label.replace(/\D/g, ""), 10);
                if (!isNaN(cleanNum) && cleanNum === epTarget) return true;
                if (epTarget === 1 && (label === "full" || label === "hd" || label === "tập 1" || label === "tập 01")) return true;
                return false;
            });

            if (targetEp && targetEp.link_m3u8) {
                const streamObj = {
                    name: isDub ? "KKPhim Thuyết Minh" : "KKPhim Vietsub",
                    title: `${movieName} - ${serverName} (${targetEp.name})`,
                    url: targetEp.link_m3u8,
                    quality: "1080p",
                    provider: "KKPhim",
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": "https://phimapi.com"
                    }
                };
                if (isDub) dubStreams.push(streamObj);
                else subStreams.push(streamObj);
            }
        }

        return [...dubStreams, ...subStreams];
    } catch (err) {
        return [];
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
}
