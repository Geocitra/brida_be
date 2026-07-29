import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VectorRetrievalService } from './vector-retrieval.service';
import { TokenEstimatorUtil } from '../utils/token-estimator.util';
import { MultimodalChatMessage } from '../providers/vendor-llm.adapter';
import { DYNAMIC_CONTEXT_TOKEN_THRESHOLD, BRIDA_SYSTEM_PERSONA, BRIDA_GUARDRAIL_POSTFIX } from '../constants/system-prompts.constant';

export interface MultimodalAssembleOptions {
  documentIds?: string[];         // ID dokumen repositori (permanen & hasil bypass chat)
  images?: Array<{                // Screenshot hasil paste clipboard (Ctrl+V)
    mimeType: string;
    base64Data: string;
  }>;
  userQuery: string;              // Teks instruksi + draf kasar 2-3 paragraf pengguna
  currentDraft?: string;          // Draf naskah Markdown aktif saat ini (Pane Kanan)
  tone?: string;                  // Opsi target pembaca: SOLUTIF | KRITIS | AKADEMIS | POPULER
  targetLength?: string;          // Target panjang tulisan: SHORT | MEDIUM | LONG
  topK?: number;
  similarityThreshold?: number;
  districts?: string[];
}

export interface MultimodalPromptPayload {
  messages: MultimodalChatMessage[];
  estimatedTokens: number;
}

// Map Penargetan Gaya Bahasa & Audiens Resmi BRIDA Mimika
const TONE_AUDIENCE_STEERING_MAP: Record<string, { target: string; focus: string; style: string; vocabulary: string }> = {
  solutif: {
    target: 'Bupati Kabupaten Mimika',
    focus: 'Rekomendasi tindakan taktis, dampak makro-fiskal daerah, penyusunan rancangan regulasi taktis, serta perumusan langkah konkret cepat (Quick Wins).',
    style: 'Eksekutif, berorientasi solusi, berwibawa, lugas, padat, dan mencerminkan kepemimpinan daerah.',
    vocabulary: 'langkah konkret, percepatan pembangunan, aksi cepat (quick wins), implementasi kebijakan, efisiensi fiskal, dampak langsung.',
  },
  kritis: {
    target: 'Kepala Organisasi Perangkat Daerah (OPD) Mimika',
    focus: 'Audit kepatuhan tata kelola, evaluasi deviasi operasional sektoral dinas, transparansi pertanggungjawaban anggaran, dan identifikasi sumbatan teknis (bottlenecks).',
    style: 'Tajam, analitis, ketat, menuntut akuntabilitas teknis sektoral, serta berorientasi evaluatif-korektif.',
    vocabulary: 'deviasi anggaran, sumbatan teknis (bottlenecks), kelemahan tata kelola, ketimpangan alokasi, audit kepatuhan, pemborosan sumber daya.',
  },
  akademis: {
    target: 'Rekan Jurnalis Media Massa, Akademisi Perguruan Tinggi, dan Pengurus LSM (Lembaga Swadaya Masyarakat)',
    focus: 'Metodologi evaluasi kebijakan, analisis kausalitas data berbasis bukti faktual (*evidence-based*), komparasi indikator standar nasional, dan landasan teori kebijakan publik.',
    style: 'Rasional, metodologis, objektif, berimbang (*cover-both-sides*), serta menggunakan istilah tata kelola standar ilmiah.',
    vocabulary: 'analisis kausalitas, bukti faktual (evidence-based), metodologi evaluasi, korelasi indikator standar, signifikansi statistik, postulat.',
  },
  populer: {
    target: 'Masyarakat Umum Kabupaten Mimika',
    focus: 'Dampak nyata langsung dari kebijakan terhadap kehidupan warga, penyederhanaan istilah birokrasi, keterbukaan alokasi dana publik, dan kegunaan fasilitas pembangunan.',
    style: 'Sederhana, naratif, mengalir, komunikatif, ramah pembaca (*highly readable*), serta menggunakan analogi kehidupan sehari-hari.',
    vocabulary: 'manfaat nyata, kehidupan sehari-hari, transparansi publik, kemudahan layanan, uang rakyat, kesejahteraan keluarga.',
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
   * Mengumpulkan seluruh modalitas data dan menyusun Prompt Komposit Multimodal terpadu
   */
  async assemblePromptPayload(options: MultimodalAssembleOptions): Promise<MultimodalPromptPayload> {
    const {
      documentIds = [],
      images = [],
      userQuery,
      currentDraft,
      tone = 'solutif',
      targetLength = 'MEDIUM',
      topK = 10,
      similarityThreshold = 0.5,
    } = options;

    let contextPayloadText = '';
    const activeTone = tone.toLowerCase();

    // 1. Jalur Jalankan Dokumen Acuan (RAG vs Stuffing) jika ada referensi yang dipilih
    if (documentIds.length > 0) {
      const docs = await Promise.all(documentIds.map((id) => this.repository.findById(id)));
      const validDocs = docs.filter((d): d is NonNullable<typeof d> => d !== null && d !== undefined);

      if (validDocs.length > 0) {
        const totalTokens = validDocs.reduce((acc, doc) => acc + (doc.metadata?.totalTokenCount || 0), 0);

        if (totalTokens < DYNAMIC_CONTEXT_TOKEN_THRESHOLD) {
          contextPayloadText = await this.executeFullDocumentStuffingStrategy(validDocs, totalTokens, options.districts);
        } else {
          contextPayloadText = await this.executeDynamicRagStrategy(
            validDocs,
            totalTokens,
            userQuery,
            topK,
            similarityThreshold,
            options.districts,
          );
        }
      }
    } else {
      this.logger.log('[Zero-Reference Mode] Tidak ada dokumen acuan terdaftar. AI berfokus pada draf & ketikan pengguna.');
      contextPayloadText = 'Sistem berjalan dalam mode mandiri. Gunakan draf ketikan pengguna dan pengetahuan internal Anda untuk menulis naskah.';
    }

    // Tentukan panduan panjang tulisan berdasarkan parameter Target Length (Structural & Density Prompting Blueprint)
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

    // 2. Rakit Steering System Persona berdasarkan gaya bahasa target pembaca
    const steering = TONE_AUDIENCE_STEERING_MAP[activeTone] || TONE_AUDIENCE_STEERING_MAP['solutif'];
    const customSystemPersona = `
${BRIDA_SYSTEM_PERSONA}

ATURAN TARGET AUDIENS GAYA BAHASA (TONE STEERING):
- Artikel ini ditujukan kepada: **${steering.target}**
- Fokus utama penulisan: ${steering.focus}
- Gaya penyampaian bahasa: ${steering.style}
- **Kosa Kata Fungsional Wajib (Vocabulary Steer):** Anda wajib menyisipkan istilah-istilah taktis berikut secara natural dalam naskah: *${steering.vocabulary}*

ATURAN PANJANG NASKAH & BLUEPRINT DENSITAS STRUKTURAL:
${lengthGuidance}
- Anda WAJIB mengembangkan pembahasan, analisis, rekomendasi, dan data pendukung agar memenuhi target panjang naskah di atas. Jangan mengembalikan respons singkat jika target adalah LONG/MEDIUM.

ATURAN COLLABORATIVE CO-WRITING:
- Jika pengguna memasukkan draf tulisan pribadinya di dalam prompt, prioritas utama Anda adalah memoles, menyempurnakan struktur kalimat, memparafrase, atau melanjutkan draf tersebut secara mulus (*seamless*).
- Pertahankan ide orisinal dan fakta yang ditulis oleh pengguna, tingkatkan kualitas bahasanya agar sesuai dengan target audiens di atas.
`;

    // 3. Susun Komponen User Message Parts (Multimodal Payload)
    const userParts: any[] = [];

    // Part A: Teks instruksi pengguna + Draf Kasar buatan mereka
    let userTextContent = `[INSTRUKSI / DRAF INPUT PENGGUNA]\n${userQuery}`;

    // Jika ada draf aktif di Pane Kanan, sertakan agar AI tahu versi naskah terkininya
    if (currentDraft && currentDraft.trim().length > 0) {
      userTextContent += `\n\n[DRAF ARTIKEL AKTIF SAAT INI (PANE KANAN)]\n${currentDraft}`;
    }
    userParts.push({ text: userTextContent });

    // Part B: Data Gambar Biner (Pasted Screenshot dari Clipboard) jika ada
    if (images.length > 0) {
      this.logger.log(`[Multimodal Ingest] Memasukkan ${images.length} data biner visual (screenshot) ke prompt user parts.`);
      images.forEach((img) => {
        userParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64Data,
          },
        });
      });
    }

    // 4. Susun Struktur Pesan Multimodal Terpadu
    const messages: MultimodalChatMessage[] = [
      {
        role: 'system',
        content: customSystemPersona.trim()
      },
      {
        role: 'system',
        content: `[DOKUMEN TERLAMPIR - RUANG KONTEKS STATIS]\n${contextPayloadText}`
      },
      {
        role: 'user',
        content: '', // Konten teks dipindah ke parts
        parts: userParts,
      },
      {
        role: 'user',
        content: BRIDA_GUARDRAIL_POSTFIX
      },
    ];

    // 5. Evaluasi Anggaran Token Input sebelum Pengiriman (Circuit Breaker Guardrail)
    const rawTextsForEstimation = messages.map((m) => m.content).concat([userTextContent]);
    const estimatedTokens = this.tokenEstimator.estimateArrayTokenCount(rawTextsForEstimation);

    this.logger.log(
      `[ContextAssemblyBroker] Sukses merakit Composite Multimodal Prompt (Estimasi Input: ${estimatedTokens} tokens).`,
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
          filteredChunks = doc.chunks.filter((c: any) =>
            c.detected_districts && c.detected_districts.some((d: string) => districts.includes(d))
          );
        }
        if (filteredChunks.length > 0) {
          allChunksText.push(`=== DOKUMEN: ${doc.title} ===\n` + filteredChunks.map((c: any) => c.rawText).join('\n\n'));
        }
      }
    });

    return allChunksText.length > 0 ? allChunksText.join('\n\n') : 'Konteks dokumen rujukan yang relevan dengan topik pertanyaan tidak ditemukan untuk distrik yang dipilih.';
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
      this.vectorRetrieval.searchRelevantChunks({
        documentId: doc.id,
        queryText: userQuery,
        topK,
        similarityThreshold,
        districts,
      }).catch((err) => {
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

    const swappedOutCount = combinedFlatResults.length - highlyRelevantResults.length;

    this.logger.log(
      `[Dynamic Semantic Swapping] Selesai menyaring konteks. ${highlyRelevantResults.length} chunks relevan dimasukkan (SWAPPED IN), ${swappedOutCount} chunks sampah semantik dibuang (SWAPPED OUT) dari prompt payload [4].`,
    );

    if (highlyRelevantResults.length > 0) {
      return highlyRelevantResults
        .map(
          (item, idx) =>
            `--- CHUNK ${idx + 1} (Dokumen: ${item.documentId}, Indeks: ${item.chunkIndex
            }, Skor Semantik: ${item.similarityScore.toFixed(3)}) ---\n${item.rawText}`,
        )
        .join('\n\n');
    }

    return 'Konteks dokumen rujukan yang relevan dengan topik pertanyaan tidak ditemukan.';
  }
}