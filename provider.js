const KK_API = "https://phimapi.com";
const TMDB_KEY = "439c478a771f35c05022d9feabcca01c";
const API_HEADERS = {
    accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

async function resolveMovieInfo(id, mediaType) {
    if (!id || typeof id === "object") return null;
    const rawId = String(id).trim();
    const isImdb = /^tt\d+/i.test(rawId);

    try {
        if (isImdb) {
            const match = rawId.match(/(tt\d+)/i);
            if (!match) return null;
            const cleanImdbId = match.toLowerCase();
            const [viRes, origRes] = await Promise.all([
                fetch(`https://themoviedb.org{cleanImdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=vi-VN`),
                fetch(`https://themoviedb.org{cleanImdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`)
            ]);
            const viJson = await viRes.json();
            const origJson = await origRes.json();
            const viData = viJson.movie_results?. || viJson.tv_results?.;
            const origData = origJson.movie_results?. || origJson.tv_results?.;
            if (!viData && !origData) return null;

            const releaseDate = viData?.release_date || viData?.first_air_date || origData?.release_date || origData?.first_air_date || "";
            return {
                imdbId: cleanImdbId,
                tmdbId: viData?.id || origData?.id || "",
                viTitle: viData?.title || viData?.name || "",
                origTitle: origData?.original_title || origData?.original_name || origData?.title || origData?.name || "",
                year: releaseDate.slice(0, 4),
                mediaType: (viJson.movie_results?.length > 0 || origJson.movie_results?.length > 0) ? "movie" : "tv"
            };
        }

        const cleanId = rawId.replace(/\D/g, "");
        if (!cleanId) return null;
        const typePath = (mediaType === "movie") ? "movie" : "tv";
        const [viRes, origRes] = await Promise.all([
            fetch(`https://themoviedb.org{typePath}/${cleanId}?api_key=${TMDB_KEY}&language=vi-VN`),
            fetch(`https://themoviedb.org{typePath}/${cleanId}?api_key=${TMDB_KEY}`)
        ]);
        const viJson = await viRes.json();
        const origJson = await origRes.json();
        const releaseDate = viJson.release_date || viJson.first_air_date || origJson.release_date || origJson.first_air_date || "";
        return {
            imdbId: "",
            tmdbId: cleanId,
            viTitle: viJson.title || viJson.name || "",
            origTitle: origJson.original_title || origJson.original_name || origJson.title || origJson.name || "",
            year: releaseDate.slice(0, 4),
            mediaType: typePath
        };
    } catch (e) {
        return null;
    }
}

async function searchKkphim(keyword, targetYear) {
    if (!keyword) return [];
    try {
        const res = await fetch(`${KK_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword.trim())}&limit=10`, { headers: API_HEADERS });
        const json = await res.json();
        const items = json?.data?.items || [];
        if (targetYear && items.length > 0) {
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

        if (rawId.includes(":")) {
            const parts = rawId.split(":");
            if (parts.length >= 3 && !isNaN(parseInt(parts, 10))) epTarget = parseInt(parts, 10);
        }

        let detailJson = null;

        if (rawId.startsWith("kk_")) {
            const detailRes = await fetch(`${KK_API}/phim/${rawId.replace(/^kk_/, "")}`, { headers: API_HEADERS });
            detailJson = await detailRes.json();
        } else {
            const baseId = rawId.split(":");
            const isImdb = /^tt\d+/i.test(baseId);

            if (!isImdb) {
                const cleanId = baseId.replace(/\D/g, "");
                if (cleanId) {
                    try {
                        const directRes = await fetch(`${KK_API}/tmdb/${type === "movie" ? "movie" : "tv"}/${cleanId}`, { headers: API_HEADERS });
                        const directData = await directRes.json();
                        if (directData?.status && directData?.episodes) detailJson = directData;
                    } catch (e) {}
                }
            }

            if (!detailJson || !detailJson.episodes) {
                const info = await resolveMovieInfo(baseId, type);
                if (!info) return [];

                if (info.tmdbId) {
                    try {
                        const directRes = await fetch(`${KK_API}/tmdb/${info.mediaType}/${info.tmdbId}`, { headers: API_HEADERS });
                        const directData = await directRes.json();
                        if (directData?.status && directData?.episodes) detailJson = directData;
                    } catch (e) {}
                }

                if (!detailJson || !detailJson.episodes) {
                    let items = await searchKkphim(info.viTitle, info.year);
                    if (items.length === 0 && info.origTitle) items = await searchKkphim(info.origTitle, info.year);
                    if (items.length === 0 && info.origTitle.includes(":")) items = await searchKkphim(info.origTitle.split(":"), info.year);
                    if (items.length === 0) return [];

                    const detailRes = await fetch(`${KK_API}/phim/${items.slug}`, { headers: API_HEADERS });
                    detailJson = await detailRes.json();
                }
            }
        }

        if (!detailJson?.episodes) return [];

        const movieName = detailJson?.movie?.name || "KKPhim";
        const qualityLabel = detailJson?.movie?.quality || "1080p";
        const dubStreams = [];
        const subStreams = [];

        for (const server of detailJson.episodes) {
            const serverName = server.server_name || "";
            const isDub = /thuyết minh|lồng tiếng/i.test(serverName);

            const targetEp = (server.server_data || []).find(e => {
                const label = String(e.name || "").trim().toLowerCase();
                const cleanNum = parseInt(label.replace(/\D/g, ""), 10);
                if (!isNaN(cleanNum) && cleanNum === epTarget) return true;
                if (epTarget === 1 && ["full", "hd", "fhd", "tập 1", "tập 01"].includes(label)) return true;
                return false;
            });

            if (targetEp?.link_m3u8) {
                const streamObj = {
                    name: isDub ? `KKPhim (${serverName})` : "KKPhim Vietsub",
                    title: `${movieName} - ${serverName} (${targetEp.name}) [${qualityLabel}]`,
                    url: targetEp.link_m3u8,
                    quality: qualityLabel,
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
    module.exports = { getStreams, searchKkphim };
}
