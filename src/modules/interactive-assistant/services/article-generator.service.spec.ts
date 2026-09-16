import { Test, TestingModule } from '@nestjs/testing';
import { ContextAssemblyService } from '../../ai-agent/services/context-assembly.service';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VectorRetrievalService } from '../../ai-agent/services/vector-retrieval.service';
import { TokenEstimatorUtil } from '../../ai-agent/utils/token-estimator.util';
import { EDITORIAL_STYLE_GUIDE } from '../../ai-agent/constants/system-prompts.constant';
import { SectionDensityValidator } from '../utils/section-density-validator.util';

describe('Article Generation Density & Length Constraint Suite (Phase 4 Validation)', () => {
  let contextAssemblyService: ContextAssemblyService;

  const mockDocumentRepository = {
    findById: jest.fn().mockResolvedValue({
      id: 'doc-mock-001',
      title: 'Laporan RPJMD Kabupaten Mimika 2026',
      metadata: { totalTokenCount: 1500, category: 'Perencanaan' },
      chunks: [
        { rawText: 'Data capaian makro ekonomi dan infrastruktur distrik Kabupaten Mimika.' },
      ],
    }),
  };

  const mockVectorRetrievalService = {
    searchRelevantChunks: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextAssemblyService,
        TokenEstimatorUtil,
        { provide: DocumentRepository, useValue: mockDocumentRepository },
        { provide: VectorRetrievalService, useValue: mockVectorRetrievalService },
      ],
    }).compile();

    contextAssemblyService = module.get<ContextAssemblyService>(ContextAssemblyService);
  });

  describe('1. Verifikasi System Persona & Editorial Style Guide Constraints', () => {
    it('harus memuat aturan kepadatan minimal 150 kata per bab', () => {
      expect(EDITORIAL_STYLE_GUIDE).toContain('MINIMAL 150 KATA');
      expect(EDITORIAL_STYLE_GUIDE).toContain('2 sampai 4 paragraf tebal');
    });

    it('harus memuat larangan tegas fragmentasi sub-heading kecil', () => {
      expect(EDITORIAL_STYLE_GUIDE).toContain('LARANGAN FRAGMENTASI HEADING');
      expect(EDITORIAL_STYLE_GUIDE).toContain('DILARANG KERAS memecah naskah');
    });
  });

  describe('2. Verifikasi Prompt Assembly untuk Setiap Target Panjang Naskah', () => {
    it('harus merakit prompt SHORT dengan target ~750 kata dan bab >= 150 kata', async () => {
      const payload = await contextAssemblyService.assemblePromptPayload({
        documentIds: ['doc-mock-001'],
        userQuery: 'Analisis Stunting',
        targetLength: 'SHORT',
      });

      const systemContent = payload.messages[0].content;
      expect(systemContent).toContain('SHORT (~750 KATA PENUH)');
      expect(systemContent).toContain('minimal 150–250 kata');
      expect(systemContent).toContain('3–4 Bab/Bagian utama');
    });

    it('harus merakit prompt MEDIUM dengan target ~1.500 kata dan bab >= 300 kata', async () => {
      const payload = await contextAssemblyService.assemblePromptPayload({
        documentIds: ['doc-mock-001'],
        userQuery: 'Evaluasi APBD',
        targetLength: 'MEDIUM',
      });

      const systemContent = payload.messages[0].content;
      expect(systemContent).toContain('MEDIUM (~1.500 KATA PENUH)');
      expect(systemContent).toContain('minimal 300–400 kata');
      expect(systemContent).toContain('4–5 Bab/Bagian utama');
    });

    it('harus merakit prompt LONG dengan target minimal 3.000 kata penuh dan bab >= 450 kata', async () => {
      const payload = await contextAssemblyService.assemblePromptPayload({
        documentIds: ['doc-mock-001'],
        userQuery: 'Strategi Komprehensif Daerah',
        targetLength: 'LONG',
      });

      const systemContent = payload.messages[0].content;
      expect(systemContent).toContain('LONG (MINIMAL 3.000 KATA HINGGA 4.000 KATA PENUH)');
      expect(systemContent).toContain('minimal 450–600 kata');
      expect(systemContent).toContain('5–7 Bab/Bagian utama');
    });
  });

  describe('3. Verifikasi Section Density Validator pada Sampel Naskah Kebijakan', () => {
    it('harus meloloskan naskah dengan struktur bab padat (>150 kata per bab)', () => {
      const sampleThickArticle = `
# Analisis Kebijakan Fiskal dan Strategi Percepatan Pembangunan Daerah Kabupaten Mimika

**Disusun oleh: Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika**

## I. Ringkasan Eksekutif & Latar Belakang Masalah
Kondisi perekonomian daerah Kabupaten Mimika pada tahun anggaran berjalan menunjukkan dinamika yang memerlukan respons kebijakan terarah dan berbasis bukti faktual. Fluktuasi penerimaan sektor pertambangan dan royalti komoditas tembaga menuntut pemerintah daerah untuk segera melakukan akselerasi diversifikasi pendapatan asli daerah guna menjaga stabilitas belanja publik. Evaluasi berkala terhadap serapan anggaran menunjukkan adanya disparitas efisiensi antar-instansi teknis yang berpotensi memperlambat realisasi output fisik di distrik pedalaman dan pesisir.

Pemerintah daerah perlu menata ulang prioritas belanja program dengan fokus utama pada pemenuhan infrastruktur dasar, peningkatan mutu layanan kesehatan, dan penguatan fasilitas pendidikan dasar di wilayah terluar. Sinergi antara badan riset daerah, dinas teknis, dan mitra pembangunan strategis menjadi fondasi esensial dalam memastikan setiap rupiah alokasi fiskal memberikan dampak nyata yang dapat diukur bagi kesejahteraan masyarakat Orang Asli Papua (OAP). Langkah konsolidasi fiskal ini harus diiringi dengan penetapan indikator kinerja utama yang terukur pada setiap unit kerja sehingga efektivitas penyerapan belanja daerah dapat dipantau secara transparan dan akuntabel di Kabupaten Mimika.

## II. Tinjauan Analisis Kinerja & Matriks Hambatan Sektoral
Evaluasi menyeluruh terhadap pelaksanaan program sektoral mengidentifikasi beberapa sumbatan teknis utama yang menghambat pencapaian target pembangunan jangka menengah daerah. Hambatan logistik transportasi dan kondisi topografi ekstrem di wilayah pegunungan seperti Distrik Hoya, Alama, dan Jila terus memicu eskalasi biaya operasional proyek fisik di lapangan secara signifikan. Keterlambatan proses verifikasi dokumen administratif di tingkat dinas teknis turut memperpanjang siklus pencairan termin anggaran kepada rekanan pelaksana pekerjaan.

Di sektor pelayanan dasar, kendala distribusi suplemen gizi dan keterbatasan tenaga medis di posyandu kampung memperlambat laju penurunan prevalensi stunting balita. Penanganan komprehensif membutuhkan integrasi pengawasan terpadu berbasis platform geospasial agar deviasi pekerjaan fisik dan sumbatan logistik dapat diintervensi secara dini sebelum menimbulkan kerugian keuangan daerah yang lebih besar. Koordinasi lintas instansi juga membutuhkan penguatan payung hukum operasional dan standarisasi prosedur pelayanan publik agar seluruh program penanganan stunting dan intervensi gizi spesifik dapat menjangkau sasaran keluarga rentan secara presisi, terpadu, dan berkelanjutan di seluruh distrik pedalaman Mimika.

## III. Rekomendasi Aksi Taktis & Roadmap Implementasi
Berdasarkan diagnosa faktual di atas, dirumuskan langkah taktis prioritas yang harus dieksekusi lintas Organisasi Perangkat Daerah pada semester berjalan. Pertama, pembentukan satuan tugas percepatan verifikasi dan harmonisasi termin pembayaran proyek fisik untuk mencegah penumpukan penyerapan anggaran di akhir tahun. Kedua, penguatan armada transportasi logistik terpadu ke distrik terisolasi melalui kolaborasi penerbangan perintis bersubsidi.

Ketiga, peningkatan kapasitas kader posyandu kampung dan alokasi insentif operasional berbasis kinerja lapangan guna mengawal pencapaian target zero stunting baru. Keempat, implementasi audit kepatuhan berkala oleh Inspektorat daerah yang diselaraskan dengan rekomendasi analitis BRIDA untuk memastikan akuntabilitas tata kelola pemerintahan yang transparan dan adaptif. Kelima, pengembangan kapasitas aparatur perencana melalui pelatihan berkala penyusunan kebijakan berbasis bukti, serta pelibatan partisipatif lembaga adat dan tokoh masyarakat dalam mengawal keberhasilan roadmap pembangunan daerah ini. Selanjutnya, dialokasikan pula pos anggaran darurat terdesentralisasi pada tingkat distrik guna mengantisipasi eskalasi bencana alam serta membiayai evakuasi logistik secara responsif tanpa hambatan birokrasi yang berbelit-belit demi kesejahteraan warga Mimika.
      `.trim();

      const audit = SectionDensityValidator.auditMarkdown(sampleThickArticle);

      expect(audit.totalChapters).toBe(3);
      expect(audit.hasAntiFragmentationPassed).toBe(true);
      expect(audit.chapters.every((c) => c.wordCount >= 150)).toBe(true);
      expect(audit.chapters.every((c) => c.paragraphCount >= 2)).toBe(true);
    });

    it('harus menggagalkan naskah yang mengalami heading inflation (sub-bab tipis 1 kalimat)', () => {
      const sampleFragmentedArticle = `
# Laporan Singkat

## Bab 1
Ini adalah bab satu yang sangat pendek.

## Bab 2
Ini adalah bab dua yang hanya satu baris saja.

## Bab 3
Ini bab tiga tanpa elaborasi data.
      `.trim();

      const audit = SectionDensityValidator.auditMarkdown(sampleFragmentedArticle);
      expect(audit.hasAntiFragmentationPassed).toBe(false);
      expect(audit.chapters.some((c) => c.wordCount < 150)).toBe(true);
    });
  });
});
