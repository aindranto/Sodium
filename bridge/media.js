// Sodium media bridge (v0.10.0) — injected into every service
// page as an initialization script (main frame), alongside but
// separate from the YouTube adblock script. This is Jalur B
// tahap 1: the page side of the page<->Sodium bridge.
//
// The page reports to Sodium through WebView2's native host
// messaging: window.chrome.webview.postMessage(JSON string).
// Sodium's Rust side listens with ICoreWebView2's
// WebMessageReceived event (see attach_media_bridge in
// src-tauri/src/lib.rs). The channel is one-way data: the page
// can only SEND small, strictly-shaped reports; it cannot call
// any Sodium command. Sodium talks back only by evaluating the
// fixed control functions on window.__sodiumMedia below — the
// numbers and selectors in them are ours, never the page's.
//
// Reports (JSON, versioned):
//   { v: 1, t: "media", status: "playing"|"paused"|"none",
//     title: "...", artist: "...", pip: false }
//   { v: 1, t: "notif", title: "...", body: "..." }
// Strings are length-capped here and re-clamped in Rust; the
// page is untrusted input either way.
//
// What lives here:
//  - HTML5 <video> tracking (initial scan + MutationObserver),
//    Media Session metadata, play state, PiP state.
//  - window.__sodiumMedia: the stable control handle Sodium's
//    media commands eval (toggle / seekBy / next / prev).
//  - A Firefox-style floating PiP button over hovered videos.
//    WebView2 has no PiP entry in its context menu (that menu
//    is browser-shell UI), so this overlay is the trigger; an
//    app-injected script's click counts as a user gesture for
//    requestPictureInPicture().
//  - Notification recording (groundwork for the v0.11.0 panel):
//    hooks the page-context Notification constructor and
//    ServiceWorkerRegistration.showNotification. Notifications
//    raised purely inside a service worker without a page-side
//    call cannot be seen from here — a known, accepted gap.
(function () {
  "use strict";
  if (window.__sodiumBridge) return;
  window.__sodiumBridge = true;

  function host() {
    try {
      return window.chrome && window.chrome.webview ? window.chrome.webview : null;
    } catch (e) {
      return null;
    }
  }
  function post(obj) {
    var h = host();
    if (!h) return;
    try {
      h.postMessage(JSON.stringify(obj));
    } catch (e) { /* host gone mid-navigation: drop the report */ }
  }
  function cap(s, n) {
    s = s == null ? "" : String(s);
    return s.length > n ? s.slice(0, n) : s;
  }

  // ------------------------------------------------------------
  // Media tracking
  // ------------------------------------------------------------
  var videos = new Set();
  var hooked = new WeakSet();
  var lastActive = null; // element that most recently played/paused
  var lastKey = "";      // dedupe: last report's shape
  var sendTimer = 0;

  function track(v) {
    if (!v || v.tagName !== "VIDEO") return;
    if (!hooked.has(v)) {
      hooked.add(v);
      var kick = function () {
        lastActive = v;
        scheduleReport();
      };
      v.addEventListener("play", kick);
      v.addEventListener("pause", kick);
      v.addEventListener("ended", kick);
      v.addEventListener("loadedmetadata", scheduleReport);
      v.addEventListener("emptied", scheduleReport);
      v.addEventListener("enterpictureinpicture", scheduleReport);
      v.addEventListener("leavepictureinpicture", scheduleReport);
    }
    videos.add(v);
  }
  function scanTree(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === "VIDEO") track(root);
    if (root.querySelectorAll) {
      var found = root.querySelectorAll("video");
      for (var i = 0; i < found.length; i++) track(found[i]);
    }
  }
  function prune() {
    videos.forEach(function (v) {
      if (!v.isConnected) videos.delete(v);
    });
    if (lastActive && !lastActive.isConnected) lastActive = null;
  }
  // The element a control or report should describe: the PiP
  // element first, then a playing one, then the most recently
  // used one, then any element that has media at all.
  function pickActive() {
    prune();
    try {
      if (document.pictureInPictureElement) return document.pictureInPictureElement;
    } catch (e) { /* very old engine: no PiP API */ }
    var playing = null;
    var withMedia = null;
    videos.forEach(function (v) {
      if (!withMedia && (v.currentSrc || v.src)) withMedia = v;
      if (!playing && !v.paused && !v.ended) playing = v;
    });
    if (playing) return playing;
    if (lastActive && (lastActive.currentSrc || lastActive.src) && !lastActive.ended) return lastActive;
    return withMedia;
  }
  function snapshot() {
    var el = pickActive();
    var pip = false;
    try { pip = !!document.pictureInPictureElement; } catch (e) { /* ignore */ }
    if (!el || el.ended) {
      return { v: 1, t: "media", status: "none", title: "", artist: "", pip: pip };
    }
    var title = "";
    var artist = "";
    try {
      var md = navigator.mediaSession && navigator.mediaSession.metadata;
      if (md) {
        title = md.title || "";
        artist = md.artist || "";
      }
    } catch (e) { /* Media Session unavailable */ }
    if (!title) title = document.title || "";
    return {
      v: 1,
      t: "media",
      status: !el.paused && !el.ended ? "playing" : "paused",
      title: cap(title, 300),
      artist: cap(artist, 200),
      pip: pip
    };
  }
  function report() {
    sendTimer = 0;
    var snap = snapshot();
    var key = snap.status + "|" + snap.title + "|" + snap.artist + "|" + (snap.pip ? "1" : "0");
    if (key === lastKey) return;
    lastKey = key;
    post(snap);
  }
  function scheduleReport() {
    if (sendTimer) return;
    sendTimer = setTimeout(report, 200);
  }

  try {
    scanTree(document.documentElement);
    document.addEventListener("DOMContentLoaded", function () {
      scanTree(document.documentElement);
      scheduleReport();
    });
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) scanTree(added[j]);
      }
      scheduleReport();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // Media Session metadata has no change event, and PiP can
    // change without touching our elements: poll as a backstop.
    // report() dedupes, so an idle page sends nothing.
    setInterval(report, 2000);
  } catch (e) { /* tracking is best-effort; controls still work */ }

  // ------------------------------------------------------------
  // Control handle for Sodium's media commands. Sodium evals
  // exactly these calls with its own constants — nothing here
  // takes input from the page.
  // ------------------------------------------------------------
  window.__sodiumMedia = {
    toggle: function () {
      var el = pickActive();
      if (!el) return;
      try {
        if (el.paused || el.ended) {
          var p = el.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          el.pause();
        }
      } catch (e) { /* element went away */ }
      scheduleReport();
    },
    seekBy: function (delta) {
      var el = pickActive();
      if (!el) return;
      try {
        var t = el.currentTime + (Number(delta) || 0);
        if (isFinite(el.duration) && el.duration > 0) {
          t = Math.max(0, Math.min(el.duration, t));
        } else {
          t = Math.max(0, t);
        }
        el.currentTime = t;
      } catch (e) { /* not seekable (live / no metadata yet) */ }
      scheduleReport();
    },
    next: function () {
      var b = document.querySelector(".ytp-next-button");
      if (b) b.click();
    },
    prev: function () {
      var b = document.querySelector(".ytp-prev-button");
      if (b) b.click();
    }
  };

  // ------------------------------------------------------------
  // Floating PiP button (Firefox-style): shown while the
  // pointer hovers a video big enough to be worth floating.
  // Hit-testing is by bounding rect, not event target, because
  // players (YouTube above all) cover their <video> with
  // overlay layers that swallow pointer events.
  // ------------------------------------------------------------
  var pipBtn = null;
  var pipTarget = null;
  var pointerX = -1;
  var pointerY = -1;
  var rafPending = false;

  function ensurePipBtn() {
    if (pipBtn) return pipBtn;
    var b = document.createElement("button");
    b.type = "button";
    b.title = "Picture in picture";
    b.setAttribute("aria-label", "Picture in picture");
    b.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true">' +
      '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/>' +
      '<rect x="12.5" y="12" width="6" height="4.5" rx="1" fill="#fff" stroke="none"/></svg>';
    b.style.cssText =
      "position:fixed;z-index:2147483647;display:none;align-items:center;justify-content:center;" +
      "width:34px;height:26px;padding:0;border:0;border-radius:7px;cursor:pointer;" +
      "background:rgba(18,18,20,.82);box-shadow:0 2px 8px rgba(0,0,0,.4)";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var v = pipTarget;
      if (!v) return;
      try {
        if (document.pictureInPictureElement === v) {
          document.exitPictureInPicture();
        } else if (document.pictureInPictureElement) {
          document.exitPictureInPicture();
          v.requestPictureInPicture();
        } else {
          v.requestPictureInPicture();
        }
      } catch (err) { /* PiP refused (autoplay policy etc.): stay silent */ }
      scheduleReport();
    });
    (document.documentElement || document).appendChild(b);
    pipBtn = b;
    return b;
  }
  function pipCandidate() {
    var best = null;
    var bestArea = 0;
    videos.forEach(function (v) {
      if (!v.isConnected || v.disablePictureInPicture) return;
      if (!(v.currentSrc || v.src)) return;
      var r = v.getBoundingClientRect();
      if (r.width < 180 || r.height < 100) return;
      if (pointerX < r.left || pointerX > r.right || pointerY < r.top || pointerY > r.bottom) return;
      var area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    });
    return best;
  }
  function placePipBtn() {
    rafPending = false;
    var v = pipCandidate();
    if (!v) {
      pipTarget = null;
      if (pipBtn) pipBtn.style.display = "none";
      return;
    }
    var b = ensurePipBtn();
    var r = v.getBoundingClientRect();
    pipTarget = v;
    b.style.display = "flex";
    b.style.left = Math.max(0, r.right - 44) + "px";
    b.style.top = Math.max(0, r.top + 10) + "px";
  }
  function queuePlace() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(placePipBtn);
  }
  try {
    document.addEventListener("mousemove", function (e) {
      pointerX = e.clientX;
      pointerY = e.clientY;
      queuePlace();
    }, { passive: true });
    document.addEventListener("scroll", queuePlace, { capture: true, passive: true });
    window.addEventListener("resize", queuePlace);
    document.addEventListener("mouseleave", function () {
      pointerX = -1;
      pointerY = -1;
      queuePlace();
    });
  } catch (e) { /* PiP button is an enhancement, never a blocker */ }

  // ------------------------------------------------------------
  // Notification recording (panel arrives in v0.11.0; Rust
  // keeps these in memory only for now). Two page-side doors:
  // the Notification constructor and
  // ServiceWorkerRegistration.showNotification — the call most
  // sites make from the page before the worker displays it.
  // ------------------------------------------------------------
  function reportNotif(title, body) {
    post({ v: 1, t: "notif", title: cap(title, 300), body: cap(body, 1000) });
  }
  try {
    var NativeNotification = window.Notification;
    if (NativeNotification && !NativeNotification.__sodiumHooked) {
      var WrappedNotification = function (title, options) {
        try {
          reportNotif(title, options && options.body);
        } catch (e) { /* never break the page's notification */ }
        return new NativeNotification(title, options);
      };
      WrappedNotification.prototype = NativeNotification.prototype;
      Object.setPrototypeOf(WrappedNotification, NativeNotification);
      WrappedNotification.__sodiumHooked = true;
      window.Notification = WrappedNotification;
    }
  } catch (e) { /* leave the native constructor alone */ }
  try {
    if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype.showNotification) {
      var origShow = ServiceWorkerRegistration.prototype.showNotification;
      if (!origShow.__sodiumHooked) {
        var wrappedShow = function (title, options) {
          try {
            reportNotif(title, options && options.body);
          } catch (e) { /* never break the page's notification */ }
          return origShow.call(this, title, options);
        };
        wrappedShow.__sodiumHooked = true;
        ServiceWorkerRegistration.prototype.showNotification = wrappedShow;
      }
    }
  } catch (e) { /* leave the native method alone */ }
})();
