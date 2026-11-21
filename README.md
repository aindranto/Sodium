# Sodium (Na)

> All your social & messaging services in one place — **the light way.**

**Sodium** is a lightweight rebuild of the [Ferdium](https://github.com/ferdium/ferdium-app) concept, created because Ferdium (Electron) is hungry: ~200 MB for the shell alone, plus 150-250 MB for *every* service you keep open.

The name: Ferdium is named like a chemical element — so its lighter sibling is **Sodium**, an actual element (`Na`) and one of the lightest metals. **So**dium for **So**cial.

> Sodium is a clean-room reimplementation inspired by Ferdium's idea, not a fork of its code.

## Why is Sodium lighter?

Switching frameworks alone does not fix RAM on Windows (WebView2 is Chromium too — one WhatsApp Web page costs what it costs). Sodium's saving comes from its architecture:

1. **Tauri 2 + the OS webview** instead of a bundled Chromium — installer ~5-15 MB, shell RAM in the tens of MB.
You can register **unlimited services** (WhatsApp is preinstalled; add any other site as a custom URL). Sodium's rule is about how many are *alive*, not how many you may register:

2. **How many webviews stay alive is your setting** (sidebar: *Hidup bareng* — 1 / 2 / 3 / 5 / ∞, default 1). Switching past the limit *destroys* the least-recently-used webview (it does not just hide it). Register 10 services, pay for the number you chose. Pinned services are exempt from eviction.
3. **Pinned services are the exception** — pin WhatsApp and it stays alive for notifications while you use something else.
4. **Sessions persist on disk** per service (own profile folder), so a destroyed service comes back still logged in — it just reloads (1-3 s).
5. **No internal server, no database, no recipes system for hundreds of services.** Config is local; services are just URLs you add yourself.

Target platform: **Windows** (WebView2, preinstalled on Windows 11). Realistic target (6 services registered): **~250-350 MB total**, vs ~1.1-1.7 GB in Ferdium with all 6 alive.

Full analysis of Ferdium's source and the design trade-offs: [docs/BLUEPRINT.md](docs/BLUEPRINT.md)

## Status

v0.1.0 — initial scaffold. Ships with **WhatsApp** as the one default service; every other service is added by the user as a custom URL. Sidebar + service switching with destroy-on-switch, pinned services, per-service persistent profiles, Ctrl+1..9 shortcuts. Not yet: unread badges, tray, notifications bridge, auto-update.

## Develop

Requirements: [Rust](https://www.rust-lang.org/tools/install), Node 20+, and on Windows the WebView2 runtime (preinstalled on Windows 11), on Linux `webkit2gtk`.

```bash
npm install
npm run dev     # tauri dev
npm run build   # tauri build -> installer in src-tauri/target/release/bundle
```

## License

MIT. Concept inspired by Ferdium (Apache-2.0) — thank you to the Ferdium community.
