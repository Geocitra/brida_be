import { Injectable, Logger } from '@nestjs/common';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VectorRetrievalService } from './vector-retrieval.service';
import { TokenEstimatorUtil } from '../utils/token-estimator.util';
import { MultimodalChatMessage } from '../providers/vendor-llm.adapter';
import {
  DYNAMIC_CONTEXT_TOKEN_THRESHOLD,
  BRIDA_SYSTEM_PERSONA,
  BRIDA_GUARDRAIL_POSTFIX,
} from '../constants/system-prompts.constant';

export interface MultimodalAssembleOptions {
  documentIds?: string[];
  images?: Array<{
    mimeType: string;
    base64Data: string;
  }>;
  userQuery: string;
  currentDraft?: string;
  tone?: string;
  targetLength?: string;
  topK?: number;
  similarityThreshold?: number;
  districts?: string[];
  scrapedUrls?: Array<{ url: string; title: string; text: string }>;
}

export interface MultimodalPromptPayload {
  messages: MultimodalChatMessage[];
  estimatedTokens: number;
}

export interface TemporalMetadata {
  currentFullDate: string;
  currentMonth: string;
  currentYear: number;
  currentQuarter: string;
  currentSemester: string;
  rawDateISO: string;
}

const TONE_AUDIENCE_STEERING_MAP: Record<
  string,
  { target: string; focus: string; style: string; vocabulary: string }
> = {
  solutif: {
    target: 'Bupati Kabupaten Mimika & Jajaran Pengambil Keputusan Daerah',
    focus:
      'Rekomendasi tindakan taktis ke depan, dampak makro-fiskal daerah, perumusan regulasi percepatan, serta penetapan langkah cepat (Quick Wins).',
    style:
      'Eksekutif, berorientasi solusi, berwibawa, lugas, padat, dan mencerminkan kepemimpinan daerah.',
    vocabulary:
      'langkah konkret, percepatan pembangunan, aksi cepat (quick wins), implementasi kebijakan, efisiensi fiskal, dampak langsung.',
  },
  kritis: {
    target: 'Kepala Organisasi Perangkat Daerah (OPD) & Tim Evaluasi Pengawasan Kinerja Mimika',
    focus:
      'Audit kepatuhan tata kelola, evaluasi deviasi operasional sektoral dinas, transparansi anggaran, identifikasi sumbatan teknis (bottlenecks), dan mitigasi risiko ke depan.',
    style:
      'Tajam, analitis, ketat, menuntut akuntabilitas teknis sektoral, serta berorientasi evaluatif-korektif.',
    vocabulary:
      'deviasi anggaran, sumbatan teknis (bottlenecks), kelemahan tata kelola, ketimpangan alokasi, audit kepatuhan, pemborosan sumber daya.',
  },
  akademis: {
    target: 'Rekan Jurnalis Media Massa, Peneliti Badan Riset, Akademisi Perguruan Tinggi, dan LSM',
    focus:
      'Metodologi evaluasi kebijakan, analisis kausalitas berbasis bukti faktual (*evidence-based*), komparasi indikator standar nasional, dan dekomposisi variabel ekonomi pembangunan.',
    style:
      'Rasional, metodologis, objektif, berimbang (*cover-both-sides*), serta menggunakan terminologi standar ilmiah.',
    vocabulary:
      'analisis kausalitas, bukti faktual (evidence-based), metodologi evaluasi, korelasi indikator standar, signifikansi statistik, postulat.',
  },
  populer: {
    target: 'Masyarakat Umum, Tokoh Adat, dan Publik Kabupaten Mimika',
    focus:
      'Dampak nyata langsung kebijakan terhadap kehidupan warga, penyederhanaan istilah birokrasi, keterbukaan alokasi anggaran, dan manfaat fasilitas pembangunan.',
    style:
      'Sederhana, naratif, mengalir, komunikatif, ramah pembaca (*highly readable*), serta menggunakan analogi kehidupan sehari-hari.',
    vocabulary:
      'manfaat nyata, kehidupan sehari-hari, transparansi publik, kemudahan layanan, uang rakyat, kesejahteraan keluarga.',
  },
};

@Injectable()
export class ContextAssemblyService {
  private readonly logger = new Logger(ContextAssemblyService.name);

  constructor(
    private readonly repository: DocumentRepository,
    private readonly vectorRetrieval: VectorRetrievalService,
    private readonly tokenEstimator: TokenEstimatorUtil,
  ) { }

  /**
   * Menghasilkan titik jangkar waktu sistem saat ini secara otomatis (Information Expert)
   */
  public generateTemporalGroundTruth(): TemporalMetadata {
    const now = new Date();

    const monthNamesIndo = [
      'Januari',
      'Februari',
      'Maret',
      'April',
      'Mei',
      'Juni',
      'Juli',
      'Agustus',
      'September',
      'Oktober',
      'November',
      'Desember',
    ];

    const monthIndex = now.getMonth();
    const currentMonth = monthNamesIndo[monthIndex];
    const currentYear = now.getFullYear();
    const day = now.getDate();

    const currentFullDate = `${day} ${currentMonth} ${currentYear}`;

    let currentQuarter = 'Triwulan I (Q1)';
    if (monthIndex >= 3 && monthIndex <= 5) {
      currentQuarter = 'Triwulan II (Q2)';
    } else if (monthIndex >= 6 && monthIndex <= 8) {
      currentQuarter = 'Triwulan III (Q3)';
    } else if (monthIndex >= 9) {
      currentQuarter = 'Triwulan IV (Q4)';
    }

    const currentSemester =
      monthIndex < 6
        ? `Semester I (Januari–Juni ${currentYear})`
        : `Semester II (Juli–Desember ${currentYear})`;

    return {
      currentFullDate,
      currentMonth,
      currentYear,
      currentQuarter,
      currentSemester,
      rawDateISO: now.toISOString(),
    };
  }

  /**
   * Merakit seluruh modalitas data menjadi prompt komposit multimodal dengan kepatuhan waktu mutlak
   */
  async assemblePromptPayload(
    options: MultimodalAssembleOptions,
  ): Promise<MultimodalPromptPayload> {
    const {
      documentIds = [],
      images = [],
      userQuery,
      currentDraft,
      tone = 'solutif',
      targetLength = 'MEDIUM',
      topK = 10,
      similarityThreshold = 0.5,
      districts = [],
      scrapedUrls = [],
    } = options;

    const temporal = this.generateTemporalGroundTruth();
    const activeTone = tone.toLowerCase();

    let localContextText = '';
    let externalContextText = '';

    if (documentIds.length > 0) {
      const docs = await Promise.all(
        documentIds.map((id) => this.repository.findById(id)),
      );
      const validDocs = docs.filter(
        (d): d is NonNullable<typeof d> => d !== null && d !== undefined,
      );

      if (validDocs.length > 0) {
        const localDocs = validDocs.filter(
          (d) => !(d.metadata as any)?.sourceUrl,
        );
        const externalDocs = validDocs.filter(
          (d) => !!(d.metadata as any)?.sourceUrl,
        );

        if (localDocs.length > 0) {
          const localTokens = localDocs.reduce(
            (acc, doc) => acc + (doc.metadata?.totalTokenCount || 0),
            0,
          );
          if (localTokens < DYNAMIC_CONTEXT_TOKEN_THRESHOLD) {
            localContextText = await this.executeFullDocumentStuffingStrategy(
              localDocs,
              localTokens,
              districts,
            );
          } else {
            localContextText = await this.executeDynamicRagStrategy(
              localDocs,
              localTokens,
              userQuery,
              topK,
              similarityThreshold,
              districts,
            );
          }
        }

        if (externalDocs.length > 0) {
          const externalTokens = externalDocs.reduce(
            (acc, doc) => acc + (doc.metadata?.totalTokenCount || 0),
            0,
          );
          if (externalTokens < DYNAMIC_CONTEXT_TOKEN_THRESHOLD) {
            externalContextText = await this.executeFullDocumentStuffingStrategy(
              externalDocs,
              externalTokens,
              districts,
            );
          } else {
            externalContextText = await this.executeDynamicRagStrategy(
              externalDocs,
              externalTokens,
              userQuery,
              topK,
              similarityThreshold,
              districts,
            );
          }
        }
      }
    }

    const localSection = localContextText
      ? `=== DOKUMEN UTAMA (OTORITAS LOKAL - GROUND TRUTH BRIDA MIMIKA) ===\n\nGunakan dokumen di bawah ini sebagai sumber kebenaran utama fakta daerah:\n\n${localContextText}`
      : '';

    const externalSection = externalContextText
      ? `=== DOKUMEN PENDUKUNG (PENGAYAAN EKSTERNAL / KOMPARASI NASIONAL) ===\n\nGunakan dokumen di bawah ini secara proaktif untuk komparasi, dasar hukum pusat, atau pengayaan analisis:\n\n${externalContextText}`
      : '';

    const scrapedSection =
      scrapedUrls.length > 0
        ? `=== DOKUMEN PENDUKUNG (SITASI WEB LANGSUNG) ===\n\nBerikut adalah konten dari tautan web atau hasil penelusuran eksternal resmi. Gunakan sebagai acuan pendukung analitis.\n\nATURAN SITASI WEB WAJIB: Sematkan sitasi URL aslinya menggunakan format kurung siku langsung: [URL] di sebelah setiap klaim fakta dari web tersebut.\n\n` +
        scrapedUrls
          .map(
            (page, idx) =>
              `[SUMBER ${idx + 1}]:\nJudul: ${page.title}\nTautan: ${page.url}\nKonten:\n${page.text}`,
          )
          .join('\n\n')
        : '';

    let contextPayloadText = [localSection, externalSection, scrapedSection]
      .filter(Boolean)
      .join('\n\n');

    if (!contextPayloadText) {
      this.logger.log(
        '[Zero-Reference Mode] Tidak ada dokumen acuan terdaftar. AI berfokus pada draf & ketikan pengguna.',
      );
      contextPayloadText =
        'Sistem berjalan dalam mode mandiri. Gunakan draf ketikan pengguna dan pengetahuan internal Anda untuk menulis naskah.';
    }

    let lengthGuidance = `
Target Panjang Teks: SHORT (~700 kata) - Ringkas & Padat.
- Struktur Penulisan: Terbagi secara tegas dalam 2-3 bab/bagian utama yang langsung menyoroti inti permasalahan.
- Kepadatan Paragraf: Setiap paragraf berbobot padat, dengan batasan maksimal 4-5 kalimat per paragraf.
- Efisiensi Kata: Gunakan kalimat aktif dan hindari penjelasan bertele-tele.
    `;
    if (targetLength === 'MEDIUM') {
      lengthGuidance = `
Target Panjang Teks: MEDIUM (~1000 kata) - Sedang & Komprehensif.
- Struktur Penulisan: Terbagi secara sistematis dalam 3-4 bab/bagian utama (contoh: Latar Belakang/Pendahuluan, Analisis Fakta Spasial, dan Rekomendasi Kebijakan).
- Kepadatan Paragraf: Setiap paragraf menguraikan satu ide pokok dengan penjelasan pendukung yang relevan (sekitar 5-7 kalimat per paragraf).
      `;
    } else if (targetLength === 'LONG') {
      lengthGuidance = `
Target Panjang Teks: LONG (~1500 kata) - Mendalam, Mendetail, & Analitis Formal.
- Struktur Penulisan: Terbagi secara terstruktur penuh dalam 4-5 bab/bagian utama (contoh: Latar Belakang Kebijakan, Gambaran Umum Spasial Wilayah, Analisis Komparatif Indikator Pembangunan, Matriks Hambatan Sektoral, dan Rekomendasi Program Strategis). Sediakan pula sub-bagian (sub-headings) untuk masing-masing topik.
- Kepadatan Paragraf: Pembahasan mendalam dengan rincian data sektoral, matriks program, dan rujukan historis kebijakan (sekitar 6-8 kalimat per paragraf).
      `;
    }

    const steering =
      TONE_AUDIENCE_STEERING_MAP[activeTone] ||
      TONE_AUDIENCE_STEERING_MAP['solutif'];

    const temporalAnchorBlock = `
[INFORMASI WAKTU SISTEM SAAT INI (TEMPORAL GROUND TRUTH)]
- Tanggal Eksekusi Riil : ${temporal.currentFullDate}
- Bulan Berjalan        : ${temporal.currentMonth} ${temporal.currentYear}
- Posisi Semester Aktif : ${temporal.currentSemester}
- Posisi Triwulan Aktif : ${temporal.currentQuarter}

PANDUAN PENYELARASAN WAKTU WAJIB:
1. Posisi waktu Anda saat ini adalah: ${temporal.currentFullDate} (${temporal.currentSemester}).
2. Jika topik mengevaluasi periode sebelum ${temporal.currentMonth} ${temporal.currentYear} (misalnya Semester I ${temporal.currentYear} atau tahun-tahun sebelumnya), perlakukan periode tersebut sebagai HISTORIS (TELAH BERLALU).
3. Evaluasi kinerja membedah data aktual yang sudah terjadi di periode lampau tersebut.
4. SELURUH REKOMENDASI KEBIJAKAN, RENCANA AKSI, DAN SOLUSI TAKTIS WAJIB DITUJUKAN UNTUK PERIODE MASA DEPAN (${temporal.currentSemester} atau Tahun Anggaran ${temporal.currentYear + 1}). DILARANG merekomendasikan aksi mundur ke periode yang sudah selesai.
`;

    const customSystemPersona = `
${BRIDA_SYSTEM_PERSONA}

${temporalAnchorBlock.trim()}

ATURAN TARGET AUDIENS GAYA BAHASA (TONE STEERING):
- Artikel ini ditujukan kepada: **${steering.target}**
- Fokus utama penulisan: ${steering.focus}
- Gaya penyampaian bahasa: ${steering.style}
- **Kosa Kata Fungsional Wajib (Vocabulary Steer):** Anda wajib menyisipkan istilah-istilah taktis berikut secara natural dalam naskah: *${steering.vocabulary}*

ATURAN PRIORITAS SUMBER DATA (HIERARCHY OF TRUTH):
1. Utamakan fakta dari [DOKUMEN UTAMA] sebagai kebenaran mutlak data daerah Kabupaten Mimika.
2. Gunakan data dari [DOKUMEN PENDUKUNG] secara proaktif untuk komparasi nasional, berita terkini, atau dasar hukum kementerian.
3. Sebutkan nama dokumen rujukan secara alami dan sematkan sitasi aslinya [docId:chunkIndex] atau [URL] di samping klaim data.

ATURAN FORMATTING & PARAGRAF (SPASI GANDA):
- Setiap pergantian paragraf baru wajib dipisahkan menggunakan spasi ganda standar Markdown (double newline / '\\n\\n').

ATURAN PANJANG NASKAH & BLUEPRINT DENSITAS STRUKTURAL:
${lengthGuidance}
- Kembangkan pembahasan, analisis kausalitas, dan rekomendasi prospektif agar memenuhi target panjang di atas.

ATURAN COLLABORATIVE CO-WRITING:
- Jika pengguna menyertakan draf tulisan pribadinya, prioritas utama adalah memoles, menyempurnakan struktur kalimat, dan melanjutkan draf tersebut secara mulus (*seamless*) dengan mempertahankan ide orisinalnya.
`;

    const userParts: any[] = [];

    let userTextContent = `[INSTRUKSI / DRAF INPUT PENGGUNA]\n${userQuery}`;

    if (currentDraft && currentDraft.trim().length > 0) {
      userTextContent += `\n\n[DRAF ARTIKEL AKTIF SAAT INI (PANE KANAN)]\n${currentDraft}`;
    }
    userParts.push({ text: userTextContent });

    if (images.length > 0) {
      this.logger.log(
        `[Multimodal Ingest] Memasukkan ${images.length} data biner visual ke prompt user parts.`,
      );
      images.forEach((img) => {
        userParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64Data,
          },
        });
      });
    }

    const messages: MultimodalChatMessage[] = [
      {
        role: 'system',
        content: customSystemPersona.trim(),
      },
      {
        role: 'system',
        content: `[DOKUMEN TERLAMPIR - RUANG KONTEKS STATIS]\n${contextPayloadText}`,
      },
      {
        role: 'user',
        content: '',
        parts: userParts,
      },
      {
        role: 'user',
        content: BRIDA_GUARDRAIL_POSTFIX,
      },
    ];

    const rawTextsForEstimation = messages
      .map((m) => m.content)
      .concat([userTextContent]);
    const estimatedTokens =
      this.tokenEstimator.estimateArrayTokenCount(rawTextsForEstimation);

    this.logger.log(
      `[ContextAssemblyBroker] Sukses merakit Composite Multimodal Prompt dengan Temporal Anchor ${temporal.currentFullDate} (Estimasi Input: ${estimatedTokens} tokens).`,
    );

    return {
      messages,
      estimatedTokens,
    };
  }

  private async executeFullDocumentStuffingStrategy(
    validDocs: any[],
    totalTokens: number,
    districts?: string[],
  ): Promise<string> {
    this.logger.log(
      `[Hybrid Strategy A - Stuffed] Total tokens (${totalTokens}) < ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menggunakan Full-Document Stuffing untuk ${validDocs.length} dokumen.`,
    );

    const allChunksText: string[] = [];
    validDocs.forEach((doc) => {
      if (doc.chunks && doc.chunks.length > 0) {
        let filteredChunks = doc.chunks;
        if (districts && districts.length > 0) {
          filteredChunks = doc.chunks.filter(
            (c: any) =>
              c.detected_districts &&
              c.detected_districts.some((d: string) => districts.includes(d)),
          );
        }
        if (filteredChunks.length > 0) {
          allChunksText.push(
            `=== DOKUMEN: ${doc.title} ===\n` +
            filteredChunks.map((c: any) => c.rawText).join('\n\n'),
          );
        }
      }
    });

    return allChunksText.length > 0
      ? allChunksText.join('\n\n')
      : 'Konteks dokumen rujukan yang relevan dengan topik pertanyaan tidak ditemukan untuk distrik yang dipilih.';
  }

  private async executeDynamicRagStrategy(
    validDocs: any[],
    totalTokens: number,
    userQuery: string,
    topK: number,
    similarityThreshold: number,
    districts?: string[],
  ): Promise<string> {
    this.logger.log(
      `[Hybrid Strategy B - Dynamic RAG] Total tokens (${totalTokens}) >= ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Mengevaluasi kedekatan semantik kueri...`,
    );

    const retrievalTasks = validDocs.map((doc) =>
      this.vectorRetrieval
        .searchRelevantChunks({
          documentId: doc.id,
          queryText: userQuery,
          topK,
          similarityThreshold,
          districts,
        })
        .catch((err) => {
          this.logger.warn(
            `Gagal mengambil chunks semantik untuk Dokumen ID '${doc.id}': ${err.message}`,
          );
          return [];
        }),
    );

    const allResultsList = await Promise.all(retrievalTasks);
    const combinedFlatResults = allResultsList.flat();

    const highlyRelevantResults = combinedFlatResults
      .filter((chunk) => chunk.similarityScore >= similarityThreshold)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, topK);

    const swappedOutCount =
      combinedFlatResults.length - highlyRelevantResults.length;

    this.logger.log(
      `[Dynamic Semantic Swapping] Selesai menyaring konteks. ${highlyRelevantResults.length} chunks relevan dimasukkan, ${swappedOutCount} chunks sampah dibuang.`,
    );

    if (highlyRelevantResults.length > 0) {
      return highlyRelevantResults
        .map(
          (item, idx) =>
            `--- CHUNK ${idx + 1} (Dokumen: ${item.documentId}, Indeks: ${item.chunkIndex
            }, Skor Semantik: ${item.similarityScore.toFixed(3)}) ---\n${item.rawText
            }`,
        )
        .join('\n\n');
    }

    return 'Konteks dokumen rujukan yang relevan dengan topik pertanyaan tidak ditemukan.';
  }

  async assembleSpatialDensityManifest(documentIds: string[]): Promise<string> {
    const manifestParts: string[] = [];

    for (const id of documentIds) {
      const doc = await this.repository.findById(id);
      if (doc) {
        const density = await this.repository.getDocumentDistrictDensity(id);

        const densityLines = Object.entries(density)
          .map(
            ([district, count]) =>
              `- Distrik ${district}: Disebut sebanyak ${count} kali dalam dokumen`,
          )
          .join('\n');

        manifestParts.push(
          `=== PROFIL KERAPATAN SPASIAL DOKUMEN: ${doc.title} ===\n` +
          `Laporan mencatat intensitas pembahasan distrik sebagai berikut:\n` +
          `${densityLines ||
          'Tidak ada spesifikasi penyebutan nama distrik secara eksplisit.'
          }`,
        );
      }
    }

    return manifestParts.join('\n\n');
  }
}