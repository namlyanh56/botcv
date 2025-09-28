# Telegram Bot: TXT to VCF

Bot Telegram untuk mengonversi file `.txt` berisi daftar nomor telepon menjadi file `.vcf` dengan inline keyboard dan alur percakapan terstruktur.

## Fitur Tahap 1: 📒 TXT to VCF 📒
- Bersihkan dan rapikan nomor:
  - Hapus spasi/simbol tak perlu.
  - Pastikan setiap nomor diawali `+`.
  - Khusus awalan `08` diubah menjadi `+62...`.
- Penamaan kontak:
  - Jika satu nomor: `FN` = nama yang diketik user.
  - Jika banyak nomor: `FN` = `Nama 001`, `Nama 002`, dst.
- Penamaan file:
  - Default: mengikuti nama `.txt` (dengan `.vcf`).
  - Custom: sesuai input user.
- Inline Keyboard:
  - Menu Awal: `📒TXT to VCF📒`
  - Saat proses: `Batal`
  - Pilih nama file: `Custom` | `Default`

## Struktur Ringkas
- `src/bot.js` — inisialisasi bot, command `/start`, router callback/message.
- `src/keyboards.js` — builder inline keyboard (Menu Awal, Batal, Custom/Default).
- `src/txtToVcfFlow.js` — state machine untuk alur TXT→VCF.
- `src/format.js` — parser & normalizer nomor, builder VCF (menggunakan `vcards-js`).

## Menjalankan
1. `cp .env.example .env` lalu isi `BOT_TOKEN`.
2. `npm install`
3. `npm run start` (atau `npm run dev` dengan nodemon).

## Catatan Teknis
- Batas ukuran file `.txt`: 8MB.
- Parsing menerima pemisah baris/koma/titik koma.
- Duplikat nomor dihapus otomatis.
- Konten VCF menggunakan vCard 3.0 via `vcards-js`.
