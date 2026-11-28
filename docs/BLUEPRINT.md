# Sodium — Blueprint Rebuild Ringan (basis: Ferdium)
Dibedah dari: github.com/ferdium/ferdium-app (branch develop, v7.2.4-nightly.4, Electron 44.2.0) — 21 Nov 2026

## 1. Kenapa Ferdium berat (hasil bedah repo asli)

1. **Electron = bawa Chromium sendiri.** Installer ~150-200 MB, shell kosong aja ~200 MB RAM sebelum ada layanan apa pun.
2. **Tiap layanan = 1 proses Chromium hidup.** Setiap service adalah `<webview>` Electron dengan partition terisolasi (cookie/storage sendiri) di `src/components/services/content/ServiceWebview.tsx`. WhatsApp Web / Telegram / Gmail sendiri memang berat: ~150-250 MB per layanan aktif. 6 layanan = 0,9-1,5 GB. Ini biaya terbesar, bukan UI-nya.
3. **Hibernasi ada tapi MATI secara default per layanan.** `src/config.ts`: `DEFAULT_SERVICE_SETTINGS.isHibernationEnabled: false`. Strategi global 300 detik & `hibernateOnStartup: true` tidak menolong kalau per-service-nya off. Secara default semua layanan tetap hidup bersamaan.
4. **Shell-nya sendiri gemuk.** 498 file / ~38 ribu baris di `src/`, 82 dependencies + 63 devDependencies: React 18 + MobX + MUI 5 + Emotion, PLUS server internal AdonisJS 5 + SQLite yang jalan di localhost (`src/internal-server/`) cuma buat mode lokal, PLUS sistem recipes (submodule ferdium-recipes, ratusan layanan), workspaces, todos, translator, dark reader, Sentry, dll.

Kesimpulan jujur: mengganti Electron -> Tauri SAJA tidak menyelesaikan masalah di Windows, karena WebView2 di Windows juga Chromium — 1 halaman WhatsApp Web tetap ~150-250 MB di shell apa pun. Yang bikin jauh lebih ringan adalah **arsitekturnya**, bukan cuma framework-nya.

## 2. Desain rebuild: Sodium

**Stack:** Tauri 2 (Rust) + WebView bawaan OS (WebView2 di Windows / WebKitGTK di Linux / WKWebView di macOS) + UI sidebar polos (HTML/CSS/JS kecil, tanpa React/MUI/MobX).

**Prinsip hemat RAM:**
1. **Hanya 1 webview hidup dalam satu waktu** (mode Ultra), atau maks 2-3 untuk layanan yang di-pin (mode Seimbang). Layanan lain **dimusnahkan total** (bukan disembunyikan) — RAM-nya benar-benar bebas.
2. **Sesi tetap awet:** cookie/localStorage tiap layanan disimpan per-partisi di disk, jadi pas balik ke layanan itu tetap login, tinggal reload 1-3 detik.
3. **Tanpa server internal, tanpa database server.** Konfigurasi = 1 file JSON lokal. Daftar layanan = URL custom, bukan sistem recipes ratusan layanan.
4. **Fitur dipangkas ke yang dipakai harian:** sidebar layanan, tambah/hapus layanan custom, badge judul (dari title halaman), tray, shortcut pindah layanan (Ctrl+1..9), dark mode sederhana.
5. **Yang dikorbankan (disadari):** layanan non-aktif tidak mengirim notifikasi/unread real-time (karena memang tidak hidup). Di mode Seimbang, layanan prioritas (mis. WhatsApp) bisa di-pin tetap hidup supaya notifikasinya jalan.

**Target realistis (Windows, 6 layanan terdaftar):**
| | Ferdium asli | Sodium Ultra (1 aktif) | Sodium Seimbang (2 aktif) |
|---|---|---|---|
| Installer | ~150-200 MB | ~5-15 MB | ~5-15 MB |
| RAM total | ~1,1-1,7 GB | ~250-350 MB | ~400-550 MB |
| Pindah layanan | instan | reload 1-3 detik | pin = instan, lain reload |

Angka layanan aktif per halaman adalah sifat web app-nya sendiri (WhatsApp Web dkk), bukan klaim framework — makanya jumlah webview hidup yang dikunci.

## 3. Keputusan Agung (21 Nov 2026)
- OS target: **Windows** (WebView2)
- Layanan default: **WhatsApp saja** — tapi Sodium tetap mendukung **banyak layanan tanpa batas**: layanan lain ditambah sendiri lewat custom URL ("+ Tambah layanan"); yang dibatasi cuma jumlah yang *hidup bersamaan* (default 1), bukan jumlah yang terdaftar
- Mode: jumlah layanan hidup bersamaan **bisa di-custom user** (keputusan Agung 21 Nov) — setting *Hidup bareng* 1/2/3/5/∞ di sidebar, default 1; yang kena eviction = non-pin paling lama tidak dipakai (LRU); pin selalu bebas eviction

## 4. Rencana build v1
1. Scaffold Tauri 2 + sidebar layanan dari config JSON
2. Webview per layanan dengan data-directory terpisah, destroy-on-switch
3. Pin service, tray, shortcut, persist sesi
4. Build installer Windows (.msi/.exe) — verifikasi ukuran + ukur RAM dengan layanan nyata Agung

## Versioning (aturan sejak 23 Nov 2026, keputusan Agung)

- **Patch (0.6.x)** — perbaikan, poles UI, penyempurnaan fitur yang
  sudah ada. Mayoritas rilis di sini.
- **Minor (0.x.0)** — hanya untuk kemampuan yang benar-benar baru.
- **1.0** — keputusan sadar Agung bahwa Sodium matang untuk publik,
  bukan hasil kehabisan angka.

## 6. Catatan v0.8.0 (25 Nov 2026)

- **Panel Kelola gaya Container** (Firefox/Zen): daftar seret-untuk-urut
  (handle grip; tombol naik/turun pensiun), pensil membuka satu dialog
  edit per layanan, tempat sampah menghapus lewat dialog konfirmasi.
  Panel ikon terpisah dihapus — editor ikon menyatu ke dialog edit.
- **Editor ikon**: sumber logo brand / glyph SVG / teks inisial /
  gambar upload (draft, berlaku saat Simpan). Pilihan eksplisit selalu
  menang atas logo brand (memperbaiki bug teks tak pernah tampil untuk
  layanan ber-brand). **Slider hue** -180..+180 untuk ikon gambar,
  disimpan per layanan (`hue`), diterapkan sebagai CSS `hue-rotate()`.
- **Katalog 31 layanan** (+Lazada, Blibli, Bukalapak, Threads, ChatGPT,
  Gemini, Claude, Notion, Zoom, Google Drive). Tokopedia/Lazada/ChatGPT
  tidak ada di Simple Icons → glyph bawaan. **Emoji dihapus total**
  (keputusan Agung: terkesan jadul); ikon tersimpan yang emoji
  dimigrasi lembut ke inisial nama.
- **Notifikasi update aplikasi**: titik penanda persisten di tombol
  update, cek otomatis saat startup + tiap 6 jam, cek gagal tidak
  menghanguskan jadwal, panel tidak lagi auto-popup.
- **Adblock khusus YouTube**: script di `adblock/youtube.js` (repo)
  di-inject Rust hanya ke webview ber-host youtube.com; panel sendiri
  (saklar global, versi skrip, cek manual) dan **update terpisah**
  dari rilis aplikasi lewat `adblock/manifest.json`. Adblock umum +
  DNS tetap tidak dibangun (keputusan lama Agung).

## 7. Catatan v0.8.2 (25 Nov 2026)

- **Parkir off-screen menggantikan hide** untuk webview layanan
  non-aktif: layanan yang tidak sedang ditampilkan kini dipindah ke
  posisi jauh di luar layar (tetap shown, ukuran tetap), bukan
  di-`hide()`. Alasan: controller WebView2 yang hidden membuat
  halaman berstatus "tidak terlihat" dan Chromium merem aktivitas
  latarnya setelah beberapa menit — WhatsApp (termasuk yang di-pin,
  yang tidak pernah dimusnahkan tapi duduk hidden sejak startup)
  kehilangan sesi dan minta scan QR ulang. Dengan parkir, halaman
  tetap dianggap terlihat dan berjalan normal. Hide asli hanya
  tersisa untuk panel modal UI dan popup link. Resize jendela hanya
  memperbarui ukuran webview terparkir, posisinya tidak ditarik
  kembali ke layar.

## 8. Catatan v0.8.3 (26 Nov 2026)

- **Keluar anggun (graceful shutdown)**: semua jalur keluar — menu
  tray "Keluar", shutdown/logoff Windows, dan app.exit lain —
  sekarang menutup semua webview layanan + popup link lebih dulu,
  memberi jeda ±1,2 detik agar WebView2 sempat men-flush profil ke
  disk, baru proses mati. Alasan: pola pakai Agung hanya menutup
  jendela (aplikasi bersembunyi ke tray, tetap jalan) lalu mematikan
  laptop, sehingga proses terbunuh paksa; sesi WhatsApp yang
  tersimpan lintas database tertinggal sebagai state campur dan
  ditolak WA pada run berikutnya (sudah keluar sejak pertama
  dibuka). Jeda ±1,2 detik dipilih agar tetap muat dalam tenggang
  yang Windows berikan saat shutdown. Perilaku tutup jendela
  (sembunyi ke tray) tidak berubah sama sekali.

## 9. Catatan v0.8.4 (27 Nov 2026)

- **Izin notifikasi akhirnya benar-benar berlaku di webview
  layanan.** Temuan: Shopee Seller Chat menampilkan banner
  "browser memblokir notifikasi" di dalam Sodium. Penyebabnya,
  handler `on_permission_request` yang menjawab Allow untuk
  notifikasi selama ini terdaftar satu kali di level
  `tauri::Builder` aplikasi — handler itu tidak menjangkau webview
  layanan yang dibuat saat runtime (`create_service_webview` tidak
  membawa handler izin sama sekali), dan default WebView2 untuk
  permintaan yang tak terjawab adalah Deny. Perbaikan: handler
  izin kini dipasang langsung di builder setiap webview layanan;
  handler level aplikasi dibiarkan apa adanya (webview UI dsb.),
  webview popup link tidak diubah.
- **Pengaturan Notifikasi per layanan**: di dialog edit layanan
  ada pilihan Izinkan / Ikuti bawaan / Tolak (field `notif` di
  objek layanan; tidak ada field = Izinkan). Frontend
  menyinkronkannya ke Rust lewat command baru `set_service_notif`
  — saat startup untuk semua layanan dan setiap kali dialog edit
  disimpan — dan handler membaca peta kebijakan itu pada setiap
  permintaan, jadi perubahan juga berlaku untuk webview yang
  sudah hidup. WebView2 tidak punya panel site-settings ala
  Chrome, jadi kontrol ini memang harus disediakan Sodium.
- Perilaku notifikasi lain tidak berubah: notifikasi layanan
  tetap tampil sebagai toast Windows dari layanannya sendiri
  (perilaku v0.1.1); yang diperbaiki hanya izinnya, ditambah
  kontrol per layanan ini.

## 10. Catatan v0.8.5 (27 Nov 2026)

- **Tombol notifikasi di bar atas** (usulan Agung): ikon lonceng
  tepat di samping tombol muat ulang, berlaku untuk layanan yang
  sedang aktif — pintu kedua menuju pengaturan Notifikasi per
  layanan dari v0.8.4, tanpa membuka panel Kelola. Ikonnya
  mencerminkan mode efektif layanan aktif: lonceng biasa =
  Izinkan, lonceng redup = Ikuti bawaan, lonceng coret = Tolak;
  tooltip menyebut statusnya dalam kata.
- Klik tombol membuka menu kecil terjangkar di bawahnya berisi
  tiga pilihan radio (Izinkan / Ikuti bawaan / Tolak) dengan
  penanda pada pilihan yang berlaku. Menu ini panel seperti
  panel lain (membukanya menyembunyikan webview layanan) dan
  menutup saat klik di luar, Escape, atau berpindah layanan.
- Memilih mode menulis field `notif` yang sama persis dengan
  dialog edit (mode Izinkan = field dihapus) lalu menyinkronkan
  lewat `pushNotifPolicy` / `set_service_notif` yang sama, jadi
  kedua pintu tidak pernah berbeda isi. Status ikon disegarkan
  pada setiap `render()` — mencakup berpindah layanan, simpan
  dialog edit, hapus/nonaktifkan layanan aktif, impor config,
  dan startup. Bila tidak ada layanan aktif, tombol disembunyikan.
- Murni frontend (`ui/`); sisi Rust tidak berubah sama sekali.

## 11. Catatan v0.8.6 (27 Nov 2026)

- **Poles UI dari audit guidelines pertama** yang memakai dua
  skill adaptasi baru — `sodium_web_guidelines` (dari Vercel,
  tersaring untuk desktop WebView2/JS polos) dan
  `sodium_motion_design` (dari Emil Kowalski). Ke-19 temuan audit
  atas baseline v0.8.5 dibereskan, ditambah 4 perbaikan motion.
  Murni frontend (`ui/`); sisi Rust tidak berubah.
- Aksesibilitas & semantik: toast dan pill unduhan ber-`aria-live`;
  hierarki heading lurus (h1 → h2 judul panel → h3 sub-bagian);
  menu notifikasi ber-role menu/menuitemradio dengan
  `aria-checked` di tempat yang benar; baris quick switcher
  ber-role option dalam listbox dengan `aria-selected` dan
  `aria-activedescendant`; pemisah kelompok dan grip urutan
  Kelola bisa difokuskan — kelompok dibuka lewat Enter/Spasi,
  urutan digeser lewat panah atas/bawah pada grip; pratinjau ikon
  custom bisa dibatalkan lewat keyboard; gambar pratinjau ber-`alt`.
- Formulir: field URL konsisten `type="url"` + `spellcheck="false"`;
  nama/URL kosong kini menampilkan error inline dan memfokuskan
  field pertama (form custom dan dialog edit), bukan berhenti
  diam-diam. Placeholder memakai "…".
- Penjaga data: dialog edit yang kotor (ada perubahan belum
  disimpan) meminta konfirmasi "Buang perubahan?" pada penutupan
  implisit — klik di luar, Escape, berpindah layanan — dan Batal
  pada konfirmasi itu mengembalikan dialog dengan draf utuh.
  Impor konfigurasi kini meminta konfirmasi sebelum mengganti
  seluruh konfigurasi aktif.
- Performa & kerapian: drag Kelola mengukur geometri baris sekali
  di awal seret (pointermove hanya menulis transform/scroll —
  tidak ada lagi layout thrash); perubahan satu badge unread
  memperbarui tile terkait saja, bukan render sidebar penuh;
  area gulir ber-`overscroll-behavior: contain`; angka yang
  berubah (badge, persen zoom, pill unduhan, nilai hue)
  ber-`tabular-nums`.
- Motion: token easing kustom `--ease-out` / `--ease-in-out`
  menggantikan easing bawaan pada gerak masuk-keluar; popover
  notifikasi tumbuh dari tombol lonceng (`scale(0.95)` +
  `transform-origin` di pemicunya), modal masuk dari
  `scale(0.95)`; keluar lebih cepat dari masuk (110ms vs
  160–180ms) lewat keadaan `.closing` sebelum panel disembunyikan;
  pop badge unread memakai transition transform (bisa retarget
  saat angka berubah beruntun), bukan keyframe lagi.

## 12. Catatan v0.8.7 (28 Nov 2026)

Perbaikan bug sesi login terhapus — penyebab asli WhatsApp
keluar-keluar yang ditemukan Agung sendiri: setelah sebuah layanan
di-NONAKTIF-kan beberapa menit lalu diaktifkan lagi, WhatsApp
langsung meminta scan QR, seolah sesinya tidak pernah tersimpan.

- Akar masalahnya satu nama command yang tertukar di `ui/main.js`.
  Tiga jalur UI memanggil `close_service` — command Rust yang
  menutup webview DAN menghapus folder profil layanan
  (`remove_dir_all` + retry latar) — padahal ketiganya wajib
  mempertahankan profil. Command yang benar adalah `close_webview`
  (menutup webview, profil tetap), yang memang dibuat untuk itu dan
  sudah dipakai dengan benar oleh jalur impor config.
- Tiga titik yang diperbaiki (semua kini `close_webview`):
  1. `setServiceDisabled` — menonaktifkan layanan tidak lagi
     menghapus profil; mengaktifkan lagi tidak pernah meminta
     login ulang (komentar di atas fungsi ini sejak awal memang
     menjanjikan itu — sekarang kodenya menepati janjinya).
  2. `deleteService` — menghapus layanan dari daftar tetap
     menyisakan folder profil di disk, jadi menambah lagi layanan
     yang sama memulihkan login, sesuai janji komentarnya.
  3. Simpan dialog edit saat URL berubah — mengganti URL tidak
     lagi membuang sesi login.
- Command Rust `close_service` sekarang tidak dipakai UI sama
  sekali; ia dibiarkan terdaftar di `lib.rs` (tidak ada perubahan
  Rust di rilis ini) untuk berjaga-jaga bila suatu saat memang
  perlu penghapusan profil secara eksplisit.
- Catatan riwayat: bug inilah penjelasan utama saga logout
  WhatsApp sejak 25 Nov — termasuk WA yang di-pin ikut keluar dan
  yang "sudah keluar sejak pertama dibuka" (profilnya sudah
  terhapus pada sesi sebelumnya). Diagnosis parkir off-screen
  (v0.8.2) dan hard-kill saat shutdown (v0.8.3) ternyata BUKAN
  penyebab utamanya; keduanya tetap perbaikan yang sah, tapi obat
  sebenarnya adalah rilis ini.
