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
            const epPart = parts.slice(2, 3).join("");
            if (epPart && !isNaN(parseInt(epPart, 10))) {
                epTarget = parseInt(epPart, 10);
            }
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
    module.exports = {
        getStreams,
        searchKkphim,
        getCatalog,
        getMeta
    };
}
