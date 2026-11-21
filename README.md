# Sodium (Na)

> Semua layanan sosial & chat lo dalam satu tempat — **dengan cara yang ringan.**

**Sodium** adalah pembangunan ulang konsep [Ferdium](https://github.com/ferdium/ferdium-app) dalam versi jauh lebih ringan, dibuat karena Ferdium (Electron) rakus RAM: ~200 MB untuk cangkangnya saja, plus 150–250 MB untuk *setiap* layanan yang lo biarkan terbuka.

Namanya: Ferdium dinamai seperti unsur kimia — jadi adik ringannya adalah **Sodium**, unsur beneran (`Na`) dan salah satu logam paling ringan. **So**dium untuk **So**cial.

> Sodium adalah reimplementasi *clean-room* yang terinspirasi ide Ferdium, bukan fork dari kodenya.

## Kenapa Sodium lebih ringan?

Ganti framework saja tidak menyelesaikan soal RAM di Windows (WebView2 juga Chromium — satu halaman WhatsApp Web biayanya ya segitu). Hematnya Sodium datang dari arsitekturnya:

1. **Tauri 2 + webview bawaan OS** ketimbang Chromium yang dibundel — installer cuma ~2 MB, RAM cangkang hanya puluhan MB.

Lo bisa mendaftarkan **layanan tanpa batas** (WhatsApp terpasang dari awal; layanan lain tinggal pilih dari katalog atau tambah sebagai custom URL). Aturan Sodium bukan soal berapa yang boleh didaftarkan, tapi berapa yang *hidup*:

2. **Berapa webview yang tetap hidup adalah settingan lo** (bar atas: *Hidup bareng* — 1 / 2 / 3 / 5 / ∞, bawaan 1). Berpindah melebihi batas akan *memusnahkan* webview yang paling lama tidak dipakai (bukan sekadar menyembunyikannya). Daftarkan 10 layanan, bayar RAM cuma sejumlah pilihan lo. Layanan yang di-pin bebas dari pemusnahan.
3. **Layanan yang di-pin adalah pengecualian** — pin WhatsApp dan dia tetap hidup untuk notifikasi selama lo memakai layanan lain.
4. **Sesi tersimpan di disk** per layanan (folder profil masing-masing), jadi layanan yang dimusnahkan kembali dalam keadaan tetap login — hanya perlu memuat ulang (1–3 detik).
5. **Tidak ada server internal, tidak ada database, tidak ada sistem recipes untuk ratusan layanan.** Konfigurasi bersifat lokal; layanan hanyalah URL yang lo tambahkan sendiri.

Platform target: **Windows** (WebView2, sudah terpasang di Windows 11). Target realistis (6 layanan terdaftar): **~250–350 MB total**, dibanding ~1,1–1,7 GB di Ferdium dengan 6 layanan hidup semua.

Analisis lengkap source Ferdium dan pertimbangan desainnya: [docs/BLUEPRINT.md](docs/BLUEPRINT.md)

## Fitur

- **Picker layanan** ala Ferdium saat pertama dibuka (dan lewat tombol "+"): 21 layanan populer tinggal klik, bisa pilih banyak sekaligus, ada pencarian; custom URL tetap tersedia.
- **Ikon custom per layanan**: emoji + warna khas dari katalog, bisa diganti lewat palet emoji, teks bebas, atau **upload gambar sendiri** (.jpg / .jpeg / .png / .ico).
- **Bar atas**: nama layanan aktif, **zoom** tampilan layanan (50%–200%, tersimpan), dan setting *Hidup bareng*.
- **Pin** layanan agar selalu hidup (mis. WhatsApp untuk notifikasi), **nonaktifkan** layanan untuk mematikannya total sementara tanpa kehilangan login, dan shortcut **Ctrl+1..9** untuk berpindah layanan.
- Notifikasi situs bisa diaktifkan (Sodium menjawab permintaan izin notifikasi dengan benar).

Belum ada: badge pesan belum dibaca, tray, jembatan notifikasi native, auto-update.

## Cara mengembangkan

Persyaratan: [Rust](https://www.rust-lang.org/tools/install), Node 20+, dan di Windows runtime WebView2 (sudah terpasang di Windows 11), di Linux `webkit2gtk`.

```bash
npm install
npm run dev     # tauri dev
npm run build   # tauri build -> installer di src-tauri/target/release/bundle
```

## Lisensi

MIT. Konsep terinspirasi Ferdium (Apache-2.0) — terima kasih untuk komunitas Ferdium.
