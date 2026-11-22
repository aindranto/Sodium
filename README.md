# Sodium (Na)

> Semua layanan sosial dan perpesanan Anda dalam satu tempat — **dengan cara yang ringan.**

**Sodium** adalah pembangunan ulang konsep [Ferdium](https://github.com/ferdium/ferdium-app) dalam versi yang jauh lebih ringan. Aplikasi ini dibuat karena Ferdium (Electron) membutuhkan sumber daya yang besar: sekitar 200 MB untuk cangkang aplikasinya saja, ditambah 150–250 MB untuk *setiap* layanan yang dibiarkan terbuka.

Asal namanya: Ferdium dinamai seperti unsur kimia, sehingga versi ringannya adalah **Sodium** — unsur sungguhan (`Na`) dan salah satu logam paling ringan. **So**dium untuk **So**cial.

> Sodium merupakan reimplementasi *clean-room* yang terinspirasi dari ide Ferdium, bukan fork dari kode sumbernya.

## Mengapa Sodium lebih ringan?

Mengganti framework saja tidak menyelesaikan persoalan RAM di Windows, karena WebView2 juga berbasis Chromium — satu halaman WhatsApp Web tetap membutuhkan sumber daya yang sama. Penghematan Sodium berasal dari arsitekturnya:

1. **Tauri 2 dan webview bawaan sistem operasi**, bukan Chromium yang dibundel. Hasilnya, ukuran installer hanya sekitar 2 MB dan RAM cangkang aplikasi hanya puluhan MB.

Anda dapat mendaftarkan **layanan dalam jumlah tak terbatas** — WhatsApp terpasang sejak awal, layanan lain dapat dipilih dari katalog atau ditambahkan sebagai custom URL. Yang diatur Sodium bukanlah jumlah layanan yang boleh didaftarkan, melainkan jumlah yang *aktif*:

2. **Jumlah webview yang tetap aktif adalah pilihan Anda** (bar atas: *Hidup bareng* — 1 / 2 / 3 / 5 / ∞, bawaan 1). Berpindah layanan melebihi batas tersebut akan *memusnahkan* webview yang paling lama tidak digunakan, bukan sekadar menyembunyikannya. Daftarkan 10 layanan, dan penggunaan RAM tetap sebatas jumlah pilihan Anda. Layanan yang di-pin dikecualikan dari pemusnahan.
3. **Layanan yang di-pin adalah pengecualian** — pin WhatsApp, dan layanan tersebut tetap aktif untuk menerima notifikasi selama Anda menggunakan layanan lain.
4. **Sesi tersimpan di disk** untuk setiap layanan (folder profil masing-masing), sehingga layanan yang dimusnahkan dapat dibuka kembali dalam keadaan tetap masuk — cukup memuat ulang selama 1–3 detik.
5. **Tanpa server internal, tanpa database, dan tanpa sistem recipes untuk ratusan layanan.** Konfigurasi tersimpan secara lokal; layanan hanyalah URL yang Anda tambahkan sendiri.

Platform target: **Windows** (WebView2, sudah terpasang pada Windows 11). Perkiraan penggunaan dengan 6 layanan terdaftar: **sekitar 250–350 MB secara total**, dibandingkan 1,1–1,7 GB pada Ferdium dengan 6 layanan aktif sekaligus.

Analisis lengkap mengenai kode sumber Ferdium dan pertimbangan desainnya tersedia di [docs/BLUEPRINT.md](docs/BLUEPRINT.md).

## Fitur

- **Pemilih layanan** bergaya Ferdium yang tampil saat aplikasi pertama kali dibuka (dan melalui tombol "+"): 21 layanan populer yang ditambahkan dengan sekali klik — klik lagi untuk menambah akun kedua, ketiga, dan seterusnya pada layanan yang sama — dilengkapi kolom pencarian. Custom URL tetap tersedia.
- **Ikon khusus untuk setiap layanan**: logo asli brand dari katalog (Simple Icons), dengan **warna tile dan warna logo yang dapat diatur sendiri**, dapat diganti melalui palet emoji, teks bebas, atau **unggahan gambar sendiri** (.jpg / .jpeg / .png / .ico).
- **Bar atas** berisi nama layanan yang sedang aktif, **zoom** tampilan layanan (50%–200%, tersimpan secara permanen), dan pengaturan *Hidup bareng*.
- **Pin** layanan agar selalu aktif (misalnya WhatsApp untuk notifikasi), **nonaktifkan** layanan untuk mematikannya secara total untuk sementara tanpa kehilangan sesi masuk, serta pintasan **Ctrl+1..9** untuk berpindah layanan.
- **Duplikat (akun beda)** melalui panel Kelola layanan: menyalin URL dan ikon dengan profil yang masih kosong, untuk masuk dengan akun lain pada layanan yang sama.
- **Ganti nama** layanan melalui panel Kelola layanan: nama bebas tanpa memengaruhi sesi masuk, pin, atau zoom (semua terikat pada id layanan, bukan nama). Layanan custom URL tanpa logo katalog mengambil favicon situsnya secara otomatis.
- **Panel Kelola layanan** (tombol di sidebar, di bawah tombol "+"): semua pengaturan layanan dalam satu tempat — edit nama, ikon, dan **URL** (webview ditutup dan dibuka ulang bila URL berubah), ubah urutan layanan, pin, nonaktifkan, duplikat, dan hapus — plus saklar menampilkan nama layanan di bawah ikon sidebar. Menu klik kanan kini ramping (Pin/Unpin, Nonaktifkan/Aktifkan lagi, Kelola layanan), dan layanan di belakangnya hanya di-dim, tidak disembunyikan.
- Notifikasi situs dapat diaktifkan, karena Sodium menjawab permintaan izin notifikasi dengan benar.
- **Klik notifikasi membuka percakapan**: Sodium mengambil alih notifikasi layanan (banner kuning di bar atas + kedipan tombol taskbar); mengklik banner membuka layanannya dan meneruskan klik ke halaman, sehingga misalnya WhatsApp langsung membuka chat yang dimaksud — bukan lagi toast yang kliknya hilang saat webview layanan sedang mati.

Belum tersedia: system tray dan pembaruan otomatis.

## Pengembangan

Persyaratan: [Rust](https://www.rust-lang.org/tools/install), Node 20+, runtime WebView2 pada Windows (sudah terpasang pada Windows 11), atau `webkit2gtk` pada Linux.

```bash
npm install
npm run dev     # tauri dev
npm run build   # tauri build -> installer tersedia di src-tauri/target/release/bundle
```

## Lisensi

MIT. Konsep terinspirasi dari Ferdium (Apache-2.0) — terima kasih kepada komunitas Ferdium.
