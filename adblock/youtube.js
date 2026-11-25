// Sodium — YouTube adblock (script version 1.0.0, see manifest.json)
//
// Maintained in the Sodium repo (adblock/youtube.js) so it can be
// updated independently of app releases: Sodium periodically
// downloads the newest version of this file and injects it into
// YouTube service webviews at creation time. The copy bundled with
// the app is the fallback until a download succeeds.
//
// What it does: hides ad slots with CSS and, for in-stream ads,
// clicks the skip button or fast-forwards the ad video to its end.
// It only ever runs on youtube.com hosts (Sodium checks before
// injecting; the script checks again here). Not 100% by design:
// some YouTube ads are served from the same domains as the video
// itself, and YouTube actively detects blockers.
(function () {
  "use strict";
  var host = location.hostname || "";
  if (host !== "youtube.com" && !/\.youtube\.com$/.test(host)) return;
  if (window.__sodiumYtAdblock) return;
  window.__sodiumYtAdblock = true;

  var CSS_HIDE = [
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-sparkles-text-search-renderer",
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "#player-ads",
    "#masthead-ad",
    ".ytp-ad-overlay-container",
    ".ytp-ad-text-overlay",
    "ytd-statement-banner-renderer",
    ".ytd-mealbar-promo-renderer",
    "ytd-enforcement-message-view-model"
  ].join(",") + "{display:none!important}";

  function injectStyle() {
    try {
      if (document.getElementById("sodium-yt-adblock-style")) return;
      var st = document.createElement("style");
      st.id = "sodium-yt-adblock-style";
      st.textContent = CSS_HIDE;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* page not ready yet; the observer retries */ }
  }

  function skipAds() {
    try {
      var skip = document.querySelector(
        ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-skip-ad-button-modern, .ytp-ad-skip-button-container button"
      );
      if (skip) { skip.click(); return; }
      var player = document.querySelector(".html5-video-player");
      if (player && player.classList.contains("ad-showing")) {
        var video = player.querySelector("video");
        if (video) {
          try { video.muted = true; } catch (e) {}
          if (isFinite(video.duration) && video.duration > 0) {
            // Jump to the end: YouTube then treats the ad as done
            // and moves on to the video (or the next ad).
            try { video.currentTime = video.duration; } catch (e) {}
          } else {
            try { video.playbackRate = 16; } catch (e) {}
          }
        }
      }
    } catch (e) { /* never break the page */ }
  }

  var tickQueued = false;
  function tick() {
    if (tickQueued) return;
    tickQueued = true;
    setTimeout(function () {
      tickQueued = false;
      injectStyle();
      skipAds();
    }, 200);
  }

  function boot() {
    injectStyle();
    try {
      var obs = new MutationObserver(tick);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* interval below still covers skipping */ }
    setInterval(skipAds, 500);
    skipAds();
  }

  if (document.documentElement) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
