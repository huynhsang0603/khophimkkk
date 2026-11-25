const KK_API = "https://phimapi.com";
const TMDB_KEY = "439c478a771f35c05022d9feabcca01c";

async function getMovieTitleFromTmdb(tmdbId, mediaType) {
    if (!tmdbId) return null;
    if (typeof tmdbId === "object") {
        return {
            viTitle: tmdbId.title || tmdbId.name || "",
            origTitle: tmdbId.original_title || tmdbId.original_name || ""
        };
    }
    const cleanId = String(tmdbId).replace(/\D/g, "");
    if (!cleanId) return { viTitle: String(tmdbId), origTitle: "" };

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
        const res = await fetch(`${KK_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword.trim())}&limit=5`);
        const json = await res.json();
        return json?.data?.items || [];
    } catch (e) {
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        const info = await getMovieTitleFromTmdb(tmdbId, mediaType);
        if (!info || (!info.viTitle && !info.origTitle)) return [];

        const epNum = episode || 1;
        let items = await searchKkphim(info.viTitle);
        if (items.length === 0 && info.origTitle) {
            items = await searchKkphim(info.origTitle);
        }
        if (items.length === 0) return [];

        const matched = items.shift();
        const detailRes = await fetch(`${KK_API}/phim/${matched.slug}`);
        const detailJson = await detailRes.json();

        const movieName = detailJson?.movie?.name || matched.name;
        const episodes = detailJson?.episodes || [];
        const dubStreams = [];
        const subStreams = [];

        for (const server of episodes) {
            const serverName = server.server_name || "";
            const isDub = /thuyết minh|lồng tiếng/i.test(serverName);
            const serverData = server.server_data || [];

            const targetEp = serverData.find(e => {
                const label = String(e.name || "").trim().toLowerCase();
                const cleanNum = label.replace(/\D/g, "");
                if (cleanNum && cleanNum === String(epNum)) return true;
                if (String(epNum) === "1" && (label === "full" || label === "hd")) return true;
                return false;
            });

            if (targetEp && targetEp.link_m3u8) {
                const streamItem = {
                    name: isDub ? "🎙️ KKPhim Thuyết Minh" : "🇻🇳 KKPhim Vietsub",
                    title: `${movieName} - ${serverName} (${targetEp.name})`,
                    url: targetEp.link_m3u8,
                    quality: "1080p",
                    type: "hls"
                };
                if (isDub) dubStreams.push(streamItem);
                else subStreams.push(streamItem);
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
