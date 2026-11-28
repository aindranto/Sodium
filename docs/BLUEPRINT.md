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

## 13. Catatan v0.8.8 (28 Nov 2026)

Dua paket: penyempurnaan sistem izin (mikrofon & kamera + tanya
izin di awal) dan petunjuk kelompok kosong di Kelola. Versi
tetap patch: paket pertama menyempurnakan sistem izin per
layanan yang sudah ada sejak v0.8.4 (bukan kemampuan yang sama
sekali baru), dan paket kedua adalah quick win pada panel Kelola
yang sudah ada.

### Paket A — Izin mikrofon & kamera + tanya izin di awal

- Sebelumnya handler `.on_permission_request` di webview layanan
  hanya menjawab notifikasi (dari `notif_policy`); mikrofon dan
  kamera jatuh ke `PermissionResponse::Default`, yang di
  WebView2 praktiknya ditolak diam-diam — panggilan suara/video
  (WhatsApp Call, Meet) tidak pernah bisa mendapat mic/kamera.
- Rust: peta `media_policy` di AppState sejajar `notif_policy`,
  command baru `set_service_media(id, mode)` dengan semantik
  identik `set_service_notif` ("allow"|"default"|"deny", absen =
  allow), dan handler izin kini menjawab
  `PermissionKind::Microphone | PermissionKind::Camera` dari
  peta itu (nama varian terverifikasi dari dokumentasi crate
  tauri 2.12.7, versi yang dikunci Cargo.lock). Handler level
  Builder aplikasi tidak berubah.
- Frontend: field `media` di objek layanan (hanya nilai
  non-bawaan yang disimpan, pola sama seperti `notif`),
  `pushMediaPolicy(s)` dipanggil di semua tempat yang sama
  dengan `pushNotifPolicy(s)` (startup, simpan edit, impor
  config, duplikat), dan select kedua "Mikrofon & kamera" di
  dialog edit di samping select "Notifikasi". Tombol lonceng di
  bar atas tetap khusus notifikasi.
- Dialog tanya izin di awal: field boolean `permAsked` di objek
  layanan. Saat sebuah layanan berhasil dibuka dan belum pernah
  ditanya, satu dialog modal terpusat menanyakan Notifikasi /
  Mikrofon / Kamera (Izinkan/Tolak; mikrofon dan kamera berbagi
  satu kebijakan media, jadi kedua barisnya bergerak bersama),
  dengan nilai awal dari field `notif`/`media` yang sudah ada
  (bawaan Izinkan semua) dan catatan bahwa pilihan bisa diubah
  kapan saja di dialog edit. Cara menutup apa pun — Simpan,
  Escape, klik luar, panel lain mengambil alih — menyimpan
  pilihan yang sedang tampil (openPanel dan closePanels sama-sama
  memanggil `savePermChoices()` lebih dulu), men-set
  `permAsked`, dan dialog tidak pernah muncul lagi untuk layanan
  itu. Layanan lama (pra-0.8.8) semuanya ditanya sekali saat
  pertama dibuka setelah update — disengaja. Duplikat layanan
  tidak mewarisi `permAsked` (ditanya lagi; nilai izin warisannya
  jadi nilai awal dialog).

### Paket B — Petunjuk kelompok kosong di Kelola

- Daftar kelompok persisten: `sodium.groups` (localStorage,
  mirror config.json lewat CFG_KEYS, ikut payload ekspor/impor)
  menyimpan nama kelompok terurut termasuk yang kosong. Saat
  muat, daftar digabung dengan kelompok turunan layanan (urutan
  kemunculan pertama); nama dibandingkan tanpa memedulikan
  kapital. Nama kelompok baru dari dialog edit ikut masuk daftar.
- Render Kelola: kelompok berisi mendapat baris header di depan
  baris pertamanya (seperti pemisah sidebar); kelompok KOSONG
  tampil sebagai header redup berlabel "Kosong" + baris slot
  bergaris putus-putus "Seret layanan ke sini" setinggi kira-kira
  sebaris layanan. Slot adalah target drop yang sah dalam sistem
  seret Kelola yang ada (geometrinya ikut di-cache saat dragstart
  dalam koordinat konten yang sama, pola anti-thrash v0.8.6);
  menjatuhkan layanan di sana men-set kelompok layanan itu tanpa
  mengubah urutannya.
- Tombol "+ Kelompok baru" di bagian bawah daftar Kelola membuka
  prompt modal kecil (satu input + Simpan/Batal); nama yang sama
  dengan kelompok yang ada (abaikan kapital) ditolak dengan teks
  error di prompt.
- Menu konteks (klik kanan / tombol Menu) pada baris header
  kelompok di Kelola berisi item "Hapus kelompok", hanya aktif
  untuk kelompok kosong; menghapus kelompok kosong hanya membuang
  namanya dari daftar. Menu ini popover mengambang di atas panel
  Kelola (ditampilkan manual, bukan lewat openPanel) agar Kelola
  tetap terbuka di bawahnya.
- Sidebar utama tidak berubah: kelompok kosong tidak merender
  pemisah apa pun (render sidebar tetap diturunkan dari layanan).
  Layanan tanpa kelompok tampil persis seperti sebelumnya.

## 14. Catatan v0.9.0 (28 Nov 2026)

Split view: dua layanan tampil berdampingan dalam satu jendela.
Versi minor (bukan patch) karena ini kemampuan yang sama sekali
baru, sesuai aturan versi. Desain dikunci Agung sebelum dibangun:

- Model utama + pendamping: panel kiri adalah layanan utama —
  sidebar, tombol reload, dan lonceng notifikasi mengendalikan
  dia persis seperti sebelumnya; panel kanan adalah pendamping.
  Masuk split lewat tombol toggle di bar atas (ikon kolom,
  menampilkan status aktif) atau menu konteks sidebar "Buka di
  panel kanan". Saat split aktif tapi pendamping belum dipilih,
  wilayah kanan diisi pemilih layanan yang dirender UI; memilih
  satu menjadikannya pendamping. Keluar split memakai tombol
  yang sama; pendamping diparkir, bukan ditutup atau diusir.
- Aturan tukar: mengklik layanan yang sedang jadi pendamping
  (dari sidebar, pintasan, atau ganti cepat — semuanya lewat
  switchTo) menukar posisi kedua panel: pendamping jadi utama
  dan sebaliknya, lewat command split_swap, bukan
  switch_service. Mengklik layanan lain mengganti utama saja.
- Divider geser bebas: rasio tersimpan (sodium.splitRatio +
  sodium.splitCompanion di localStorage, mirror config.json
  lewat CFG_KEYS), bawaan 0,5. Lebar minimum tiap panel ±400px
  piksel logis; rasio di-clamp dinamis dari lebar konten saat
  ini (satu rumus clamp yang sama di Rust dan UI). Klik dua
  kali pada divider mengembalikan 0,5; divider bisa difokus
  (role="separator", aria-valuenow persen rasio) dan digeser
  dengan ArrowLeft/ArrowRight.
- Jebakan drag yang dihindari: webview layanan adalah HWND
  native anak yang menelan event pointer, jadi drag
  pointer-capture di lapisan UI akan putus begitu kursor
  melintasi webview. Seretan dilacak dari sisi Rust: command
  split_drag_start memulai sesi yang me-poll posisi kursor
  global (Window::cursor_position) ±tiap 16ms dan status tombol
  kiri (GetAsyncKeyState lewat FFI, tanpa dependensi baru),
  memancarkan event "split-ratio" untuk strip divider UI, dan
  "split-drag-end" saat tombol lepas agar UI menyimpan rasio.
  Relayout ter-throttle oleh laju poll itu sendiri.
- Gerbang ganda: tombol split hanya tampil bila lebar efektif
  monitor tempat jendela berada ≥1920px (fisik / scaleFactor,
  API monitor Tauri) DAN lebar inner jendela ≥1600px logis.
  Diperiksa saat startup, resize, pindah monitor, dan perubahan
  skala (debounce ±150ms, event "split-gate" ke UI). Bila
  syarat runtuh saat split aktif, split runtuh sendiri dengan
  aman: pendamping diparkir, pilihan pendamping diingat.
- LRU: selama split aktif, utama + pendamping bebas eviction —
  diperlakukan persis seperti pin untuk keperluan eviction
  (tidak dihitung, tidak bisa jadi korban). Membuat pendamping
  boleh melampaui max_alive sebagai kasus khusus. Keluar split
  tidak membunuh apa pun; aturan normal berlanjut pada switch
  berikutnya.
- Satu layout pass terpusat di Rust (layout_services) kini
  menentukan posisi semua webview layanan — dipakai switch,
  split, resize, restore panel (set_services_visible), dan
  popup link — dengan kesadaran services_hidden/link_open agar
  panel UI tidak pernah tertimpa webview yang muncul kembali.
  Popup link menyembunyikan kedua panel selama terbuka.
- Persistensi: rasio + id pendamping tersimpan; mode split
  dipulihkan saat startup hanya bila gerbang lolos saat itu dan
  pendamping tersimpan masih layak. Kasus tepi deterministik:
  pendamping dinonaktifkan/dihapus → slot kanan kosong dan
  pemilih tampil lagi; utama dinonaktifkan/dihapus → split
  runtuh; pendamping yang URL-nya diganti dibuat ulang di panel
  kanan; membuka pendamping pertama kali melewati jalur buka
  yang sama dengan switch biasa (zoom didorong dulu, dialog
  tanya izin v0.8.8 tetap terpicu). Zoom tetap per layanan per
  panel. Tidak ada animasi bounds untuk webview native.

## 15. Catatan v0.9.1 (28 Nov 2026)

Patch penyempurnaan split view dari dua laporan Agung saat
mengetes v0.9.0 di layarnya:

- Pemilih pendamping kompak: tile pemilih sekarang memakai
  ukuran dan gaya tile pemilih katalog persis seperti
  sebelumnya, tetapi baris grid tidak lagi meregang mengikuti
  tinggi panel (align-content: start pada grid pemilih
  split). Di v0.9.0 tile ketarik jadi kartu raksasa kosong
  karena grid mengisi seluruh tinggi wilayah kanan dan
  barisnya stretch; sekarang tile mengumpul di atas dengan
  ukuran tetap, ruang sisa kosong di bawah, dan panel tetap
  scroll internal bila layanan banyak.
- Strip kepala pendamping: panel kanan kini punya strip
  tipis 32px di tepi atasnya (dirender UI) berisi ikon kecil
  + nama pendamping dan dua tombol teks: Ganti dan Tutup.
  Webview pendamping menyusut sebesar strip itu (y +32,
  tinggi -32, lantai tinggi 100px mengikuti clamp layout
  yang ada) lewat konstanta COMPANION_STRIP_H di layout pass
  Rust yang sama; divider dan rasio tidak berubah. Tutup =
  keluar split sepenuhnya, persis tombol split di bar atas.
- Ganti pendamping tanpa menutup: tombol Ganti membuka
  pemilih lagi tepat di wilayah kanan (mode ganti). Selama
  memilih, pendamping lama DIPARKIR (bukan ditutup, profil
  tetap hidup) lewat flag companion_picking di AppState +
  command split_set_picking; pemilih mode ganti punya
  tombol Batal dan Esc yang menampilkan lagi pendamping
  yang sama. Memilih layanan lain menggantinya (yang lama
  disembunyikan, bukan ditutup); memilih layanan yang sama
  = Batal. Flag direset oleh semua jalur yang mengakhiri
  pemilihan: split_set_companion, split_swap, split_enter,
  split_exit, dan runtuhnya gerbang — flag tidak bisa
  menyandera pendamping di luar layar.
- Klik-kanan sidebar "Buka di panel kanan" kini juga
  mengganti pendamping yang sedang terbuka: item tampil
  untuk layanan aktif mana pun yang bukan layanan utama,
  sembunyi bila layanan itu sudah jadi pendamping atau
  gerbang split gagal; handler-nya memang sudah lewat
  setCompanion, jadi panel kanan berganti tanpa menutup
  webview pendamping lama.

## 16. Catatan v0.10.0 (28 Nov 2026) — Jalur B tahap 1

Kemampuan baru: jembatan komunikasi halaman↔Sodium, lalu
fitur media di atasnya. Sampai v0.9.1 suntikan JS Sodium
satu arah (halaman tidak bisa melapor balik) karena Tauri
tidak memberi jalur IPC ke halaman luar.

### Jembatan yang dipilih: WebView2 WebMessage

- Halaman memanggil `window.chrome.webview.postMessage`
  (JSON string); host mendengarkan event CoreWebView2
  `WebMessageReceived`. Controller didapat lewat
  `Webview::with_webview` → `PlatformWebview::controller()`
  (terverifikasi dari source tauri 2.12.7 yang terkunci di
  Cargo.lock), handler dipasang dengan pola yang sama
  persis dengan yang dipakai wry 0.57.3 sendiri untuk IPC
  Tauri (`WebMessageReceivedEventHandler::create` +
  `TryGetWebMessageAsString` + `take_pwstr` dari
  webview2-com 0.39.1). Kedua handler hidup berdampingan —
  event WebView2 memang multi-subscriber — dan parser kita
  mengabaikan semua yang bukan laporan jembatan.
- webview2-com 0.39.1 dan windows 0.62.2 dipromosikan jadi
  dependensi langsung (keduanya sudah ada di Cargo.lock
  sebagai dependensi transitif wry/tauri di versi yang
  sama persis — tidak ada unduhan atau versi baru).
- Ditolak: (a) capability remote Tauri 2 — URL layanan
  Sodium arbitrer dari pengguna, jadi capability harus
  wildcard dan memberi akses invoke ke halaman luar mana
  pun yang pernah dimuat; WebMessage tidak membuka
  permukaan invoke sama sekali. (b) Jembatan localhost
  bertoken — tidak diperlukan karena jalur 1 layak;
  menghindari server pendengar ekstra, distribusi token,
  dan gesekan mixed-content/PNA.
- Keamanan: pesan halaman = input tak tepercaya. Payload
  dibatasi 8 KB sebelum parse; hanya dua bentuk laporan
  yang dikenal (`media`, `notif`, versi 1); semua field
  dicek tipe + dipotong panjangnya; status adalah enum.
  Tidak ada bentuk pesan yang bisa mencapai command, shell,
  atau eval. Arah baliknya: Sodium hanya meng-eval skrip
  kontrol TETAP miliknya (`window.__sodiumMedia` dengan
  angka seek dan selector dari kita) lewat command
  `media_control` yang action-nya whitelist.

### Skrip jembatan bersama (bridge/media.js)

Disuntikkan ke SEMUA webview layanan sebagai initialization
script frame utama (mekanisme yang sama dengan adblock,
terpisah darinya), selalu aktif:

- Deteksi elemen video HTML5 (scan awal + MutationObserver)
  dan Media Session (judul/artist + status dari elemen
  aktif); lapor setiap perubahan berarti (dedupe + throttle
  di skrip, dedupe lagi di Rust) plus polling 2 detik
  sebagai penopang (metadata Media Session tidak punya
  event perubahan).
- Handle stabil `window.__sodiumMedia`: elemen media aktif
  + toggle play/pause, seek relatif, next/prev YouTube.
- Tombol PiP melayang ala Firefox: overlay di pojok video
  saat pointer melayang di atasnya (hit-test berdasarkan
  rect, bukan target event — player seperti YouTube menutup
  elemen videonya dengan lapisan overlay), klik memanggil
  `requestPictureInPicture()` (suntikan aplikasi terhitung
  gestur pengguna; menu klik-kanan WebView2 memang tidak
  punya entri PiP karena itu UI shell browser). Menghormati
  `disablePictureInPicture`, mengabaikan video kecil
  (< 180×100).
- Pencatat notifikasi untuk tahap 2: hook konstruktor
  `Notification` halaman + `ServiceWorkerRegistration.
  showNotification` (panggilan sisi halaman), diteruskan
  lewat jembatan; Rust menyimpan di state in-memory saja
  (maks 200, tanpa UI, tanpa persistensi — panelnya
  v0.11.0). Batasan jujur: notifikasi yang dibangkitkan
  murni di dalam service worker tanpa panggilan sisi
  halaman tidak terlihat dari sini.

### Sisi Rust

- Penerima jembatan per webview layanan dipasang di
  `attach_media_bridge` saat webview dibuat
  (`create_service_webview`); state per layanan
  `media_state` {judul, artist, status playing/paused/none,
  pip} + daftar `page_notifications` in-memory. Perubahan
  dikirim ke UI sebagai event "media-changed"; snapshot
  awal lewat command `media_states`.
- Bebas-LRU untuk media: layanan yang sedang memutar media
  atau memegang PiP masuk set terlindung di `evict_down_to`,
  digabung dengan pola yang sudah ada (pin + pasangan
  split) — bukan mekanisme paralel. Perlindungan lepas
  setelah jeda/akhir lewat recheck debounce ±60 detik
  (pola generation counter yang sama dengan gerbang split),
  jadi jeda singkat tidak mengorbankan player. State media
  dibersihkan saat webview dimusnahkan (eviction/close),
  seperti badge unread.
- Command kontrol: `media_control` (toggle, seek-back,
  seek-fwd, next, prev — next/prev hanya bermakna di
  YouTube) via `webview.eval` ke handle tetap di atas.

### Panel media (UI)

- Tombol baru di bar atas (ikon putar SVG, tanpa emoji)
  dengan titik aksen saat ada yang sedang diputar/PiP;
  panelnya mengikuti pola panel yang ada (bingkai .picker,
  daftar .manageList — max-height + scroll internal, gerbang
  fit berlaku): per layanan yang punya media — judul,
  artist/channel, status — dengan kontrol putar/jeda,
  seek −10/+10 detik, dan prev/next khusus baris YouTube.
  Keadaan kosong: "Tidak ada media yang diputar".

### Batasan yang diketahui

- Event WebMessageReceived hanya terpicu untuk postMessage
  dari dokumen frame utama, dan skrip disuntikkan di frame
  utama: media di dalam iframe lintas-origin (pemutar embed
  di situs lain) tidak terdeteksi di tahap 1. Layanan media
  utama (YouTube, Spotify, dll.) memutar di frame utama
  halamannya sendiri.
- PiP adalah jendela OS yang menempel pada webview
  layanannya: menutup/mengevict webview itu mengakhiri PiP
  (karena itu PiP ikut dilindungi dari eviction selama
  aktif).
- Bukti akhir jembatan (pesan halaman tampil di UI) baru
  terverifikasi setelah Agung mengetes rilis ini di
  perangkatnya.

## 17. Catatan v0.10.1 (28 Nov 2026) — diagnosis & pengerasan jembatan

### Gejala dari tes Agung

v0.10.0 dites Agung: video YouTube sedang diputar, panel
media tetap menampilkan "Tidak ada media yang diputar" —
tidak ada media terdeteksi sama sekali. Bedah kode
sesudahnya: skrip jembatan, parser Rust, dan UI semuanya
benar di atas kertas. Berarti putusnya di salah satu dari
dua mata rantai yang kegagalannya DIAM-DIAM:

- (A) Registrasi handler `attach_media_bridge`: semua
  error ditelan (`let _ =` pada `with_webview` dan
  `add_WebMessageReceived`; `CoreWebView2()` Err → return
  tanpa jejak). Bila closure tak jalan atau registrasi
  gagal, jembatan mati permanen untuk webview itu tanpa
  satu pun petunjuk.
- (B) Interaksi inisialisasi di YouTube: builder memanggil
  `.initialization_script()` dua kali — skrip jembatan,
  lalu adblock. Bila pada versi terkunci panggilan kedua
  MENIMPA yang pertama (bukan append), skrip jembatan
  tidak pernah jalan justru di YouTube, tempat Agung
  mengetes.

### Tiga pengerasan

1. **Liveness jembatan per layanan.** Rust kini menghitung
   KONTAK MENTAH: di dalam closure handler
   WebMessageReceived, penghitung (state `bridge_contacts`:
   jumlah pesan mentah + waktu terakhir, per layanan)
   dinaikkan SEBELUM pesan diekstrak atau diparse — yang
   diukur adalah kontaknya, bukan cuma pesan valid. Skrip
   mengirim laporan `{v:1,t:"hello"}` segera saat mulai
   dan pada DOMContentLoaded; parser menerimanya cukup
   sebagai kontak (media_state tidak berubah, tapi entri
   semasa dipancarkan ulang agar panel yang sedang terbuka
   memperbarui diagnosisnya). `media_states` kini
   menyertakan semua layanan yang punya kontak jembatan
   atau state media, dan tiap entri membawa `bridge: bool`
   (kontak > 0).
2. **Satu panggilan skrip inisialisasi.** Untuk layanan
   YouTube dengan adblock aktif, skrip jembatan + adblock
   digabung menjadi SATU string (jembatan dulu, adblock
   sesudahnya, dipisah newline + `;`) dalam satu panggilan
   `.initialization_script(...)`. Layanan non-YouTube
   tetap jembatan saja. Risiko timpa-menimpa hilang apa
   pun semantik append/replace di versi terkunci.
3. **Pasang ulang handler (asuransi timing).** State
   `bridge_attached` (set label) ditandai HANYA bila
   `add_WebMessageReceived` mengembalikan Ok.
   `switch_service` dan `split_set_companion` memanggil
   `ensure_bridge_attached`: webview yang hidup tapi
   labelnya belum tercatat dipasangi handler lagi (set-nya
   mencegah registrasi ganda). Tanda dibersihkan di
   `clear_media_state` — titik yang sama dengan
   pembersihan state jembatan lain saat webview
   dimusnahkan — bersama catatan kontaknya, supaya panel
   tidak pernah menyebut webview mati "terhubung".

### Cara membaca diagnosis di panel media

Bila tidak ada baris media, panel menampilkan teks kosong
seperti biasa DITAMBAH satu baris ringkas per layanan yang
dikenal: "nama — jembatan terhubung" atau "nama — jembatan
belum terhubung". Bila TIDAK ADA layanan dengan kontak
sama sekali, teks utamanya menjadi "Jembatan media belum
terhubung". Bacanya:

- Semua layanan "belum terhubung" → masalah di sisi
  registrasi handler (tersangka A) atau skrip tidak jalan
  di mana pun.
- YouTube "belum terhubung" tapi layanan lain "terhubung"
  → masalah khusus YouTube (tersangka B, atau halamannya
  menghalangi skrip).
- "Terhubung" tapi media tetap tidak terdeteksi → rantai
  jembatan hidup; yang putus adalah deteksi medianya di
  halaman — bahan diagnosis langkah berikutnya.

v0.10.1 tidak mengklaim jembatan sudah terbukti — buktinya
tetap tes Agung setelah rilis. Yang berubah: putusnya
(bila masih ada) kini TERLIHAT, bukan cuma diam.

## 18. Catatan v0.10.2 (28 Nov 2026) — deteksi media ditulis ulang

### Bukti dari tes v0.10.1

Screenshot panel media dari Agung: YouTube "jembatan
terhubung" (dan Muse.AI 1 juga) — pesan hello sampai ke
Rust, jadi skrip jalan, postMessage jalan, handler jalan.
Layanan lain "belum terhubung" hanya karena belum dibuka
sesi itu (belum ada webview) — normal, bukan bug. Tapi
video YouTube yang sedang diputar tetap tidak pernah
terdeteksi. Kesimpulan tegas: **pipa jembatan sehat; yang
mati adalah mesin pelacak video di halaman.** Sesuai
dugaan baris ketiga panduan diagnosis v0.10.1.

### Dua tersangka, dua-duanya terkonfirmasi di kode

Bedah `bridge/media.js` versi ter-push menemukan:

1. **Satu try/catch berurutan untuk seluruh init.**
   Scan awal → listener DOMContentLoaded → buat
   MutationObserver → `mo.observe(...)` →
   `setInterval(report, 2000)` berada dalam SATU blok try.
   Satu lemparan di tengah (mis. `observe` pada
   `documentElement` yang belum siap saat skrip disuntik
   di document-created) membunuh SEMUA langkah sesudahnya
   — termasuk interval 2 detik, satu-satunya penopang yang
   tidak tergantung event.
2. **Tidak ada penembusan shadow DOM sama sekali.**
   `scanTree` hanya memakai `querySelectorAll("video")`
   (berhenti di batas shadow root) dan observer hanya
   mengawasi dokumen utama. Pemutar YouTube hidup di dalam
   komponen `ytd-player`; elemen `<video>`-nya berada di
   shadow tree komponen itu. Akibatnya video tidak pernah
   masuk Set pelacakan, `pickActive()` selamanya kosong,
   dan snapshot selamanya "none" — walau interval jalan
   dan jembatan sehat. Ini tersangka terkuat: ia
   menjelaskan gejala persis tanpa perlu asumsi kegagalan
   init.

### Perbaikan (semua di `bridge/media.js`; Rust & UI utuh)

1. **Polling-pindai sebagai sumber kebenaran.** Interval
   2 detik kini menjalankan `tick()`: pemindaian DOM segar
   menyeluruh (`freshScan`) SEBELUM `report()`. Set video
   dibangun ulang dari isi halaman saat itu juga — deteksi
   tidak lagi bergantung pada observer/listener yang
   sempat terpasang atau tidak.
2. **Pindaian menembus shadow DOM.** `collectFrom(root,
   out)` berjalan rekursif: tiap elemen yang punya
   `shadowRoot` TERBUKA dipindai juga ke dalamnya (video +
   subtree). Shadow root tertutup memang tidak bisa
   ditembus dan dilewati. Video dari shadow tree
   diperlakukan sama — listener play/pause ditempel
   langsung ke elemennya tetap bekerja.
3. **Isolasi kesalahan per langkah.** Init kini lima
   langkah, masing-masing try/catch SENDIRI: scan awal,
   listener DOMContentLoaded, delegasi event, observer,
   dan interval — interval dipasang dalam bloknya sendiri
   dan tidak bisa gagal karena langkah lain. `tick()`
   menjaga scan dan report secara terpisah, dan
   `report()` menangkap pengecualian `snapshot()` di
   dalam (snapshot yang melempar terdegradasi jadi
   laporan "none", bukan membunuh interval).
4. **Delegasi event fase-capture.** Listener
   `play`/`pause`/`ended` pada document dengan
   `capture=true`: event media tidak bubble, tapi fase
   capture di document tetap melihatnya — dari elemen
   mana pun, termasuk yang lahir belakangan.

Kontrak dengan Rust TIDAK berubah: format laporan dan
hello v0.10.1 persis, dedupe sama, handle
`window.__sodiumMedia`, tombol PiP, dan hook notifikasi
dipertahankan apa adanya. Tidak ada satu baris pun Rust
atau UI yang diubah di rilis ini.

Seperti sebelumnya: v0.10.2 tidak mengklaim deteksi sudah
terbukti — buktinya tetap tes Agung (putar video YouTube,
panel media harus menampilkan judul yang sedang diputar).

## 19. Catatan v0.10.3 (28 Nov 2026) — fitur media dicabut, jembatan dipertahankan

### Keputusan Agung

Tes v0.10.2 membuktikan Jalur B ujung-ke-ujung: video
YouTube GadgetIn yang diputar di panel pendamping split
terdeteksi panel media lengkap dengan kontrolnya — jembatan
bekerja. Tapi tombol PiP melayang tidak muncul di tes itu,
dan Agung kemudian memutuskan: **"lupakan soal kontrol dan
PiP ini, kita hapus aja"** — panel media, kontrol putar,
dan PiP dicabut seluruhnya. Arah panel gaya Zen yang sempat
ditunjukkan Agung dari screenshot Zen Browser ikut gugur
bersama keputusan ini (pekerjaan builder ke arah itu
dihentikan di tengah jalan dan sisa editnya dikembalikan
ke keadaan v0.10.2 sebelum pencabutan dimulai).

### Yang dicabut (termasuk kabelnya)

1. **UI**: tombol media di topbar (`#mediaBtn` + titik
   penanda) dan panel media (`#mediaPanel`) beserta semua
   JS/CSS-nya — termasuk baris diagnosis jembatan v0.10.1
   di dalam panel, listener `media-changed`, dan
   pemanggilan `media_states` saat UI start.
2. **Kontrol**: command `media_control` (keluar juga dari
   `generate_handler!`) dan handle `window.__sodiumMedia`
   di skrip halaman.
3. **PiP**: tombol PiP melayang di skrip (seluruh logika
   overlay/hover/posisi) dan laporan status `pip`.
4. **Deteksi media**: pelacakan video + Media Session +
   laporan `"media"` di skrip; di Rust: `MediaInfo` /
   `MediaStateEntry` / `media_state`, emit
   `media-changed`, command `media_states`,
   `media_protected_labels` + pemakaiannya di
   `evict_down_to` (layanan yang memutar media TIDAK lagi
   bebas usir LRU), `schedule_media_evict_check` + field
   `media_evict_gen`, dan lengan `"media"` di
   `handle_bridge_message`.

### Yang dipertahankan — fondasi v0.11.0

Pencabutan ini bedahnya selektif: yang dibuang adalah
fitur medianya, bukan jembatannya.

- **Jembatan WebView2 WebMessage utuh**:
  `attach_bridge` (nama diganti dari `attach_media_bridge`),
  `bridge_contacts` (liveness kontak mentah),
  `bridge_attached` + `ensure_bridge_attached` (pasang
  ulang saat layanan ditampilkan), parser ketat
  `handle_bridge_message`, dan pembersihan per-webview
  `clear_bridge_state` (pengganti `clear_media_state`).
- **Pencatat notifikasi**: hook `Notification` +
  `ServiceWorkerRegistration.showNotification` di skrip,
  lengan `"notif"` di parser, store `page_notifications`
  in-memory (maks 200) — fondasi panel notifikasi
  v0.11.0, tidak ikut dicabut.
- **Hello** `{v:1,t:"hello"}` di skrip + penerimaannya di
  parser (liveness untuk panel notifikasi nanti).
- Skrip jembatan berganti nama `bridge/media.js` →
  `bridge/bridge.js`; isinya kini tinggal guard,
  host/post/cap, hello, dan hook notifikasi. Suntikan
  gabungan satu panggilan dengan adblock (v0.10.1) tetap.

### Pelajaran yang tetap disimpan

Deteksi v0.10.2 bekerja dan pelajarannya tidak ikut
terhapus bersama fiturnya (detail di seksi 18): elemen
`<video>` YouTube hidup di shadow tree `ytd-player` —
`querySelectorAll` dan MutationObserver dokumen utama
tidak menembusnya; pemindaian harus rekursif ke shadow
root terbuka. Dan init skrip suntikan tidak boleh satu
try/catch berurutan: satu lemparan di tengah membunuh
semua langkah sesudahnya, termasuk polling penopang.
Dua-duanya pengetahuan yang berlaku untuk skrip suntikan
apa pun di Sodium ke depan, termasuk panel notifikasi.

Catatan versi: ini patch (0.10.3) walau isinya pencabutan
— yang berubah adalah penghapusan fitur yang baru berumur
tiga rilis patch dan belum pernah jadi andalan; tidak ada
kemampuan baru, dan fondasi jembatan/notifikasi yang
menjadi isi minor 0.10.0 tetap berdiri.

## 20. Catatan v0.11.0 (28 Nov 2026) — Panel notifikasi terpusat (Jalur B tahap 2)

Tahap 2 Jalur B: semua notifikasi halaman yang tertangkap
hook skrip jembatan kini tampil dalam satu panel, agar
tidak ada yang kelewat di antara banyak layanan.

- **Store persisten**: `page_notifications` (maks 200,
  tertua dibuang) dicerminkan ke `notifications.json` di
  app_data_dir — tulis atomik temp + rename mengikuti pola
  `save_config`, debounce ±400 ms per generasi (pola
  gate_gen), dan dimuat lagi saat startup. Berkas
  hilang/rusak → panel mulai kosong, tanpa panik.
  `notifications_clear` menulis seketika (tidak menunggu
  debounce) agar restart tidak menghidupkan lagi daftar
  yang baru dibersihkan.
- **Command & event baru**: `notifications_list`
  (terbaru-dulu), `notifications_clear`, dan event
  `notif-added` untuk setiap notifikasi baru — lencana
  dan panel yang sedang terbuka hidup tanpa polling.
- **UI**: tombol inbox baru di bar atas (ikon tray,
  sengaja berbeda dari lonceng kebijakan notif layanan
  aktif) dengan lencana jumlah belum-dibaca. "Belum
  dibaca" = entri yang masuk sejak panel terakhir dibuka;
  penandanya `sodium.notifSeenAt`, ikut cermin config.
  Panel mengikuti pola panel yang ada (max-height +
  scroll internal): ikon + nama layanan, judul, isi
  terpotong rapi 2 baris, waktu relatif ("5 mnt lalu",
  tanggal + jam bila sudah lewat sehari). Tombol
  "Bersihkan" di kepala panel lewat konfirmasi yang sama
  dengan aksi destruktif lain (batal mengembalikan ke
  panel).
- **Klik item = pindah layanan**: memakai `switchTo`
  yang sama dengan klik sidebar, termasuk semantik split
  (mengklik layanan pendamping menukar kedua panel);
  panel tertutup lewat jalur yang sama.
- **Cakupan, jujur**: panel hanya memuat notifikasi yang
  tertangkap hook halaman (`Notification` +
  `ServiceWorkerRegistration.showNotification`).
  Notifikasi yang lahir murni di dalam service worker
  tanpa panggilan dari halaman bisa tidak tercatat.
  Toast Windows dari WebView2 tidak berubah sama sekali:
  panel ini catatan tambahan, bukan pengganti.
