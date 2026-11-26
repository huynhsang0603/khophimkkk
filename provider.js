const KK_API = "https://phimapi.com";
const TMDB_KEY = "439c478a771f35c05022d9feabcca01c";

const API_HEADERS = {
    "accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

async function getMovieTitleFromTmdb(tmdbId, mediaType) {
    if (!tmdbId) return null;
    if (typeof tmdbId === "object") {
        return {
            viTitle: tmdbId.title || tmdbId.name || "",
            origTitle: tmdbId.original_title || tmdbId.original_name || "",
            year: (tmdbId.release_date || tmdbId.first_air_date || "").slice(0, 4)
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
        const releaseDate = viJson.release_date || viJson.first_air_date || origJson.release_date || origJson.first_air_date || "";
        return {
            viTitle: viJson.title || viJson.name || "",
            origTitle: origJson.original_title || origJson.original_name || origJson.title || origJson.name || "",
            year: releaseDate.slice(0, 4)
        };
    } catch (e) {
        return null;
    }
}

async function searchKkphim(keyword, targetYear) {
    if (!keyword) return [];
    try {
        const res = await fetch(`${KK_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword.trim())}&limit=10`, {
            headers: API_HEADERS
        });
        const json = await res.json();
        const items = json?.data?.items || [];
        
        // Nếu có năm phát hành, ưu tiên phim khớp đúng năm lên đầu
        if (targetYear && items.length > 1) {
            const exactYear = items.filter(i => String(i.year) === String(targetYear));
            if (exactYear.length > 0) return exactYear;
        }
        return items;
    } catch (e) {
        return [];
    }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        let rawId = String(tmdbId || "");
        let type = mediaType;
        let epTarget = parseInt(String(episodeNum || "1").replace(/\D/g, ""), 10) || 1;

        if (tmdbId && typeof tmdbId === "object" && tmdbId.id) {
            rawId = String(tmdbId.id);
            type = tmdbId.type || mediaType;
            epTarget = parseInt(String(tmdbId.episode || episodeNum || "1").replace(/\D/g, ""), 10) || 1;
        }

        // Tách số tập từ ID dạng kk_slug:1:5
        if (rawId.includes(":")) {
            const parts = rawId.split(":");
            if (parts.length >= 3) {
                const parsedEp = parseInt(parts, 10);
                if (!isNaN(parsedEp)) epTarget = parsedEp;
            }
        }

        let detailJson = null;

        // Trường hợp 1: Phim lấy trực tiếp từ 7 danh mục KKPhim (ID bắt đầu bằng kk_)
        if (rawId.startsWith("kk_")) {
            const baseId = rawId.split(":");
            const slug = baseId.replace(/^kk_/, "");
            const detailRes = await fetch(`${KK_API}/phim/${slug}`, { headers: API_HEADERS });
            detailJson = await detailRes.json();
        } else {
            // Trường hợp 2: Tra cứu trực tiếp qua API TMDB của KKPhim
            const baseId = rawId.split(":");
            const cleanId = baseId.replace(/\D/g, "");
            const kkType = (type === "movie") ? "movie" : "tv";
            if (cleanId) {
                try {
                    const directRes = await fetch(`${KK_API}/tmdb/${kkType}/${cleanId}`, { headers: API_HEADERS });
                    const directData = await directRes.json();
                    if (directData && directData.status && directData.episodes) {
                        detailJson = directData;
                    }
                } catch (e) {}
            }

            // Trường hợp 3: Tìm kiếm qua /v1/api/tim-kiem bằng tên phim từ TMDB
            if (!detailJson || !detailJson.episodes) {
                const info = await getMovieTitleFromTmdb(baseId, type);
                if (!info || (!info.viTitle && !info.origTitle)) return [];

                let items = await searchKkphim(info.viTitle, info.year);
                if (items.length === 0 && info.origTitle) {
                    items = await searchKkphim(info.origTitle, info.year);
                }
                // Thử tìm rút gọn trước dấu ":" nếu tên quá dài
                if (items.length === 0 && info.origTitle && info.origTitle.includes(":")) {
                    items = await searchKkphim(info.origTitle.split(":"), info.year);
                }
                if (items.length === 0) return [];

                const matched = items;
                const detailRes = await fetch(`${KK_API}/phim/${matched.slug}`, { headers: API_HEADERS });
                detailJson = await detailRes.json();
            }
        }

        if (!detailJson || !detailJson.episodes) return [];

        const movieName = detailJson?.movie?.name || "KKPhim";
        const qualityLabel = detailJson?.movie?.quality || "1080p";
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
                if (epTarget === 1 && (label === "full" || label === "hd" || label === "fhd" || label === "tập 1" || label === "tập 01")) return true;
                return false;
            });

            if (targetEp && targetEp.link_m3u8) {
                const streamObj = {
                    name: isDub ? `KKPhim (${serverName})` : "KKPhim Vietsub",
                    title: `${movieName} - ${serverName} (${targetEp.name}) [${qualityLabel}]`,
                    url: targetEp.link_m3u8,
                    quality: qualityLabel,
                    provider: "KKPhim",
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": "https://phimapi.com/"
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
    module.exports = { getStreams, getCatalog, getMeta };
}
