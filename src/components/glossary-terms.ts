// Isi glosarium. Data murni — tidak ada DOM, tidak ada import CSS, supaya
// glossary-terms.check.ts bisa jalan di bawah tsx seperti modul analytics.
// Rendering-nya ada di glossary.ts.
//
// Glosarium — satu-satunya permukaan bantuan di add-in ini.
//
// Kenapa perlu: dashboard ini menampilkan nama entity MyGeotab mentah ke user
// (ExceptionEvent, StatusData, DVIR, dan yang paling parah sebuah kolom bernama
// "riskOfBreakdown"). Orang yang membacanya adalah kepala operasional
// distribusi, safety officer tambang, atau admin fleet logistik — bukan
// developer Geotab. Tanpa tempat bertanya, angka yang benar tetap tidak
// terpakai.
//
// ponytail: <dialog> native. Focus trap, tutup dengan Esc, backdrop, dan
// pengembalian fokus ke tombol pemanggil sudah gratis dari browser — tidak ada
// dependency modal dan tidak ada manajemen fokus buatan sendiri yang perlu
// dites. Tidak ada kotak pencarian sampai daftarnya melewati satu layar.

export interface Term {
  id: string;
  term: string;
  /** Nama lain / kepanjangan, kalau ada. */
  aka?: string;
  body: string;
  /** Di halaman mana user melihatnya. */
  where?: string;
}

export interface TermGroup {
  title: string;
  terms: Term[];
}

export const GLOSSARY: TermGroup[] = [
  {
    title: 'Tingkat keyakinan angka',
    terms: [
      {
        id: 'terukur',
        term: 'Terukur',
        body: 'Angka dijumlahkan langsung dari data MyGeotab, tanpa asumsi apa pun. Ini yang paling aman dipakai untuk menagih klien atau mengambil keputusan.',
        where: 'Label di kartu KPI',
      },
      {
        id: 'heuristik',
        term: 'Heuristik',
        body: 'Sebagian angkanya berasal dari asumsi yang Anda isi sendiri (jam kerja, rasio BBM, interval servis) — bukan dari MyGeotab. Ubah asumsinya, angkanya ikut berubah. Sah untuk membandingkan unit di dalam armada Anda sendiri, tidak sah dibandingkan dengan armada lain.',
        where: 'Label di kartu KPI',
      },
      {
        id: 'estimasi',
        term: 'Estimasi',
        body: 'Dihitung tidak langsung dari data lain karena angka aslinya tidak dilaporkan perangkat. Bukan angka resmi. Contoh: jam mesin yang dihitung dari durasi trip, bukan dibaca dari counter mesin.',
        where: 'Label di kartu KPI',
      },
    ],
  },
  {
    title: 'Istilah dasar dashboard ini',
    terms: [
      {
        id: 'idle',
        term: 'Idle',
        body: 'Mesin menyala tapi kendaraan tidak bergerak — antre, menunggu bongkar muat, atau AC dinyalakan saat parkir. Idle membakar BBM dan menambah jam mesin tanpa menghasilkan jarak, jadi ini biasanya penghematan termudah di armada mana pun.',
        where: 'Ringkasan, Konsumsi BBM',
      },
      {
        id: 'jam-mesin',
        term: 'Jam Mesin',
        aka: 'Engine hours',
        body: 'Total lama mesin menyala, termasuk saat idle. Alat berat dan genset diservis berdasarkan jam mesin, bukan odometer — 200 jam menggali hampir tidak menambah kilometer sama sekali. Perhatikan: kartu "Estimasi Jam Mesin" di Ringkasan dihitung dari durasi trip, BUKAN dibaca dari counter mesin kendaraan, jadi angkanya bisa berbeda dari jam mesin resmi unit.',
        where: 'Ringkasan, Kesehatan Armada, Prediksi Servis',
      },
      {
        id: 'utilisasi',
        term: 'Utilisasi Armada',
        body: 'Berapa persen dari jam kerja yang tersedia benar-benar dipakai untuk berjalan. Penyebutnya adalah jam kerja yang ANDA isi, bukan 24 jam sehari — truk yang tidak jalan malam hari bukan berarti nganggur. Karena itu Profil Operasi penting: memakai basis jam kantor untuk site tambang 24 jam bisa membuat angkanya menembus 100%.',
        where: 'Ringkasan',
      },
      {
        id: 'pelanggaran',
        term: 'Pelanggaran',
        aka: 'Exception',
        body: 'Satu kejadian yang melanggar Rule di database Anda — misalnya pengereman mendadak atau kecepatan berlebih. Yang menentukan kapan sebuah kejadian dihitung adalah ambang batas di MyGeotab, bukan add-in ini.',
        where: 'Ringkasan, Perilaku Berkendara',
      },
      {
        id: 'per-100-km',
        term: 'Per 100 km',
        body: 'Jumlah pelanggaran dibagi jarak tempuh, dikali 100. Dipakai untuk peringkat karena jumlah mentah selalu menempatkan unit paling sibuk di urutan teratas — tidak berguna untuk coaching. Dengan normalisasi jarak, unit 4.000 km/minggu bisa dibandingkan adil dengan unit 200 km/minggu.',
        where: 'Perilaku Berkendara',
      },
      {
        id: 'zona',
        term: 'Zona',
        aka: 'Geofence',
        body: 'Area di peta yang Anda gambar sendiri di MyGeotab — gudang, pabrik, outlet, pit, pelabuhan. Add-in ini memakai keduanya sebagai satu istilah. Laporan Perjalanan menyusun perjalanan dari zona ke zona, jadi tanpa zona terdaftar halaman itu kosong.',
        where: 'Filter, Laporan Perjalanan, Keamanan',
      },
      {
        id: 'ambang-berhenti',
        term: 'Ambang berhenti',
        aka: 'Dwell',
        body: 'Berhenti yang lebih singkat dari ambang ini dianggap masih satu perjalanan. Mampir isi BBM tidak memecah perjalanan jadi dua. Nilai yang tepat berbeda per jenis armada: untuk distribusi FMCG ambang pendek justru diinginkan agar tiap drop di outlet terlihat; untuk logistik jarak jauh ambang panjang mencegah istirahat sopir memecah satu trip.',
        where: 'Laporan Perjalanan',
      },
      {
        id: 'pulang-pergi',
        term: 'Pulang-pergi',
        body: 'Penanda pada perjalanan yang berakhir di zona yang sama dengan tempat ia berangkat — keluar dari gudang lalu kembali ke gudang yang sama.',
        where: 'Laporan Perjalanan',
      },
      {
        id: 'severity',
        term: 'Rendah / Sedang / Tinggi',
        body: 'Tingkat keparahan pelanggaran. Diturunkan dari ID aturan bawaan Geotab, BUKAN dari namanya — nama aturan diterjemahkan berbeda per bahasa database, jadi mencocokkan nama akan gagal di database berbahasa Indonesia. Aturan buatan sendiri yang ID-nya tidak dikenali masuk ke tingkat terendah.',
        where: 'Ringkasan, Keamanan',
      },
      {
        id: 'pergerakan-tak-sah',
        term: 'Pergerakan Tak Sah',
        body: 'Perjalanan yang dimulai di luar jam shift yang Anda tetapkan. Ini murni perbandingan jam, bukan deteksi pencurian — lembur yang sah juga akan muncul di sini. Kalau shift diatur 24 jam (profil tambang), KPI ini selalu 0 karena tidak ada jam yang bisa disebut di luar jam kerja.',
        where: 'Keamanan & Darurat',
      },
    ],
  },
  {
    title: 'Istilah teknis kendaraan',
    terms: [
      {
        id: 'mil',
        term: 'MIL',
        aka: 'Malfunction Indicator Lamp',
        body: 'Lampu peringatan mesin di dashboard kendaraan — "check engine". Di add-in ini "Lampu Kritis (MIL)" hanya menghitung fault yang menyalakan lampu malfungsi atau stop merah. Lampu kuning/amber SENGAJA tidak dihitung: kalau semuanya kritis, tidak ada yang kritis.',
        where: 'Kesehatan Armada',
      },
      {
        id: 'ecu',
        term: 'ECU',
        aka: 'Engine Control Unit',
        body: 'Komputer mesin kendaraan. Dialah yang mendeteksi dan mengkonfirmasi kerusakan. "Fault Aktif" berarti sudah dikonfirmasi ECU; "Perlu Dipantau" (Pending) berarti terdeteksi tapi belum dikonfirmasi — bisa hilang sendiri.',
        where: 'Kesehatan Armada',
      },
      {
        id: 'dtc',
        term: 'DTC',
        aka: 'Diagnostic Trouble Code',
        body: 'Kode kerusakan standar yang dilaporkan mesin, misalnya P0301. Satu kode bisa muncul berulang kali dari satu unit yang sama — karena itu tabel kode fault memisahkan "jumlah kejadian" dari "jumlah unit terdampak".',
        where: 'Kesehatan Armada',
      },
      {
        id: 'obd',
        term: 'OBD / J1939',
        body: 'Dua standar colokan diagnostik kendaraan: OBD-II umumnya untuk kendaraan ringan, J1939 untuk truk dan alat berat. Kalau perangkat tidak tersambung ke salah satunya, kendaraan tidak akan pernah melaporkan fault — halaman Kesehatan Armada kosong bukan karena armadanya sehat.',
        where: 'Kesehatan Armada',
      },
      {
        id: 'dvir',
        term: 'DVIR',
        aka: 'Driver Vehicle Inspection Report',
        body: 'Laporan pemeriksaan kendaraan yang diisi sopir sebelum atau sesudah jalan. "Defect DVIR terbuka" berarti sopir melaporkan ada yang rusak dan statusnya belum diperbaiki. Ini satu-satunya sinyal di add-in ini yang datang dari mata manusia, bukan sensor.',
        where: 'Prediksi Servis',
      },
      {
        id: 'nfc',
        term: 'NFC / iButton',
        body: 'Kartu atau kancing identitas sopir yang ditempel ke perangkat saat mulai berkendara. Tanpa ini MyGeotab tidak tahu siapa yang menyetir, dan semua perjalanan tercatat sebagai UnknownDriverId.',
        where: 'Perilaku Berkendara',
      },
      {
        id: 'unknown-driver',
        term: 'UnknownDriverId',
        body: 'Penanda MyGeotab untuk perjalanan tanpa identitas sopir. Peringkat per pengemudi disembunyikan kalau terlalu banyak perjalanan seperti ini — menampilkannya berarti menyalahkan satu "pengemudi" fiktif atas pelanggaran seluruh armada.',
        where: 'Perilaku Berkendara',
      },
    ],
  },
  {
    title: 'Istilah khusus di halaman tertentu',
    terms: [
      {
        id: 'risk-of-breakdown',
        term: 'Risiko Breakdown',
        aka: 'riskOfBreakdown (nama asli dari Geotab)',
        body: 'Nilai risiko kerusakan yang dihitung oleh Geotab sendiri, bukan oleh add-in ini. Yang ditampilkan adalah nilai tertinggi per unit pada rentang yang dibaca. Geotab tidak mendokumentasikan skala maupun satuannya secara publik, jadi pakai ini untuk mengurutkan unit dari yang paling berisiko — jangan diperlakukan sebagai persentase atau probabilitas. Kolomnya kosong kalau database Anda tidak melaporkannya.',
        where: 'Prediksi Servis',
      },
      {
        id: 'fault-kronis',
        term: 'Fault kronis',
        body: 'Kerusakan yang sama pada unit yang sama muncul di minimal 3 hari berbeda dalam 90 hari terakhir. Bedanya dengan fault biasa: ini pola, bukan insiden. Penghitungan harinya memakai tanggal UTC, jadi kejadian larut malam bisa terhitung ke hari berikutnya.',
        where: 'Prediksi Servis',
      },
      {
        id: 'tren-baru',
        term: 'Tren "baru"',
        body: 'Muncul di kolom Tren saat unit punya fault di 30 hari terakhir tapi TIDAK punya satu pun di 30 hari sebelumnya. Rasio perbandingannya tak terhingga, jadi ditulis "baru" alih-alih angka. Artinya masalah ini betul-betul baru muncul, bukan memburuk perlahan.',
        where: 'Prediksi Servis',
      },
      {
        id: 'sisa-ke-servis',
        term: 'Sisa ke servis',
        body: 'Perkiraan sisa km atau jam mesin sampai servis berikutnya. MyGeotab tidak menyimpan riwayat servis (kecuali database Anda memakai Maintenance Reminders), jadi angka ini mengasumsikan setiap servis terjadi tepat pada kelipatan interval yang Anda isi. Odometernya terukur; jadwalnya perkiraan.',
        where: 'Prediksi Servis',
      },
    ],
  },
  {
    title: 'Nama data MyGeotab yang muncul di layar',
    terms: [
      {
        id: 'trip',
        term: 'Trip',
        body: 'Satu perjalanan versi MyGeotab: dari mesin menyala sampai mesin mati. Karena itu satu pengiriman Cikarang–Priok bisa terdiri dari beberapa Trip, dan Laporan Perjalanan-lah yang menyambungkannya kembali jadi satu perjalanan zona ke zona.',
      },
      {
        id: 'exception-event',
        term: 'ExceptionEvent',
        body: 'Catatan satu pelanggaran. Penting: MyGeotab TIDAK menyimpan besarannya — tidak ada "berapa km/jam kelebihannya" atau "seberapa keras pengeremannya", hanya waktu dan durasi. Itu sebabnya semua pelanggaran dihitung sama berat di halaman Perilaku Berkendara.',
      },
      {
        id: 'rule',
        term: 'Rule',
        aka: 'Aturan',
        body: 'Aturan yang Anda konfigurasi di MyGeotab beserta ambang batasnya, misalnya "pengereman lebih keras dari −0,4G". Semua pelanggaran lahir dari Rule. Kalau sebuah Rule belum dibuat, kategorinya tidak akan pernah muncul — dan itu ditandai "tidak diukur", bukan nol.',
      },
      {
        id: 'diagnostic',
        term: 'Diagnostic',
        body: 'Jenis pembacaan dari kendaraan: odometer, jam mesin, level bahan bakar, kode kerusakan. Tidak semua perangkat melaporkan semuanya — kolom yang tidak dilaporkan disembunyikan, tidak ditampilkan sebagai nol.',
      },
      {
        id: 'status-data',
        term: 'StatusData',
        body: 'Nilai pembacaan Diagnostic pada satu waktu, misalnya "odometer 128.400 km pada 2 Agustus 09:14".',
      },
      {
        id: 'fault-data',
        term: 'FaultData',
        body: 'Catatan kode kerusakan yang dilaporkan mesin, lengkap dengan statusnya (aktif, pending, sudah selesai, atau di-dismiss).',
      },
      {
        id: 'device',
        term: 'Device',
        body: 'Perangkat GO yang terpasang di kendaraan. Di seluruh dashboard ini disebut "unit", dan namanya diambil dari nama kendaraan yang Anda isi di MyGeotab.',
      },
      {
        id: 'fuel-transaction',
        term: 'FuelTransaction',
        body: 'Transaksi kartu BBM. Ini sumber data bahan bakar paling akurat karena berisi liter dan biaya sungguhan. Kalau database Anda punya ini, halaman Konsumsi BBM memakainya lebih dulu sebelum sumber lain.',
      },
    ],
  },
];

export const ALL_TERMS = GLOSSARY.flatMap((g) => g.terms);

export function termIds(): string[] {
  return ALL_TERMS.map((t) => t.id);
}
