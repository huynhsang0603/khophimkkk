const KK_API = "https://phimapi.com";
const TMDB_API = "https://" + "api.themoviedb.org/3";
const TMDB_KEY = "439c478a771f35c05022d9feabcca01c";

const API_HEADERS = {
    accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

async function getMovieTitleFromTmdb(id, mediaType) {
    if (!id || typeof id === "object") return null;
    const rawId = String(id).trim();
    const isImdb = /^tt\d+/i.test(rawId);

    try {
        if (isImdb) {
            const match = rawId.match(/(tt\d+)/i);
            if (!match) return null;
            const cleanImdbId = match.shift().toLowerCase();

            const [viRes, origRes] = await Promise.all([
                fetch(`${TMDB_API}/find/${cleanImdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=vi-VN`),
                fetch(`${TMDB_API}/find/${cleanImdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`)
            ]);
            const viJson = await viRes.json();
            const origJson = await origRes.json();

            const viData = (viJson.movie_results && viJson.movie_results.shift()) || (viJson.tv_results && viJson.tv_results.shift());
            const origData = (origJson.movie_results && origJson.movie_results.shift()) || (origJson.tv_results && origJson.tv_results.shift());
            if (!viData && !origData) return null;

            const releaseDate = (viData && (viData.release_date || viData.first_air_date)) || (origData && (origData.release_date || origData.first_air_date)) || "";
            return {
                tmdbId: (viData && viData.id) || (origData && origData.id) || "",
                viTitle: (viData && (viData.title || viData.name)) || "",
                origTitle: (origData && (origData.original_title || origData.original_name || origData.title || origData.name)) || "",
                enTitle: (origData && (origData.title || origData.name)) || "",
                year: releaseDate.slice(0, 4),
                mediaType: (viJson.movie_results && viData && viData.title) ? "movie" : "tv"
            };
        }

        const cleanId = rawId.replace(/\D/g, "");
        if (!cleanId) return null;
        const typePath = (mediaType === "movie") ? "movie" : "tv";

        const [viRes, origRes] = await Promise.all([
            fetch(`${TMDB_API}/${typePath}/${cleanId}?api_key=${TMDB_KEY}&language=vi-VN`),
            fetch(`${TMDB_API}/${typePath}/${cleanId}?api_key=${TMDB_KEY}`)
        ]);
        const viJson = await viRes.json();
        const origJson = await origRes.json();
        const releaseDate = viJson.release_date || viJson.first_air_date || origJson.release_date || origJson.first_air_date || "";

        return {
            tmdbId: cleanId,
            viTitle: viJson.title || viJson.name || "",
            origTitle: origJson.original_title || origJson.original_name || origJson.title || origJson.name || "",
            enTitle: origJson.title || origJson.name || "",
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
        const res = await fetch(`${KK_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword.trim())}&limit=10`, {
            headers: API_HEADERS
        });
        const json = await res.json();
        const items = (json && json.data && json.data.items) || [];

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

        if (rawId.includes(":")) {
            const parts = rawId.split(":");
            const epPart = parts.slice(2, 3).join("");
            if (epPart && !isNaN(parseInt(epPart, 10))) {
                epTarget = parseInt(epPart, 10);
            }
        }

        let detailJson = null;

        if (rawId.startsWith("kk_")) {
            const slug = rawId.replace(/^kk_/, "");
            const detailRes = await fetch(`${KK_API}/phim/${slug}`, { headers: API_HEADERS });
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
                const info = await getMovieTitleFromTmdb(baseId, type);
                if (!info) return [];

                if (info.tmdbId) {
                    try {
                        const directRes = await fetch(`${KK_API}/tmdb/${info.mediaType}/${info.tmdbId}`, { headers: API_HEADERS });
                        const directData = await directRes.json();
                        if (directData && directData.status && directData.episodes) {
                            detailJson = directData;
                        }
                    } catch (e) {}
                }

                if (!detailJson || !detailJson.episodes) {
                    let items = await searchKkphim(info.viTitle, info.year);
                    if (items.length === 0 && info.enTitle) {
                        items = await searchKkphim(info.enTitle, info.year);
                    }
                    if (items.length === 0 && info.origTitle) {
                        items = await searchKkphim(info.origTitle, info.year);
                    }
                    if (items.length === 0 && info.enTitle && info.enTitle.includes(":")) {
                        items = await searchKkphim(info.enTitle.split(":").shift(), info.year);
                    }
                    if (items.length === 0) return [];

                    const matched = items.shift();
                    const detailRes = await fetch(`${KK_API}/phim/${matched.slug}`, { headers: API_HEADERS });
                    detailJson = await detailRes.json();
                }
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
async function getCatalog(type, page) {
    try {
        const listType = type || "phim-moi-cap-nhat";
        const pageNum = page || 1;
        const res = await fetch(`${KK_API}/danh-sach/${listType}?page=${pageNum}`, { headers: API_HEADERS });
        const json = await res.json();
        const items = (json && json.items) || (json && json.data && json.data.items) || [];

        return items.map(item => {
            const posterUrl = item.poster_url
                ? (item.poster_url.startsWith("http") ? item.poster_url : `https://phimimg.com{item.poster_url.replace(/^\/+/, "")}`)
                : "";
            const imdbId = (item.imdb && item.imdb.id && /^tt\d+/i.test(String(item.imdb.id))) ? String(item.imdb.id).toLowerCase() : null;

            return {
                id: imdbId || `kk_${item.slug}`,
                imdb_id: imdbId || undefined,
                type: (item.type === "single" || item.episode_total === "1") ? "movie" : "series",
                name: item.name,
                poster: posterUrl,
                releaseInfo: String(item.year || ""),
                description: item.origin_name || ""
            };
        });
    } catch (e) {
        return [];
    }
}

async function getMeta(id, mediaType) {
    try {
        const rawId = String(id || "").trim();
        let metaResult = null;
        let tmdbId = "";
        let isMovie = (mediaType === "movie");

        if (/^tt\d+/i.test(rawId)) {
            const match = rawId.match(/(tt\d+)/i);
            const cleanImdbId = match ? match.shift().toLowerCase() : rawId;
            const res = await fetch(`${TMDB_API}/find/${cleanImdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=vi-VN`);
            const json = await res.json();
            const item = (json.movie_results && json.movie_results.shift()) || (json.tv_results && json.tv_results.shift());

            if (item) {
                isMovie = Boolean(item.title);
                tmdbId = String(item.id || "");
                metaResult = {
                    id: cleanImdbId,
                    imdb_id: cleanImdbId,
                    type: isMovie ? "movie" : "series",
                    name: item.title || item.name,
                    poster: item.poster_path ? `https://tmdb.org{item.poster_path}` : "",
                    background: item.backdrop_path ? `https://tmdb.org{item.backdrop_path}` : "",
                    description: item.overview || "",
                    releaseInfo: (item.release_date || item.first_air_date || "").slice(0, 4)
                };
            }
        }

        let kkDetail = null;
        if (tmdbId) {
            try {
                const kkRes = await fetch(`${KK_API}/tmdb/${isMovie ? "movie" : "tv"}/${tmdbId}`, { headers: API_HEADERS });
                const kkJson = await kkRes.json();
                if (kkJson && kkJson.status && kkJson.episodes) kkDetail = kkJson;
            } catch (e) {}
        } else if (rawId.startsWith("kk_")) {
            const slug = rawId.replace(/^kk_/, "");
            const kkRes = await fetch(`${KK_API}/phim/${slug}`, { headers: API_HEADERS });
            kkDetail = await kkRes.json();
        }

        if (kkDetail && kkDetail.movie) {
            const movie = kkDetail.movie;
            const episodes = kkDetail.episodes || [];
            const baseStdId = metaResult ? metaResult.id : `kk_${movie.slug}`;
            const epThumb = (metaResult && metaResult.background) || movie.thumb_url || movie.poster_url || "";

            if (!metaResult) {
                isMovie = (movie.type === "single");
                metaResult = {
                    id: baseStdId,
                    type: isMovie ? "movie" : "series",
                    name: movie.name,
                    poster: movie.poster_url || "",
                    background: movie.thumb_url || "",
                    description: (movie.content || "").replace(/<[^>]*>?/gm, ""),
                    releaseInfo: String(movie.year || "")
                };
            }

            if (!isMovie && episodes.length > 0) {
                const epImagesMap = {};
                if (tmdbId) {
                    try {
                        const sRes = await fetch(`${TMDB_API}/tv/${tmdbId}/season/1?api_key=${TMDB_KEY}&language=vi-VN`);
                        const sJson = await sRes.json();
                        (sJson.episodes || []).forEach(e => {
                            if (e.episode_number && e.still_path) {
                                epImagesMap[e.episode_number] = `https://tmdb.org{e.still_path}`;
                            }
                        });
                    } catch (e) {}
                }

                const mainServer = episodes.reduce((p, c) => ((c.server_data && c.server_data.length) || 0) > ((p.server_data && p.server_data.length) || 0) ? c : p, { server_data: [] });
                const videos = [];

                (mainServer.server_data || []).forEach((ep, idx) => {
                    const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                    videos.push({
                        id: `${baseStdId}:1:${epNum}`,
                        title: ep.name || `Tập ${epNum}`,
                        season: 1,
                        episode: epNum,
                        thumbnail: epImagesMap[epNum] || epThumb,
                        overview: `${movie.name} - ${ep.name || `Tập ${epNum}`}`
                    });
                });
                metaResult.videos = videos;
            }
        }

        return metaResult || {};
    } catch (e) {
        return {};
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
