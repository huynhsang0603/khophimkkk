var KK_API = "https://phimapi.com";
var KK_IMG = "https://phimimg.com";
var CINEMETA_API = "https://strem.io";

var API_HEADERS = {
  accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Linux; Android 9; TCL T66) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
};

function fixImg(url) {
  if (!url) return "";
  return String(url).indexOf("http") === 0 ? url : KK_IMG + "/" + String(url).replace(/^\/+/, "");
}

function fetchWithTimeout(url) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      reject(new Error("Timeout"));
    }, 8000);

    fetch(url, { headers: API_HEADERS })
      .then(function (res) {
        clearTimeout(timer);
        resolve(res);
      })
      .catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function getMovieTitleFromId(id, isMovie) {
  if (!id || typeof id === "object") return Promise.resolve(null);
  var rawId = String(id).trim();
  var typePath = isMovie ? "movie" : "series";
  var match = rawId.match(/(tt\d+)/i);
  var cleanNum = rawId.replace(/\D/g, "");
  if (!match && !cleanNum) return Promise.resolve(null);

  var imdbFound = match ? match.shift().toLowerCase() : "";
  var apiUrl = imdbFound
    ? CINEMETA_API + "/meta/" + typePath + "/" + imdbFound + ".json"
    : "https://baby-beamup.club" + typePath + "/tmdb:" + cleanNum + ".json";

  return fetchWithTimeout(apiUrl)
    .then(function (res) { return res.json(); })
    .then(function (json) {
      var meta = json && json.meta;
      if (!meta || !meta.name) return null;
      return {
        imdbId: imdbFound || meta.imdb_id || "",
        enTitle: String(meta.name),
        year: String(meta.releaseInfo || meta.year || "").slice(0, 4)
      };
    })
    .catch(function () { return null; });
}

function searchKkphim(keyword, targetImdbId, targetYear) {
  if (!keyword) return Promise.resolve([]);
  var url = KK_API + "/v1/api/tim-kiem?keyword=" + encodeURIComponent(String(keyword).trim()) + "&limit=15";

  return fetchWithTimeout(url)
    .then(function (res) { return res.json(); })
    .then(function (json) {
      var items = (json && json.data && json.data.items) || [];
      if (targetImdbId) {
        var exactImdb = items.filter(function (i) {
          return i.imdb && i.imdb.id && String(i.imdb.id).toLowerCase() === String(targetImdbId).toLowerCase();
        });
        if (exactImdb.length > 0) return exactImdb;
      }
      if (targetYear && items.length > 1) {
        var exactYear = items.filter(function (i) {
          return String(i.year) === String(targetYear);
        });
        if (exactYear.length > 0) return exactYear;
      }
      return items;
    })
    .catch(function () { return []; });
}

async function getCatalog(type, page) {
  try {
    var listType = type || "phim-moi-cap-nhat";
    var pageNum = page || 1;
    var apiUrl = String(listType).indexOf("http") === 0
      ? listType
      : KK_API + "/v1/api/danh-sach/" + listType + "?page=" + pageNum + "&limit=24";

    if (String(listType).indexOf("http") === 0 && apiUrl.indexOf("page=") === -1 && apiUrl.slice(-5) !== "/home") {
      apiUrl += (apiUrl.indexOf("?") !== -1 ? "&" : "?") + "page=" + pageNum;
    }

    var res = await fetchWithTimeout(apiUrl);
    var json = await res.json();
    var items = (json && json.items) || (json && json.data && json.data.items) || [];

    return items.map(function (item) {
      var posterUrl = fixImg(item.poster_url || item.thumb_url);
      var thumbUrl = fixImg(item.thumb_url || item.poster_url);
      var isSingle = item.type === "single" || item.episode_total === "1";

      return {
        id: "kk_" + item.slug,
        type: isSingle ? "movie" : "series",
        name: item.origin_name ? item.name + " (" + item.origin_name + ")" : item.name,
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
    var rawId = String(id || "").trim();
    var slug = rawId.split(":").shift().replace(/^kk_(tm_|vs_)?/, "");

    if (/^tt\d+/i.test(slug)) {
      var info = await getMovieTitleFromId(slug, mediaType === "movie");
      if (!info || !info.enTitle) return null;
      var items = await searchKkphim(info.enTitle, info.imdbId, info.year);
      if (!items || items.length === 0) return null;
      slug = items.shift().slug;
    }

    var res = await fetchWithTimeout(KK_API + "/phim/" + slug);
    var json = await res.json();
    var movie = json && json.movie;
    var episodes = (json && json.episodes) || [];
    if (!movie) return null;

    var verticalPoster = fixImg(movie.poster_url || movie.thumb_url);
    var horizontalThumb = fixImg(movie.thumb_url || movie.poster_url);
    var cleanPlot = String(movie.content || "").replace(/<[^>]*>?/gm, "").trim();

    var mainServer = { server_data: [] };
    for (var i = 0; i < episodes.length; i++) {
      var sData = episodes[i].server_data || [];
      if (sData.length > mainServer.server_data.length) {
        mainServer = episodes[i];
      }
    }

    var finalId = "kk_" + slug;
    var videos = [];
    var epList = mainServer.server_data || [];

    for (var idx = 0; idx < epList.length; idx++) {
      var ep = epList[idx];
      var epNum = parseInt(String(ep.name || "").replace(/\D/g, ""), 10) || (idx + 1);
      var epTitleClean = /^\d+$/.test(String(ep.name).trim()) ? "Tập " + ep.name : (ep.name || "Tập " + epNum);
      var epOverview = "[" + epTitleClean + "] " + cleanPlot.slice(0, 140);

      videos.push({
        id: finalId + ":1:" + epNum,
        title: epTitleClean,
        season: 1,
        episode: epNum,
        thumbnail: horizontalThumb,
        poster: verticalPoster,
        overview: epOverview,
        released: new Date(Date.now() - (epList.length - idx) * 86400000).toISOString()
      });
    }

    var isMovie = movie.type === "single" || movie.episode_total === "1";

    return {
      id: finalId,
      type: isMovie ? "movie" : "series",
      name: movie.origin_name ? movie.name + " (" + movie.origin_name + ")" : movie.name,
      poster: verticalPoster,
      background: horizontalThumb,
      description: cleanPlot,
      releaseInfo: String(movie.year || ""),
      videos: isMovie ? undefined : videos
    };
  } catch (e) {
    return null;
  }
}
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    var rawId = "";
    var type = String(mediaType || "").toLowerCase();
    var seasonTarget = parseInt(String(seasonNum || "1").replace(/\D/g, ""), 10) || 1;
    var epTarget = parseInt(String(episodeNum || "1").replace(/\D/g, ""), 10) || 1;
    var fallbackTitle = "";

    if (tmdbId && typeof tmdbId === "object") {
      rawId = String(tmdbId.videoId || tmdbId.mediaId || tmdbId.id || tmdbId.tmdbId || tmdbId.imdbId || "");
      type = String(tmdbId.type || tmdbId.mediaType || type).toLowerCase();
      fallbackTitle = String(tmdbId.title || tmdbId.name || "");
      if (tmdbId.season !== undefined) {
        seasonTarget = parseInt(String(tmdbId.season).replace(/\D/g, ""), 10) || seasonTarget;
      }
      var objEp = tmdbId.episode || tmdbId.episodeNumber || tmdbId.ep;
      if (objEp !== undefined) {
        epTarget = parseInt(String(objEp).replace(/\D/g, ""), 10) || epTarget;
      }
    } else {
      rawId = String(tmdbId || "");
    }

    var baseId = rawId.trim();
    if (baseId.indexOf(":") !== -1) {
      var parts = baseId.split(":");
      var firstPart = String(parts.shift() || "").toLowerCase();

      if (firstPart === "tmdb") {
        var tmdbNum = String(parts.shift() || "");
        baseId = "tmdb:" + tmdbNum;
        if (parts.length >= 2) {
          seasonTarget = parseInt(String(parts.shift()), 10) || seasonTarget;
          epTarget = parseInt(String(parts.shift()), 10) || epTarget;
        }
      } else {
        baseId = firstPart;
        if (parts.length >= 2) {
          seasonTarget = parseInt(String(parts.shift()), 10) || seasonTarget;
          epTarget = parseInt(String(parts.shift()), 10) || epTarget;
        } else if (parts.length === 1) {
          epTarget = parseInt(String(parts.shift()), 10) || epTarget;
        }
      }
    }

    var isMovie = type === "movie";
    var detailJson = null;

    if (baseId.indexOf("kk_") === 0) {
      var cleanSlug = baseId.replace(/^kk_(tm_|vs_)?/, "");
      var resKk = await fetchWithTimeout(KK_API + "/phim/" + cleanSlug);
      detailJson = await resKk.json();
    } else {
      var isImdb = /^tt\d+/i.test(baseId);

      if (!isImdb) {
        var cleanNum = baseId.replace(/\D/g, "");
        if (cleanNum) {
          try {
            var kkType = isMovie ? "movie" : "tv";
            var directRes = await fetchWithTimeout(KK_API + "/tmdb/" + kkType + "/" + cleanNum);
            var directData = await directRes.json();
            if (directData && directData.status && Array.isArray(directData.episodes) && directData.episodes.length > 0) {
              detailJson = directData;
            }
          } catch (e) {}
        }
      }

      if (!detailJson || !detailJson.episodes) {
        var info = await getMovieTitleFromId(baseId, isMovie);
        var searchTitle = (info && info.enTitle) ? info.enTitle : fallbackTitle;
        if (!searchTitle) return [];

        var items = [];
        if (!isMovie && seasonTarget > 1) {
          items = await searchKkphim(searchTitle + " Season " + seasonTarget, "", "");
        }
        if (items.length === 0) {
          items = await searchKkphim(searchTitle, info && info.imdbId, info && info.year);
        }
        if (items.length === 0) return [];

        var matched = (!isMovie ? items.find(function (i) { return i.type !== "single"; }) : null) || items.shift();
        if (!matched || !matched.slug) return [];

        var detailRes = await fetchWithTimeout(KK_API + "/phim/" + matched.slug);
        detailJson = await detailRes.json();
      }
    }

    if (!detailJson || !Array.isArray(detailJson.episodes)) return [];

    var movieName = (detailJson.movie && detailJson.movie.name) || "KKPhim";
    var qualityLabel = (detailJson.movie && detailJson.movie.quality) || "FHD";
    var episodes = detailJson.episodes;
    var dubStream = null;
    var subStream = null;

    for (var s = 0; s < episodes.length; s++) {
      var server = episodes[s];
      var serverName = server.server_name || "Vietsub";
      var isTM = /thuyết minh|thuyet minh/i.test(serverName);
      var isLT = /lồng tiếng|long tieng/i.test(serverName);
      var isDub = isTM || isLT;

      if (isDub && dubStream) continue;
      if (!isDub && subStream) continue;

      var serverData = server.server_data || [];
      var targetEp = null;

      for (var j = 0; j < serverData.length; j++) {
        var epItem = serverData[j];
        var label = String(epItem.name || "").trim().toLowerCase();
        var epSlug = String(epItem.slug || "").trim().toLowerCase();

        var numFromName = parseInt(label.replace(/\D/g, ""), 10);
        if (!isNaN(numFromName) && numFromName === epTarget) {
          targetEp = epItem;
          break;
        }

        var numFromSlug = parseInt(epSlug.replace(/\D/g, ""), 10);
        if (!isNaN(numFromSlug) && numFromSlug === epTarget) {
          targetEp = epItem;
          break;
        }
      }

      if (!targetEp && serverData.length > 0 && (epTarget === 1 || serverData.length === 1)) {
        targetEp = serverData.slice(0, 1).shift();
      }

      if (targetEp && targetEp.link_m3u8) {
        var audioLabel = isLT ? "Lồng Tiếng" : (isTM ? "Thuyết Minh" : "Vietsub");
        var streamObj = {
          name: "KKPhim - " + audioLabel,
          title: movieName + " - " + targetEp.name + " (" + serverName + ") [" + qualityLabel + "]",
          url: targetEp.link_m3u8,
          type: "hls",
          quality: qualityLabel,
          provider: "KKPhim",
          headers: {
            "Referer": "https://phimapi.com",
            "User-Agent": API_HEADERS["User-Agent"]
          }
        };
        if (isDub) dubStream = streamObj;
        else subStream = streamObj;
      }
    }

    var result = [];
    if (dubStream) result.push(dubStream);
    if (subStream) result.push(subStream);
    return result;
  } catch (err) {
    return [];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams,
    searchKkphim: searchKkphim,
    getCatalog: getCatalog,
    getMeta: getMeta
  };
}
