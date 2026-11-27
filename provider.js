const KK_API = "https://" + ["phimapi", "com"].join(".");
const CINEMETA_API = "https://" + ["v3-cinemeta", "strem", "io"].join(".");

const API_HEADERS = {
    accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
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

        const yearStr = String(meta.releaseInfo || meta.year || "").slice(0, 4);
        return {
            imdbId: cleanImdbId,
            enTitle: meta.name,
            year: yearStr
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
        let seasonTarget = parseInt(String(seasonNum || "1").replace(/\D/g, ""), 10) || 1;
        let epTarget = parseInt(String(episodeNum || "1").replace(/\D/g, ""), 10) || 1;

        if (tmdbId && typeof tmdbId === "object" && tmdbId.id) {
            rawId = String(tmdbId.id);
            type = tmdbId.type || mediaType;
            seasonTarget = parseInt(String(tmdbId.season || seasonNum || "1").replace(/\D/g, ""), 10) || 1;
            epTarget = parseInt(String(tmdbId.episode || episodeNum || "1").replace(/\D/g, ""), 10) || 1;
        }

        if (rawId.includes(":")) {
            const parts = rawId.split(":");
            const sPart = parts.slice(1, 2).join("");
            const epPart = parts.slice(2, 3).join("");
            if (sPart && !isNaN(parseInt(sPart, 10))) seasonTarget = parseInt(sPart, 10);
            if (epPart && !isNaN(parseInt(epPart, 10))) epTarget = parseInt(epPart, 10);
        }

        let detailJson = null;
        let forceDubOnly = false;
        let forceSubOnly = false;

        if (rawId.startsWith("kk_")) {
            let cleanPart = rawId.split(":").shift().replace(/^kk_/, "");
            if (cleanPart.startsWith("tm_")) {
                forceDubOnly = true;
                cleanPart = cleanPart.replace(/^tm_/, "");
            } else if (cleanPart.startsWith("vs_")) {
                forceSubOnly = true;
                cleanPart = cleanPart.replace(/^vs_/, "");
            }
            const detailRes = await fetch(`${KK_API}/phim/${cleanPart}`, { headers: API_HEADERS });
            detailJson = await detailRes.json();
        } else {
            const baseId = rawId.split(":").shift();
            const isImdb = /^tt\d+/i.test(baseId);

            if (!isImdb) {
                const cleanId = baseId.replace(/\D/g, "");
                if (cleanId) {
                    try {
                        const kkType = type === "movie" ? "movie" : "tv";
                        const directRes = await fetch(`${KK_API}/tmdb/${kkType}/${cleanId}`, { headers: API_HEADERS });
                        const directData = await directRes.json();
                        if (directData && directData.status && directData.episodes) {
                            detailJson = directData;
                        }
                    } catch (e) {}
                }
            }

            if (!detailJson || !detailJson.episodes) {
                const info = await getMovieTitleFromId(baseId, type);
                if (!info) return [];

                let items = await searchKkphim(info.enTitle, info.imdbId, info.year);
                if (items.length === 0 && info.enTitle.includes(":")) {
                    items = await searchKkphim(info.enTitle.split(":").shift(), info.imdbId, info.year);
                }
                if (items.length === 0) return [];

                const matched = items.shift();
                const detailRes = await fetch(`${KK_API}/phim/${matched.slug}`, { headers: API_HEADERS });
                detailJson = await detailRes.json();
            }
        }

        if (!detailJson || !detailJson.episodes) return [];

        const movieSlug = (detailJson.movie && detailJson.movie.slug) || "kkphim";
        const movieName = (detailJson.movie && detailJson.movie.name) || "KKPhim";
        const qualityLabel = (detailJson.movie && detailJson.movie.quality) || "1080p";
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
                const modeTag = isDub ? "dub" : "sub";
                const groupTag = `kkphim-${movieSlug}-${modeTag}`;
                const nextIdPrefix = isDub ? `kk_tm_${movieSlug}` : `kk_vs_${movieSlug}`;

                const streamObj = {
                    name: isDub ? `🎙️ KKPhim (${serverName})` : `💬 KKPhim (${serverName})`,
                    title: `${movieName} - Tập ${targetEp.name} [${serverName}] (${qualityLabel})`,
                    url: targetEp.link_m3u8,
                    quality: qualityLabel,
                    provider: "KKPhim",
                    bingeGroup: groupTag,
                    behaviorHints: {
                        bingeGroup: groupTag,
                        defaultVideoId: `${nextIdPrefix}:${seasonTarget}:${epTarget + 1}`
                    },
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
    module.exports = {
        getStreams,
        searchKkphim,
        getCatalog,
        getMeta
    };
}
