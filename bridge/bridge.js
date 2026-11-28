// Sodium bridge (v0.10.0; trimmed in v0.10.3) — injected into
// every service page as an initialization script (main
// frame), alongside but separate from the YouTube adblock
// script. This is the page side of the page<->Sodium bridge
// (Jalur B): the foundation the v0.11.0 notification panel
// will stand on.
//
// The page reports to Sodium through WebView2's native host
// messaging: window.chrome.webview.postMessage(JSON string).
// Sodium's Rust side listens with ICoreWebView2's
// WebMessageReceived event (see attach_bridge in
// src-tauri/src/lib.rs). The channel is one-way data: the
// page can only SEND small, strictly-shaped reports; it
// cannot call any Sodium command, and Sodium never evaluates
// anything in response to a page message.
//
// History: v0.10.0–v0.10.2 also carried media detection,
// playback controls and a floating PiP button here. Agung
// tested them and decided to drop the whole media feature
// (28 Nov 2026), so v0.10.3 removed all of it. What remains
// is the bridge itself, the liveness hello, and the
// notification recorder — the parts the notification panel
// needs.
//
// Reports (JSON, versioned):
//   { v: 1, t: "hello" }   (v0.10.1 liveness: posted the
//     moment this script starts and again on
//     DOMContentLoaded; Rust counts ANY raw message as
//     bridge contact, and the hello is the script's own
//     proof of life — it lets the host distinguish "script
//     never ran" from "handler never registered")
//   { v: 1, t: "notif", title: "...", body: "..." }
// Strings are length-capped here and re-clamped in Rust; the
// page is untrusted input either way.
//
// Notification recording (groundwork for the v0.11.0 panel):
// hooks the page-context Notification constructor and
// ServiceWorkerRegistration.showNotification. Notifications
// raised purely inside a service worker without a page-side
// call cannot be seen from here — a known, accepted gap.
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

  // Liveness hello (v0.10.1): posted immediately — if the
  // host object is not up yet at document start, post()
  // drops this silently and the DOMContentLoaded hello
  // below still lands.
  function hello() {
    post({ v: 1, t: "hello" });
  }
  hello();
  try {
    document.addEventListener("DOMContentLoaded", hello);
  } catch (e) { /* the immediate hello already went out */ }

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
