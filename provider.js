const KK_API = "https://" + ["phimapi", "com"].join(".");
const CINEMETA_API = "https://" + ["v3-cinemeta", "strem", "io"].join(".");

const API_HEADERS = {
    accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
};

async function getMovieTitleFromId(id, mediaType) {
    if (!id || typeof id === "object") return null;
    const rawId = String(id).trim();
    const match = rawId.match(/(tt\d+)/i);
    if (!match) return null;

    const cleanImdbId = match.shift().toLowerCase();
    const typePath = (mediaType === "movie") ? "movie" : "series";

    try {
        const res = await fetch(`${CINEMETA_API}/meta/${typePath}/${cleanImdbId}.json`);
        const json = await res.json();
        const meta = json && json.meta;
        if (!meta || !meta.name) return null;

        return {
            imdbId: cleanImdbId,
            enTitle: meta.name,
            year: String(meta.releaseInfo || meta.year || "").slice(0, 4)
        };
    } catch (e) {
        return null;
    }
}

async function searchKkphim(keyword, targetImdbId, targetYear) {
    if (!keyword) return [];
    try {
        const res = await fetch(`${KK_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword.trim())}&limit=15`, {
            headers: API_HEADERS
        });
        const json = await res.json();
        const items = (json && json.data && json.data.items) || [];

        if (targetImdbId) {
            const exactImdb = items.filter(i => i.imdb && i.imdb.id && String(i.imdb.id).toLowerCase() === targetImdbId);
            if (exactImdb.length > 0) return exactImdb;
        }
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
        let titleHint = "";

        if (tmdbId && typeof tmdbId === "object") {
            rawId = String(tmdbId.id || tmdbId.imdbId || tmdbId.tmdbId || "");
            type = tmdbId.type || mediaType;
            titleHint = tmdbId.title || tmdbId.name || "";
            if (tmdbId.episode) {
                epTarget = parseInt(String(tmdbId.episode).replace(/\D/g, ""), 10) || epTarget;
            }
        }

        if (rawId.includes(":")) {
            const parts = rawId.split(":");
            const epPart = parts.slice(2, 3).join("");
            if (epPart && !isNaN(parseInt(epPart, 10))) {
                epTarget = parseInt(epPart, 10);
            }
        }

        let detailJson = null;
        let forceDubOnly = false;
        let forceSubOnly = false;

        // 1. Nếu nhận diện được ID riêng của KKPhim (kk_tm_... hoặc kk_vs_... hoặc kk_...)
        if (rawId.startsWith("kk_")) {
            let cleanSlug = rawId.split(":").shift().replace(/^kk_/, "");
            if (cleanSlug.startsWith("tm_")) {
                forceDubOnly = true;
                cleanSlug = cleanSlug.replace(/^tm_/, "");
            } else if (cleanSlug.startsWith("vs_")) {
                forceSubOnly = true;
                cleanSlug = cleanSlug.replace(/^vs_/, "");
            }
            const detailRes = await fetch(`${KK_API}/phim/${cleanSlug}`, { headers: API_HEADERS });
            detailJson = await detailRes.json();
        }

        // 2. Nếu Nuvio truyền vào mã số TMDB
        if ((!detailJson || !detailJson.episodes) && !/^tt\d+/i.test(rawId)) {
            const cleanNum = rawId.split(":").shift().replace(/\D/g, "");
            if (cleanNum) {
                try {
                    const kkType = type === "movie" ? "movie" : "tv";
                    const directRes = await fetch(`${KK_API}/tmdb/${kkType}/${cleanNum}`, { headers: API_HEADERS });
                    const directData = await directRes.json();
                    if (directData && directData.status && directData.episodes) {
                        detailJson = directData;
                    }
                } catch (e) {}
            }
        }

        // 3. Nếu Nuvio truyền vào mã IMDb (tt...) hoặc tiêu đề phim
        if (!detailJson || !detailJson.episodes) {
            const baseId = rawId.split(":").shift();
            const info = await getMovieTitleFromId(baseId, type);
            const searchKeyword = (info && info.enTitle) || titleHint;
            const searchYear = (info && info.year) || "";
            const searchImdb = (info && info.imdbId) || (/^tt\d+/i.test(baseId) ? baseId.toLowerCase() : "");

            if (searchKeyword) {
                let items = await searchKkphim(searchKeyword, searchImdb, searchYear);
                if (items.length === 0 && searchKeyword.includes(":")) {
                    items = await searchKkphim(searchKeyword.split(":").shift(), searchImdb, searchYear);
                }
                if (items.length > 0) {
                    const matched = items.shift();
                    const detailRes = await fetch(`${KK_API}/phim/${matched.slug}`, { headers: API_HEADERS });
                    detailJson = await detailRes.json();
                }
            }
        }

        if (!detailJson || !detailJson.episodes) return [];

        const movieName = (detailJson.movie && detailJson.movie.name) || "KKPhim";
        const qualityLabel = (detailJson.movie && detailJson.movie.quality) || "FHD";
        const episodes = detailJson.episodes || [];
        const dubStreams = [];
        const subStreams = [];

        for (const server of episodes) {
            const serverName = server.server_name || "Vietsub";
            const isDub = /thuyết minh|lồng tiếng/i.test(serverName);

            if (forceDubOnly && !isDub) continue;
            if (forceSubOnly && isDub) continue;

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
                    provider: "KKPhim"
                };
                if (isDub) dubStreams.push(streamObj);
                else subStreams.push(streamObj);
            }
        }

        // Nếu lọc forceDubOnly mà phim đó chưa có tập Thuyết Minh -> trả về bản Vietsub dự phòng thay vì báo lỗi
        if (dubStreams.length === 0 && subStreams.length === 0 && (forceDubOnly || forceSubOnly)) {
            for (const server of episodes) {
                const serverName = server.server_name || "Vietsub";
                const targetEp = (server.server_data || []).find(e => {
                    const cleanNum = parseInt(String(e.name || "").replace(/\D/g, ""), 10);
                    return cleanNum === epTarget || (epTarget === 1 && /full|hd/i.test(String(e.name || "")));
                });
                if (targetEp && targetEp.link_m3u8) {
                    subStreams.push({
                        name: `KKPhim (${serverName})`,
                        title: `${movieName} - ${serverName} (${targetEp.name}) [${qualityLabel}]`,
                        url: targetEp.link_m3u8,
                        quality: qualityLabel,
                        provider: "KKPhim"
                    });
                }
            }
        }

        return [...dubStreams, ...subStreams];
    } catch (err) {
        return [];
    }
}

async function getCatalog(type, page) {
    try {
        const listType = type || "phim-moi-cap-nhat";
        const pageNum = page || 1;
        const isDubCat = /thuyet-minh|long-tieng/i.test(listType);
        const prefix = isDubCat ? "tm" : "vs";

        const apiUrl = listType.startsWith("http")
            ? listType
            : `${KK_API}/v1/api/danh-sach/${listType}?page=${pageNum}&limit=24`;

        const res = await fetch(apiUrl, { headers: API_HEADERS });
        const json = await res.json();
        const items = (json && json.items) || (json && json.data && json.data.items) || [];

        return items.map(item => {
            const posterUrl = item.poster_url
                ? (item.poster_url.startsWith("http") ? item.poster_url : `https://phimimg.com{item.poster_url.replace(/^\/+/, "")}`)
                : "";
            const thumbUrl = item.thumb_url
                ? (item.thumb_url.startsWith("http") ? item.thumb_url : `https://phimimg.com{item.thumb_url.replace(/^\/+/, "")}`)
                : posterUrl;

            return {
                id: `kk_${prefix}_${item.slug}`,
                type: (item.type === "single" || item.episode_total === "1") ? "movie" : "series",
                name: item.origin_name ? `${item.name} (${item.origin_name})` : item.name,
                poster: posterUrl,
                background: thumbUrl,
                releaseInfo: String(item.year || ""),
                description: [item.episode_current, item.quality, item.lang].filter(Boolean).join(" • ")
            };
        });
    } catch (e) {
        return [];
    }
}

async function getMeta(id, mediaType) {
    try {
        const rawId = String(id || "").trim();
        const isDubMode = rawId.startsWith("kk_tm_");
        let slug = rawId.split(":").shift().replace(/^kk_(tm_|vs_)?/, "");

        // Nếu Nuvio truyền vào mã IMDb (tt...) -> tự tìm slug bên KKPhim
        if (/^tt\d+/i.test(slug)) {
            const info = await getMovieTitleFromId(slug, mediaType);
            if (!info || !info.enTitle) return null;
            const items = await searchKkphim(info.enTitle, info.imdbId, info.year);
            if (!items || items.length === 0) return null;
            slug = items.shift().slug;
        }

        const res = await fetch(`${KK_API}/phim/${slug}`, { headers: API_HEADERS });
        const json = await res.json();
        const movie = json && json.movie;
        const episodes = (json && json.episodes) || [];
        if (!movie) return null;

        const verticalPoster = movie.poster_url
            ? (movie.poster_url.startsWith("http") ? movie.poster_url : `https://phimimg.com{movie.poster_url.replace(/^\/+/, "")}`)
            : "";
        const horizontalThumb = movie.thumb_url
            ? (movie.thumb_url.startsWith("http") ? movie.thumb_url : `https://phimimg.com{movie.thumb_url.replace(/^\/+/, "")}`)
            : verticalPoster;
        const cleanPlot = (movie.content || "").replace(/<[^>]*>?/gm, "").trim();

        let targetServer = isDubMode
            ? episodes.find(s => /thuyết minh|lồng tiếng/i.test(s.server_name || ""))
            : episodes.find(s => !/thuyết minh|lồng tiếng/i.test(s.server_name || ""));
        if (!targetServer) targetServer = episodes.shift();

        const serverLabel = (targetServer && targetServer.server_name) || (isDubMode ? "Thuyết Minh" : "Vietsub");
        const prefix = isDubMode ? "tm" : "vs";
        const finalId = `kk_${prefix}_${slug}`;
        const videos = [];

        if (targetServer && Array.isArray(targetServer.server_data)) {
            targetServer.server_data.forEach((ep, idx) => {
                const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                const epTitleClean = /^\d+$/.test(String(ep.name).trim()) ? `Tập ${ep.name}` : (ep.name || `Tập ${epNum}`);
                videos.push({
                    id: `${finalId}:1:${epNum}`,
                    title: `${epTitleClean} [${serverLabel}]`,
                    season: 1,
                    episode: epNum,
                    thumbnail: horizontalThumb,
                    overview: `[${serverLabel}] ${movie.name} - ${epTitleClean}: ${cleanPlot.slice(0, 140)}`,
                    released: new Date(Date.now() - (targetServer.server_data.length - idx) * 86400000).toISOString()
                });
            });
        }

        return {
            id: finalId,
            type: movie.type === "single" ? "movie" : "series",
            name: `[${serverLabel}] ${movie.name} (${movie.origin_name})`,
            poster: verticalPoster,
            background: horizontalThumb,
            description: cleanPlot,
            releaseInfo: String(movie.year || ""),
            videos: movie.type === "single" ? undefined : videos
        };
    } catch (e) {
        return null;
    }
}



if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        getStreams,
        searchKkphim,
        getCatalog,
        getMeta
    };
}
