import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const saltRounds = 10;

  // 1. Seed User Eksekutif (Kepala BRIDA)
  const userNip = '197804122003121002';
  const userName = 'Darius Sabon Rain, S.E., M.Ec.Dev.';
  const userPass = 'password123';
  const userPassHash = await bcrypt.hash(userPass, saltRounds);

  console.log('[Seeder] Memulai proses seeding akun Kepala BRIDA...');
  const executive = await prisma.user.upsert({
    where: { nip: userNip },
    update: {
      fullName: userName,
      passwordHash: userPassHash,
      role: UserRole.USER,
    },
    create: {
      nip: userNip,
      fullName: userName,
      passwordHash: userPassHash,
      role: UserRole.USER,
    },
  });

  console.log(`[Seeder Success] Akun Kepala BRIDA (USER) berhasil diamankan:`);
  console.log(` - NIP      : ${executive.nip}`);
  console.log(` - Nama     : ${executive.fullName}`);

  // 2. Seed User Admin
  const adminNip = 'admin123';
  const adminName = 'Administrator BRIDA';
  const adminPass = 'passwordadmin';
  const adminPassHash = await bcrypt.hash(adminPass, saltRounds);

  console.log('[Seeder] Memulai proses seeding akun Administrator...');
  const admin = await prisma.user.upsert({
    where: { nip: adminNip },
    update: {
      fullName: adminName,
      passwordHash: adminPassHash,
      role: UserRole.ADMIN,
    },
    create: {
      nip: adminNip,
      fullName: adminName,
      passwordHash: adminPassHash,
      role: UserRole.ADMIN,
    },
  });

  console.log(`[Seeder Success] Akun Administrator (ADMIN) berhasil diamankan:`);
  console.log(` - NIP      : ${admin.nip}`);
  console.log(` - Nama     : ${admin.fullName}`);

  // 3. Seed OPDs
  console.log('[Seeder] Memulai proses seeding OPD...');
  const opdsData = [
    { name: 'Badan Riset dan Inovasi Daerah', code: 'BRIDA', headName: 'Darius Sabon Rain, S.E., M.Ec.Dev.', headPhone: '628123456789' },
    { name: 'Badan Perencanaan Pembangunan Daerah', code: 'BAPPEDA', headName: 'Ir. Yohana Paliling, M.Si.', headPhone: '628111111111' },
    { name: 'Dinas Pendidikan', code: 'DISDIK', headName: 'Jenny O. Usmany, M.Pd.', headPhone: '628222222222' },
    { name: 'Dinas Kesehatan', code: 'DINKES', headName: 'Reynold R. Ubra, S.KM., M.Epid.', headPhone: '628333333333' },
    { name: 'Inspektorat Daerah', code: 'INSPEKTORAT', headName: 'Sihol Parningotan, S.H.', headPhone: '628444444444' },
  ];

  const seededOpds: Record<string, string> = {};
  for (const opd of opdsData) {
    const o = await prisma.oPD.upsert({
      where: { code: opd.code },
      update: { name: opd.name, headName: opd.headName, headPhone: opd.headPhone },
      create: { name: opd.name, code: opd.code, headName: opd.headName, headPhone: opd.headPhone },
    });
    seededOpds[opd.code] = o.id;
  }
  console.log('[Seeder Success] OPD berhasil di-seed.');

  // Hubungkan users ke OPD masing-masing
  const bridaOpdId = seededOpds['BRIDA'];
  const bappedaOpdId = seededOpds['BAPPEDA'];
  
  if (bridaOpdId) {
    await prisma.user.update({
      where: { nip: userNip },
      data: { opdId: bridaOpdId },
    });
    console.log('[Seeder] Akun Kepala BRIDA berhasil dihubungkan ke OPD BRIDA.');
  }
  if (bappedaOpdId) {
    await prisma.user.update({
      where: { nip: adminNip },
      data: { opdId: bappedaOpdId },
    });
    console.log('[Seeder] Akun Administrator berhasil dihubungkan ke OPD BAPPEDA.');
  }

  // 4. Seed Document Categories
  console.log('[Seeder] Memulai proses seeding Kategori Dokumen...');
  const categoriesData = [
    { name: 'Rencana Pembangunan Jangka Menengah Daerah', code: 'RPJMD', analyticalRole: 'TARGET', description: 'Dokumen perencanaan pembangunan daerah untuk jangka waktu 5 tahun.' },
    { name: 'Rencana Strategis Perangkat Daerah', code: 'RENSTRA', analyticalRole: 'TARGET', description: 'Dokumen perencanaan strategis perangkat daerah untuk jangka waktu 5 tahun.' },
    { name: 'Laporan Keterangan Pertanggungjawaban', code: 'LKPJ', analyticalRole: 'REALIZATION', description: 'Laporan pertanggungjawaban tahunan kepala daerah kepada DPRD.' },
    { name: 'Kajian Akademis', code: 'KAJIAN_AKADEMIS', analyticalRole: 'REFERENCE', description: 'Dokumen kajian ilmiah/penelitian naskah akademik kebijakan daerah.' },
    { name: 'Laporan Umum', code: 'GENERAL_REPORT', analyticalRole: 'REALIZATION', description: 'Dokumen laporan umum sektoral daerah.' },
  ];

  for (const cat of categoriesData) {
    await prisma.documentCategory.upsert({
      where: { code: cat.code },
      update: { name: cat.name, description: cat.description, analyticalRole: cat.analyticalRole },
      create: { name: cat.name, code: cat.code, description: cat.description, analyticalRole: cat.analyticalRole },
    });
  }
  console.log('[Seeder Success] Kategori Dokumen berhasil di-seed.');

  // 5. Seed Districts (Geospatial Centroid Calculation)
  console.log('[Seeder] Memulai proses kalkulasi centroid dan seeding Distrik...');
  
  const DISTRICT_PROFILES: Record<string, {
    luasWilayah: number;
    jumlahPenduduk: number;
    deskripsi: string;
    batasWilayah: string;
    images: string[];
    suggestions: string[];
  }> = {
    "Mimika Baru": {
      luasWilayah: 2216,
      jumlahPenduduk: 142000,
      deskripsi: "Distrik Mimika Baru berpusat di kota Timika, berfungsi sebagai episentrum aktivitas perekonomian, perbankan, industri kreatif, serta pusat pemerintahan. Kepadatan infrastruktur dasar di distrik ini merupakan yang paling maju di seluruh kabupaten.",
      batasWilayah: "Utara: Kuala Kencana, Selatan: Wania, Barat: Iwaka, Timur: Mimika Timur",
      images: ["/img/mimika%20baru/aerial%20view.jpg", "/img/mimika%20baru/Pasar-Sentral-Timika.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Kuala Kencana": {
      luasWilayah: 840,
      jumlahPenduduk: 28000,
      deskripsi: "Distrik Kuala Kencana merupakan kota modern terencana yang dikelola secara eksklusif berkolaborasi dengan pihak swasta pertambangan. Memiliki tata kota ramah lingkungan, jaringan kabel bawah tanah, dan kualitas sanitasi berstandar internasional.",
      batasWilayah: "Utara: Tembagapura, Selatan: Mimika Baru, Barat: Iwaka, Timur: Kwamki Narama",
      images: ["/img/kualakencana/images%20(1).jpg", "/img/kualakencana/images.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Tembagapura": {
      luasWilayah: 1452,
      jumlahPenduduk: 23000,
      deskripsi: "Distrik Tembagapura terletak di wilayah pegunungan tinggi bersuhu dingin. Merupakan pusat operasi penambangan emas dan tembaga utama. Distrik ini memiliki tantangan geografis berupa lereng terjal dan risiko tanah longsor tinggi.",
      batasWilayah: "Utara: Kabupaten Puncak, Selatan: Kuala Kencana, Barat: Alama, Timur: Hoya",
      images: ["/img/tembagapura/Grasberg_pano_(3200491589)_(cropped).jpg", "/img/tembagapura/Tembagapura_4.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Wania": {
      luasWilayah: 195,
      jumlahPenduduk: 61000,
      deskripsi: "Distrik Wania dikembangkan sebagai kawasan penyangga pemukiman perkotaan Timika. Memiliki konsentrasi pemukiman transmigrasi yang padat, pasar sentral regional, dan perkembangan ruko komersial menengah yang sangat pesat.",
      batasWilayah: "Utara: Mimika Baru, Selatan: Mimika Timur, Barat: Iwaka, Timur: Mimika Tengah",
      images: ["/img/wania/Pasar-Sentral-1-scaled.jpg", "/img/mimika%20baru/Indahhnya-Wisata-Timika.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Iwaka": {
      luasWilayah: 742,
      jumlahPenduduk: 12000,
      deskripsi: "Distrik Iwaka didominasi dataran rendah subur yang dimanfaatkan sebagai kawasan perkebunan buah, penangkaran sagu lokal, serta menjadi area perlintasan utama koridor logistik berat menuju pelabuhan dan tambang.",
      batasWilayah: "Utara: Kuala Kencana, Selatan: Amar, Barat: Mimika Barat Tengah, Timur: Mimika Baru",
      images: ["/img/iwaka/sagu-1-635c8e4408a8b57f2152e722.jpg", "/img/iwaka/WhatsApp-Image-2026-07-13-at-10.24.32.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Kwamki Narama": {
      luasWilayah: 45,
      jumlahPenduduk: 15000,
      deskripsi: "Distrik Kwamki Narama merupakan kawasan pemukiman adat yang padat. Pemerintah daerah memprioritaskan distrik ini untuk program asimilasi sosial, peningkatan literasi pendidikan dasar, dan pemberdayaan perkebunan rakyat.",
      batasWilayah: "Utara: Kuala Kencana, Selatan: Mimika Baru, Barat: Kuala Kencana, Timur: Mimika Tengah",
      images: ["/img/kwamki%20narama/prosesi-kremasi-jenazah-junius-m-janempa-di-kwamki-narama-rabu-142026-foto-cenderawasih-posmoh-wahyu-welerubun-xmAu6.webp", "/img/iwaka/traditional-honai-house-dani-tribe-260nw-2635906639.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Mimika Timur": {
      luasWilayah: 211,
      jumlahPenduduk: 11000,
      deskripsi: "Distrik Mimika Timur merupakan pintu gerbang jalur logistik kelautan utama Mimika. Berpusat di Mapurujaya, distrik ini melayani operasional pelabuhan nasional Pomako dan industri pengolahan hasil laut laut.",
      batasWilayah: "Utara: Mimika Baru, Selatan: Laut Arafura, Barat: Wania, Timur: Mimika Timur Jauh",
      images: ["/img/mimika%20timur/624e6c8c105e5.jpg", "/img/mimika%20timur/images.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Mimika Tengah": {
      luasWilayah: 341,
      jumlahPenduduk: 5500,
      deskripsi: "Distrik Mimika Tengah didominasi oleh bentang alam perairan payau dan muara sungai pesisir selatan. Mata pencaharian utama penduduknya adalah nelayan kepiting bakau dan budidaya tambak ikan tradisional.",
      batasWilayah: "Utara: Kwamki Narama, Selatan: Laut Arafura, Barat: Wania, Timur: Jita",
      images: ["/img/jita/Panoramic_view_of_dock_at_Kampung_Rawa,_2014-06-21.jpg", "/img/mimika%20barat/061348_64937_INDAH_mimika_dalam.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Mimika Barat": {
      luasWilayah: 1021,
      jumlahPenduduk: 4200,
      deskripsi: "Distrik Mimika Barat berpusat di Kokonao. Merupakan kawasan administratif bersejarah yang menyimpan rekam jejak misionaris pendidikan awal di pesisir Papua. Fokus pada pelestarian peninggalan budaya lokal.",
      batasWilayah: "Utara: Mimika Barat Tengah, Selatan: Laut Arafura, Barat: Mimika Barat Jauh, Timur: Amar",
      images: ["/img/mimika%20barat/061348_64937_INDAH_mimika_dalam.jpg", "/img/mimika%20barat/IMG-20250929-WA0041-scaled.webp"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Agimuga": {
      luasWilayah: 4124,
      jumlahPenduduk: 3800,
      deskripsi: "Distrik Agimuga merupakan kawasan dataran rendah timur Mimika yang dilalui banyak aliran sungai besar. Pembangunan infrastruktur jalan darat penghubung terus diupayakan untuk mengikis isolasi logistik antar wilayah.",
      batasWilayah: "Utara: Jila, Selatan: Laut Arafura, Barat: Jita, Timur: Mimika Timur Jauh",
      images: ["/img/agimuga/209.jpg", "/img/agimuga/7311.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Jila": {
      luasWilayah: 6011,
      jumlahPenduduk: 4500,
      deskripsi: "Distrik Jila membentang luas di kaki jajaran pegunungan tengah Mimika. Topografi berbukit curam dan lereng batu mempersulit jaringan telekomunikasi dan pembangunan jalan trans-kabupaten.",
      batasWilayah: "Utara: Kabupaten Puncak, Selatan: Agimuga, Barat: Hoya, Timur: Jita",
      images: ["/img/jila/615d4d4e6ff0c.jpg", "/img/jila/shutterstock_2362513197.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Jita": {
      luasWilayah: 4121,
      jumlahPenduduk: 2800,
      deskripsi: "Distrik Jita merupakan kawasan pedalaman berawa di timur Mimika. Sirkulasi mobilitas masyarakat sangat bergantung pada transportasi sungai, perahu kayu tradisional (*perahu jonson*), dan pasang surut air laut.",
      batasWilayah: "Utara: Jila, Selatan: Laut Arafura, Barat: Mimika Tengah, Timur: Agimuga",
      images: ["/img/jita/images.jpg", "/img/jita/Panoramic_view_of_dock_at_Kampung_Rawa,_2014-06-21.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Mimika Timur Jauh": {
      luasWilayah: 2112,
      jumlahPenduduk: 3200,
      deskripsi: "Distrik Mimika Timur Jauh terletak di pesisir muara sungai ujung timur Mimika yang berbatasan langsung dengan Kabupaten Asmat. Mayoritas penduduk bekerja mencari ikan dan mengolah sagu hutan alami.",
      batasWilayah: "Utara: Agimuga, Selatan: Laut Arafura, Barat: Mimika Timur, Timur: Kabupaten Asmat",
      images: ["/img/agimuga/7311.jpg", "/img/20170903_Papouasie_Baliem_valley_15.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Mimika Barat Jauh": {
      luasWilayah: 2122,
      jumlahPenduduk: 2100,
      deskripsi: "Distrik Mimika Barat Jauh berpusat di rumpun pesisir pantai Yaraya-Ipaya. Terkenal dengan potensi pasir pantai putih kelapa rakyat, dan pemanfaatan kincir angin skala mikro untuk listrik kampung pesisir.",
      batasWilayah: "Utara: Mimika Barat Tengah, Selatan: Laut Arafura, Barat: Kabupaten Kaimana, Timur: Mimika Barat",
      images: ["/img/mimika%20barat%20jauh/pantai-minajaya-sukabumi-1747457877972_169.jpeg", "/img/mimika%20barat/IMG-20250929-WA0041-scaled.webp"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Mimika Barat Tengah": {
      luasWilayah: 1842,
      jumlahPenduduk: 2400,
      deskripsi: "Distrik Mimika Barat Tengah melayani rute penghubung transportasi laut logistik ringan antar pesisir barat. Memiliki bentang muara yang luas dan dilindungi ekosistem hutan bakau (*mangrove*) tebal alami.",
      batasWilayah: "Utara: Kabupaten Deiyai, Selatan: Mimika Barat, Barat: Mimika Barat Jauh, Timur: Iwaka",
      images: ["/img/AMANNSAGOAOWA.jpg", "/img/mimika%20barat/061348_64937_INDAH_mimika_dalam.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Amar": {
      luasWilayah: 1221,
      jumlahPenduduk: 1800,
      deskripsi: "Distrik Amar merupakan kawasan pesisir rawa dengan mayoritas vegetasi nipa dan hutan payau. Sentra andalan daerah untuk penangkapan kepiting bakau (*Scylla serrata*) berkualitas ekspor.",
      batasWilayah: "Utara: Iwaka, Selatan: Laut Arafura, Barat: Mimika Barat, Timur: Mimika Barat Tengah",
      images: ["/img/jita/Panoramic_view_of_dock_at_Kampung_Rawa,_2014-06-21.jpg", "/img/Mimika-300x200.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Hoya": {
      luasWilayah: 2450,
      jumlahPenduduk: 1200,
      deskripsi: "Distrik Hoya terletak jauh di lembah sempit terdalam pegunungan Mimika. Akses jalan darat sama sekali tidak tersedia, membuat wilayah ini memiliki tantangan keterisolasian yang tinggi dalam pemenuhan kesehatan, logistik dasar, dan guru ajar.",
      batasWilayah: "Utara: Kabupaten Intan Jaya, Selatan: Jila, Barat: Tembagapura, Timur: Alama",
      images: ["/img/hoya/images.jpg", "/img/hoya/JembatanHoya%20(2).jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    },
    "Alama": {
      luasWilayah: 4110,
      jumlahPenduduk: 1600,
      deskripsi: "Distrik Alama terletak di ujung timur laut pegunungan terjal Mimika. Memiliki kepadatan penduduk paling kecil dengan sebaran perkampungan adat tradisional di lembah-lembah perbukitan terpencil.",
      batasWilayah: "Utara: Kabupaten Lanny Jaya, Selatan: Jita, Barat: Hoya, Timur: Kabupaten Nduga",
      images: ["/img/alama/97295c5df6d1.jpg", "/img/alama/Taman-Nasional-Lorentz-1024x679.jpg"],
      suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
    }
  };

  try {
    const geojsonPath = path.join(__dirname, '../../brida_fe/public/json/mimika_18_distrik.json');
    if (fs.existsSync(geojsonPath)) {
      const geojsonStr = fs.readFileSync(geojsonPath, 'utf-8');
      const geojson = JSON.parse(geojsonStr);
      
      for (const feature of geojson.features) {
        const districtName = feature.properties.district_name;
        const geometry = feature.geometry;
        const profile = DISTRICT_PROFILES[districtName] || {
          luasWilayah: 0.0,
          jumlahPenduduk: 0,
          deskripsi: "",
          batasWilayah: "",
          images: [],
          suggestions: ["Analisis Stunting", "Kendala Jalan Darat", "Kondisi Pendidikan"]
        };

        if (geometry.type === 'Polygon') {
          const coords = geometry.coordinates[0];
          let latSum = 0;
          let lngSum = 0;
          
          for (const [lng, lat] of coords) {
            latSum += lat;
            lngSum += lng;
          }
          
          const latitude = latSum / coords.length;
          const longitude = lngSum / coords.length;
          
          const aliases = [
            districtName.toLowerCase().replace(/\s+/g, ''),
            `distrik ${districtName.toLowerCase()}`,
            districtName.replace(/\s+/g, '-'),
          ];

          await prisma.district.upsert({
            where: { name: districtName },
            update: {
              latitude,
              longitude,
              aliases,
              luasWilayah: profile.luasWilayah,
              jumlahPenduduk: profile.jumlahPenduduk,
              deskripsi: profile.deskripsi,
              batasWilayah: profile.batasWilayah,
              images: profile.images,
              suggestions: profile.suggestions,
            },
            create: {
              name: districtName,
              latitude,
              longitude,
              aliases,
              luasWilayah: profile.luasWilayah,
              jumlahPenduduk: profile.jumlahPenduduk,
              deskripsi: profile.deskripsi,
              batasWilayah: profile.batasWilayah,
              images: profile.images,
              suggestions: profile.suggestions,
            },
          });
        } else if (geometry.type === 'MultiPolygon') {
          const coords = geometry.coordinates[0][0];
          let latSum = 0;
          let lngSum = 0;
          
          for (const [lng, lat] of coords) {
            latSum += lat;
            lngSum += lng;
          }
          
          const latitude = latSum / coords.length;
          const longitude = lngSum / coords.length;
          
          const aliases = [
            districtName.toLowerCase().replace(/\s+/g, ''),
            `distrik ${districtName.toLowerCase()}`,
            districtName.replace(/\s+/g, '-'),
          ];

          await prisma.district.upsert({
            where: { name: districtName },
            update: {
              latitude,
              longitude,
              aliases,
              luasWilayah: profile.luasWilayah,
              jumlahPenduduk: profile.jumlahPenduduk,
              deskripsi: profile.deskripsi,
              batasWilayah: profile.batasWilayah,
              images: profile.images,
              suggestions: profile.suggestions,
            },
            create: {
              name: districtName,
              latitude,
              longitude,
              aliases,
              luasWilayah: profile.luasWilayah,
              jumlahPenduduk: profile.jumlahPenduduk,
              deskripsi: profile.deskripsi,
              batasWilayah: profile.batasWilayah,
              images: profile.images,
              suggestions: profile.suggestions,
            },
          });
        }
      }
      console.log('[Seeder Success] 18 Distrik Mimika berhasil di-seed beserta centroid koordinat spasial.');
    } else {
      console.warn(`[Seeder Warning] File GeoJSON tidak ditemukan di path: ${geojsonPath}`);
    }
  } catch (err: any) {
    console.error('[Seeder Error] Gagal memproses data Geospasial distrik:', err.message);
  }

  // 6. Seed System Settings (Bupati Profil)
  console.log('[Seeder] Memulai proses seeding SystemSettings...');
  const settings = [
    { key: 'BUPATI_NAME', value: 'Johannes Rettob, S.Sos., M.M.' },
    { key: 'BUPATI_PHONE', value: '628123456789' },
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }
  console.log('[Seeder Success] SystemSettings (Bupati Profil) berhasil di-seed.');
}

main()
  .catch((e) => {
    console.error('[Seeder Error] Terjadi kesalahan saat seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });