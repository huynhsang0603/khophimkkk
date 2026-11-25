const KK_API = "https://phimapi.com";

async function searchKkphim(keyword) {
    if (!keyword) return [];
    try {
        const res = await fetch(`${KK_API}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword.trim())}&limit=10`);
        const json = await res.json();
        return json?.data?.items || [];
    } catch (e) {
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        let viTitle = "";
        let origTitle = "";
        let targetYear = "";

        if (typeof tmdbId === "object" && tmdbId !== null) {
            viTitle = tmdbId.title || tmdbId.name || "";
            origTitle = tmdbId.original_title || tmdbId.original_name || "";
            const dateStr = tmdbId.release_date || tmdbId.first_air_date || "";
            targetYear = dateStr ? dateStr.split("-").shift() : "";
        } else {
            viTitle = String(tmdbId || "");
        }

        if (!viTitle && !origTitle) return [];
        const epNum = episode || 1;

        // Tìm kiếm ưu tiên tên tiếng Việt trước, nếu không có thì tìm theo tên gốc
        let items = await searchKkphim(viTitle);
        if (items.length === 0 && origTitle && origTitle !== viTitle) {
            items = await searchKkphim(origTitle);
        }
        if (items.length === 0) return [];

        // Lọc ưu tiên bộ phim khớp năm phát hành hoặc tên gốc chuẩn nhất
        let matched = items.find(i =>
            (targetYear && String(i.year) === String(targetYear)) ||
            (origTitle && i.origin_name && i.origin_name.toLowerCase() === origTitle.toLowerCase())
        ) || items.shift();

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

        // Luôn đưa bản Thuyết Minh lên đầu tiên để tiện bấm bằng remote TV
        return [...dubStreams, ...subStreams];
    } catch (err) {
        return [];
    }
}

module.exports = { getStreams };
