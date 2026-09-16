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
      'Eksekutif, berorientasi solusi, berwibawa, lugas, padat, dan menyajikan tabel komparasi strategis.',
    vocabulary:
      'langkah konkret, percepatan pembangunan, aksi cepat (quick wins), implementasi kebijakan, efisiensi fiskal, dampak langsung.',
  },
  kritis: {
    target: 'Kepala Organisasi Perangkat Daerah (OPD) & Tim Evaluasi Pengawasan Kinerja Mimika',
    focus:
      'Audit kepatuhan tata kelola, evaluasi deviasi operasional sektoral dinas, transparansi anggaran, identifikasi sumbatan teknis (bottlenecks), dan mitigasi risiko ke depan.',
    style:
      'Tajam, analitis, ketat, menuntut akuntabilitas teknis sektoral, serta membedah data menggunakan tabel deviasi.',
    vocabulary:
      'deviasi anggaran, sumbatan teknis (bottlenecks), kelemahan tata kelola, ketimpangan alokasi, audit kepatuhan, pemborosan sumber daya.',
  },
  akademis: {
    target: 'Rekan Peneliti Badan Riset, Akademisi Perguruan Tinggi, dan Mitra Pembangunan',
    focus:
      'Metodologi evaluasi kebijakan, analisis kausalitas berbasis bukti faktual (*evidence-based*), komparasi indikator standar nasional, dan dekomposisi statistik.',
    style:
      'Rasional, metodologis, objektif, berimbang (*cover-both-sides*), serta menyajikan tabel statistik lengkap.',
    vocabulary:
      'analisis kausalitas, bukti faktual (evidence-based), metodologi evaluasi, korelasi indikator standar, signifikansi statistik, postulat.',
  },
  populer: {
    target: 'Masyarakat Umum, Tokoh Adat, dan Publik Kabupaten Mimika',
    focus:
      'Dampak nyata langsung kebijakan terhadap kehidupan warga, penyederhanaan istilah birokrasi, keterbukaan anggaran, dan manfaat fasilitas pembangunan.',
    style:
      'Komunikatif, mengalir, ramah pembaca, namun tetap dilengkapi sorotan angka statistik utama.',
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

  public generateTemporalGroundTruth(): TemporalMetadata {
    const now = new Date();

    const monthNamesIndo = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
    ];

    const monthIndex = now.getMonth();
    const currentMonth = monthNamesIndo[monthIndex];
    const currentYear = now.getFullYear();
    const day = now.getDate();

    const currentFullDate = `${day} ${currentMonth} ${currentYear}`;

    let currentQuarter = 'Triwulan I (Q1)';
    if (monthIndex >= 3 && monthIndex <= 5) currentQuarter = 'Triwulan II (Q2)';
    else if (monthIndex >= 6 && monthIndex <= 8) currentQuarter = 'Triwulan III (Q3)';
    else if (monthIndex >= 9) currentQuarter = 'Triwulan IV (Q4)';

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
      ? `=== DOKUMEN UTAMA (GROUND TRUTH LOKAL KABUPATEN MIMIKA) ===\n\nGunakan dokumen ini sebagai basis realitas capaian daerah Mimika:\n\n${localContextText}`
      : '';

    const externalSection = externalContextText
      ? `=== DOKUMEN PENDUKUNG (REGULASI PUSAT / DATA STATISTIK) ===\n\nGunakan dokumen di bawah ini untuk pengayaan analisis:\n\n${externalContextText}`
      : '';

    const scrapedSection =
      scrapedUrls.length > 0
        ? `=== REFERENSI BENCHMARK DUNIA & DATA WEB EKSTERNAL ===\n\nBerikut adalah data dan artikel pembanding terkini dari internet. Gunakan sebagai tolak ukur (benchmark) komparasi makro.\n\nATURAN SITASI WEB: Sematkan sitasi [URL] persis di sebelah setiap klaim data yang dikutip.\n\n` +
        scrapedUrls
          .map(
            (page, idx) =>
              `[SUMBER BENCHMARK ${idx + 1}]:\nJudul: ${page.title}\nTautan: ${page.url}\nKonten:\n${page.text}`,
          )
          .join('\n\n')
        : '';

    let contextPayloadText = [localSection, externalSection, scrapedSection]
      .filter(Boolean)
      .join('\n\n');

    if (!contextPayloadText) {
      contextPayloadText =
        'Sistem beroperasi dalam mode pengetahuan umum. Gunakan draf pengguna dan pengetahuan internal Anda untuk menganalisis dan menyusun data.';
    }

    // --- PENENTUAN PANDUAN PANJANG NASKAH & KEPADATAN STRUKTURAL ---
    let lengthGuidance = `
Target Panjang Naskah: SHORT (~750 KATA PENUH) - Padat, Bernas & Kaya Format.
- Susun dalam 3–4 Bab/Bagian utama (##).
- Setiap bagian WAJIB memiliki minimal 150–250 kata (akumulasi bebas dari narasi, poin analitis, atau tabel data).
- Eksplorasi permasalahan pokok, pertimbangan regulasi, dan rekomendasi utama secara konkret dan terstruktur.
`;

    if (targetLength === 'MEDIUM') {
      lengthGuidance = `
Target Panjang Naskah: MEDIUM (~1.500 KATA PENUH) - Komprehensif, Proporsional & Berbobot.
- Susun dalam 4–5 Bab/Bagian utama (##).
- Setiap bagian WAJIB memiliki minimal 300–400 kata. Bebas kombinasikan tabel data, poin-poin taktis, dan narasi kebijakan.
- Eksplorasi akar masalah, analisis data/indikator daerah, dan strategi tindak lanjut secara runtut dan mendalam.
`;
    } else if (targetLength === 'LONG') {
      lengthGuidance = `
Target Panjang Naskah: LONG (MINIMAL 3.000 KATA HINGGA 4.000 KATA PENUH) - Sangat Mendalam, Lengkap & Ekstensif.
- Silakan berekspresi secara total! Kupas tuntas topik ini dari berbagai dimensi kebijakan, regulasi, dan dampak sosio-ekonomi wilayah Mimika.
- Susun dalam 5–7 Bab/Bagian utama (##).
- KETENTUAN KEPADATAN SUBSTANSI: Setiap bab/bagian WAJIB memiliki minimal 450–600 kata yang diuraikan secara kaya dan menyeluruh.
- SANGAT DIANJURKAN menggunakan kombinasi tabel komparasi data, daftar langkah taktis/bullet points, grafik visual QuickChart (Pie/Bar/Line), dan narasi analitis.
- DILARANG KERAS membuat naskah pendek atau memecah teks menjadi belasan sub-heading kecil satu kalimat!
- Tidak perlu mencantumkan bab daftar pustaka di halaman belakang; manfaatkan seluruh kapasitas kata untuk menyajikan analisis mendalam yang berbobot.
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

PANDUAN PENYELARASAN WAKTU:
1. Posisi waktu sistem Anda saat ini adalah: ${temporal.currentFullDate} (${temporal.currentSemester}).
2. Evaluasi kinerja masa lalu diperlakukan secara retrospektif (fakta historis).
3. SELURUH REKOMENDASI KEBIJAKAN DAN TINDAKAN OPERASIONAL WAJIB DITUJUKAN UNTUK PERIODE MASA DEPAN (${temporal.currentSemester} atau Tahun Anggaran ${temporal.currentYear + 1}). DILARANG merekomendasikan aksi mundur ke masa yang sudah lewat.
`;

    const customSystemPersona = `
${BRIDA_SYSTEM_PERSONA}

${temporalAnchorBlock.trim()}

ATURAN TARGET AUDIENS & MODULASI GAYA:
- Sasaran Kebijakan: **${steering.target}**
- Fokus Penulisan: ${steering.focus}
- Gaya Bahasa: ${steering.style}
- Istilah Taktis Wajib: *${steering.vocabulary}*

PANDUAN CORONG TERBALIK (INVERTED FUNNEL):
1. Mulai dengan konteks umum atau tolak ukur (benchmark) nasional/kementerian dari sumber eksternal.
2. Sintesiskan dengan fakta riil dari [DOKUMEN UTAMA] Kabupaten Mimika.
3. Rumuskan kesimpulan dan rekomendasi yang terapan khusus bagi Kabupaten Mimika.

BLUEPRINT PANJANG NASKAH KANVAS:
${lengthGuidance}
`;

    const userParts: any[] = [];
    let userTextContent = `[INSTRUKSI / PERTANYAAN PENGGUNA]\n${userQuery}`;

    if (currentDraft && currentDraft.trim().length > 0) {
      userTextContent += `\n\n[DRAF ARTIKEL AKTIF SAAT INI (PANE KANAN)]\n${currentDraft}`;
    }
    userParts.push({ text: userTextContent });

    if (images.length > 0) {
      this.logger.log(
        `[Multimodal Ingest] Menyertakan ${images.length} data biner visual ke dalam prompt.`,
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
        content: `[DOKUMEN ACUAN TERDAFTAR]\n${contextPayloadText}`,
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
      `[ContextAssemblyBroker] Sukses merakit Inverted Funnel Prompt Payload (${estimatedTokens} estimated input tokens).`,
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
      `[Stuffing Strategy] Total token (${totalTokens}) < ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menyematkan dokumen utuh untuk ${validDocs.length} berkas.`,
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
      : 'Dokumen acuan terpilih tidak memiliki teks yang cocok untuk distrik yang diminta.';
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
      `[Dynamic RAG Strategy] Total token (${totalTokens}) >= ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menjalankan pencarian semantik...`,
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
            `Gagal mengambil chunk semantik untuk ID '${doc.id}': ${err.message}`,
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

    if (highlyRelevantResults.length > 0) {
      return highlyRelevantResults
        .map(
          (item, idx) =>
            `--- CHUNK RELEVAN ${idx + 1} (Dokumen: ${item.documentId}, Indeks: ${item.chunkIndex}, Skor: ${item.similarityScore.toFixed(3)}) ---\n${item.rawText}`,
        )
        .join('\n\n');
    }

    return 'Konteks dokumen rujukan yang relevan dengan pertanyaan tidak ditemukan.';
  }
}