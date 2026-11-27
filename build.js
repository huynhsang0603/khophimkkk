    for (const cat of CATALOGS) {
        const dir = path.join("addon", "catalog", cat.type);
        fs.mkdirSync(dir, { recursive: true });
        try {
            const res = await fetch(cat.url, { headers: API_HEADERS });
            const data = await res.json();
            const items = (data && data.items) || (data && data.data && data.data.items) || [];

            for (const item of items) {
                const itemMediaType = item.type === "single" ? "movie" : cat.type;
                const customId = `kk_${item.slug}`;

                if (processedSlugs.has(customId)) continue;
                processedSlugs.add(customId);

                const targetMetaDir = path.join("addon", "meta", itemMediaType);
                try {
                    const dRes = await fetch(`${KK_API}/phim/${item.slug}`, { headers: API_HEADERS });
                    const dJson = await dRes.json();
                    const movie = dJson && dJson.movie;
                    const episodes = (dJson && dJson.episodes) || [];

                    if (movie) {
                        const cleanPlot = (movie.content || "").replace(/<[^>]*>?/gm, "").trim();
                        const verticalPoster = fixImg(movie.poster_url || movie.thumb_url);
                        const horizontalThumb = fixImg(movie.thumb_url || movie.poster_url);

                        const mainServer = episodes.reduce((p, c) => ((c.server_data && c.server_data.length) || 0) > ((p.server_data && p.server_data.length) || 0) ? c : p, { server_data: [] });
                        const videos = [];

                        (mainServer.server_data || []).forEach((ep, idx) => {
                            const epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
                            const epTitleClean = /^\d+$/.test(String(ep.name).trim()) ? `Tập ${ep.name}` : (ep.name || `Tập ${epNum}`);
                            videos.push({
                                id: `${customId}:1:${epNum}`,
                                title: epTitleClean,
                                season: 1,
                                episode: epNum,
                                thumbnail: horizontalThumb,
                                overview: `${movie.name} - ${epTitleClean}. ${cleanPlot.slice(0, 140)}`,
                                released: new Date(Date.now() - (mainServer.server_data.length - idx) * 86400000).toISOString()
                            });
                        });

                        const metaObj = {
                            meta: {
                                id: customId,
                                type: itemMediaType,
                                name: `${movie.name} (${movie.origin_name})`,
                                poster: verticalPoster,
                                background: horizontalThumb,
                                description: cleanPlot,
                                releaseInfo: String(movie.year || ""),
                                videos: itemMediaType === "series" ? videos : undefined
                            }
                        };
                        fs.writeFileSync(path.join(targetMetaDir, `${customId}.json`), JSON.stringify(metaObj, null, 2));
                    }
                } catch (err) {}
            }

            const metas = items.map(item => {
                const itemMediaType = item.type === "single" ? "movie" : cat.type;
                return {
                    id: `kk_${item.slug}`,
                    type: itemMediaType,
                    name: item.origin_name ? `${item.name} (${item.origin_name})` : item.name,
                    poster: fixImg(item.poster_url || item.thumb_url),
                    background: fixImg(item.thumb_url || item.poster_url),
                    description: [item.episode_current, item.quality, item.lang].filter(Boolean).join(" • ")
                };
            });

            fs.writeFileSync(path.join(dir, `${cat.id}.json`), JSON.stringify({ metas }, null, 2));
            console.log(`Xong: ${cat.name} (${metas.length} phim)`);
        } catch (e) {}
    }
}

run();
