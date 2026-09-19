import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import {
  ART_DIRECTOR_OUTPUT_SCHEMA,
  ArtDirectorOutputDto,
} from '../schemas/art-director-output.schema';
import { PosterAspectRatio } from '../interfaces/image-generator.interface';
import {
  MASTER_DESIGN_SYSTEM,
  resolveTopicInformationArchitecture,
  resolveCanvasComposition,
  ArchetypeDefinition,
  SAFE_AREA_CONFIG,
} from '../constants/infographic-design-system.constant';

/**
 * Mengambil konfigurasi safe area per aspek rasio dari SAFE_AREA_CONFIG.
 * Sumber kebenaran tunggal — nilai ini juga dipakai oleh getPosterBrandingMetrics
 * sehingga blank space AI === tinggi bar header/footer yang dirender.
 */
function getSafeAreaForAspectRatio(aspectRatio: string) {
  const key = aspectRatio as keyof typeof SAFE_AREA_CONFIG;
  return SAFE_AREA_CONFIG[key] ?? SAFE_AREA_CONFIG['9:16'];
}

export interface InitialPromptCraftOptions {
  topic: string;
  documentId?: string;
  aspectRatio: PosterAspectRatio;
  customInstructions?: string;
}

export interface PromptEvolutionOptions {
  previousPrompt: string;
  userRevisionQuery: string;
  topic: string;
  aspectRatio: PosterAspectRatio;
}

@Injectable()
export class ArtDirectorPromptArchitect {
  private readonly logger = new Logger(ArtDirectorPromptArchitect.name);

  constructor(
    private readonly llmAdapter: VendorLlmAdapter,
    private readonly documentRepository: DocumentRepository,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Information Expert: Menentukan arketipe domain topik berdasarkan pencocokan leksikal kata kunci.
   */
  public resolveTopicArchetype(topic: string): {
    archetype: ArchetypeDefinition;
    formattedZones: string;
    visualGrammarPrompt: string;
  } {
    return resolveTopicInformationArchitecture(topic);
  }

  /**
   * Mengambil data faktual riil dari SELURUH database arsip BRIDA Mimika
   */
  async searchDatabaseDocuments(topic: string, priorityDocId?: string): Promise<string> {
    try {
      const stopwords = new Set([
        'buatkan', 'poster', 'infografis', 'resmi', 'tahun', 'di', 'dan', 'yang', 'untuk',
        'dari', 'pada', 'ke', 'dengan', 'tentang', 'adalah', 'sebagai', 'kabupaten', 'daerah',
        'tolong', 'bikin', 'gambar', 'visual', 'desain'
      ]);

      const keywords = topic
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopwords.has(w))
        .slice(0, 6);

      if (keywords.length === 0) {
        keywords.push('mimika', 'stunting', 'data');
      }

      this.logger.log(`[DB Grounding] Menelusuri seluruh DB dengan kata kunci: ${keywords.join(', ')}`);

      const chunks = await this.prisma.documentChunk.findMany({
        where: {
          OR: keywords.map((kw) => ({
            rawText: { contains: kw, mode: 'insensitive' },
          })),
        },
        take: 12,
        include: {
          document: {
            select: { id: true, title: true },
          },
        },
      });

      if (chunks.length === 0) {
        const fallbackChunks = await this.prisma.documentChunk.findMany({
          take: 4,
          include: {
            document: {
              select: { id: true, title: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (fallbackChunks.length > 0) {
          return fallbackChunks
            .map(
              (c: any) =>
                `[ARSIP DOKUMEN BRIDA: ${c.document?.title || 'Dokumen Riset Daerah'}]\n${c.rawText.substring(0, 600)}`,
            )
            .join('\n---\n');
        }
        return '';
      }

      const scored = chunks.map((chunk: any) => {
        let score = 0;
        if (priorityDocId && chunk.documentId === priorityDocId) {
          score += 15;
        }
        const textLower = (chunk.rawText || '').toLowerCase();
        keywords.forEach((kw) => {
          if (textLower.includes(kw)) score += 3;
        });
        return { chunk, score };
      });

      scored.sort((a: any, b: any) => b.score - a.score);
      const topChunks = scored.slice(0, 5).map((s: any) => s.chunk);

      this.logger.log(
        `[DB Grounding Sukses] Berhasil mengekstrak ${topChunks.length} data chunk dari seluruh database BRIDA.`,
      );

      return topChunks
        .map(
          (c: any) =>
            `[ARSIP RESMI BRIDA: ${c.document?.title || 'Laporan Riset Mimika'}]\n${c.rawText.substring(0, 700)}`,
        )
        .join('\n---\n');
    } catch (err: any) {
      this.logger.warn(`[DB Grounding Warning] Gagal mengekstrak data database: ${err.message}`);
      return '';
    }
  }

  /**
   * Mengambil data faktual terkini dari INTERNET via Google Serper API
   */
  async searchInternetWeb(topic: string): Promise<string> {
    const apiKey = this.configService.get<string>('SERPER_API_KEY');
    if (!apiKey || apiKey.trim().length === 0) {
      this.logger.warn('[Web Grounding] SERPER_API_KEY tidak dikonfigurasi.');
      return '';
    }

    try {
      const cleanTopic = topic.replace(/(buatkan|poster|infografis|resmi|tolong|bikin)/gi, '').trim();
      const query = `${cleanTopic} Kabupaten Mimika BPS data statistik`;
      this.logger.log(`[Web Grounding] Menelusuri internet live Serper: "${query}"`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: 5,
          gl: 'id',
          hl: 'id',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(`[Web Grounding HTTP Error]: ${response.status} ${response.statusText}`);
        return '';
      }

      const searchJson = await response.json();
      const organic = searchJson.organic || [];

      if (organic.length === 0) {
        return '';
      }

      this.logger.log(`[Web Grounding Sukses] Berhasil mendapatkan ${organic.length} rujukan internet.`);

      return organic
        .slice(0, 4)
        .map(
          (item: any, idx: number) =>
            `[RUJUKAN WEB #${idx + 1}: ${item.title || 'Informasi Publik'}]\n${item.snippet || ''}\nURL: ${item.link || '-'}`,
        )
        .join('\n\n');
    } catch (err: any) {
      this.logger.warn(`[Web Grounding Warning] Penelusuran web dilewati: ${err.message}`);
      return '';
    }
  }

  /**
   * Tahap 1: Merangkai Super-Prompt dengan Canvas Composition + Visual Grammar + Data Provenance
   */
  async craftInitialPosterPrompt(
    options: InitialPromptCraftOptions,
  ): Promise<ArtDirectorOutputDto> {
    this.logger.log(
      `[Art Director] Merumuskan master brief infografis: "${options.topic.substring(0, 50)}..."`,
    );

    const [databaseContext, internetContext] = await Promise.all([
      this.searchDatabaseDocuments(options.topic, options.documentId),
      this.searchInternetWeb(options.topic),
    ]);

    const { archetype, formattedZones, visualGrammarPrompt } = this.resolveTopicArchetype(options.topic);
    const canvasComposition = resolveCanvasComposition(options.aspectRatio);

    // Ambil safe area yang SAMA dengan yang digunakan oleh renderer header/footer
    const safeArea = getSafeAreaForAspectRatio(options.aspectRatio);
    const headerPct = safeArea.headerBarPercent;        // e.g. 7.5
    const footerPct = safeArea.footerBarPercent;        // e.g. 4.0
    const topReserved = safeArea.topReservedPercent;    // headerBar + tolerance buffer
    const bottomReserved = safeArea.bottomReservedPercent; // footerBar + tolerance buffer

    const systemPrompt = `Anda adalah Art Director & Information Designer Senior BRIDA Kabupaten Mimika.
Tugas Anda: Merancang konsep INFOGRAFIS PEMERINTAH BERMUTU TINGGI yang PADAT INFORMASI (Data-Dense Government Policy Infographic) menggunakan Master Design System Kabupaten Mimika, lalu merangkai prompt visual dalam bahasa Inggris untuk DALL-E 3 / Modern Image AI.

PENTING: Ini adalah INFOGRAFIS DATA PEMERINTAH, BUKAN poster minimalis. Prioritaskan kepadatan informasi dan narasi visual, bukan minimalisme.

${MASTER_DESIGN_SYSTEM}

${canvasComposition}

${visualGrammarPrompt}

TOPIC-SPECIFIC VISUAL ZONES (${archetype.archetype}):
Target Warna: Dominan ${archetype.primaryColor}, Sekunder ${archetype.secondaryColor}, Aksen ${archetype.accentColor}.
Target Density: ${archetype.density.toUpperCase()}.

${formattedZones}

ATURAN UTAMA EKSEKUSI LANGSUNG (ZERO-CLARIFICATION DIRECTIVE):
1. DILARANG mengajukan pertanyaan balik atau meminta klarifikasi pada pengguna! Langsung tentukan konsep terbaik dan eksekusi.
2. Langsung berikan penjelasan singkat (maksimal 2-3 kalimat pada 'aiCommentary') mengenai arsitektur informasi, zone composition, dan angka penting yang disintesis.
3. Seluruh judul, label diagram, dan teks pada visual WAJIB 100% DALAM BAHASA INDONESIA RESMI.
4. DILARANG membuat atau mencantumkan logo/lambang/watermark apapun.

SUMBER DATA ACUAN GANDA (DUAL-SOURCE GROUNDING):
Anda dibekali data riil dari 2 sumber:
1. ARSIP SELURUH DATABASE BRIDA KABUPATEN MIMIKA
2. DATA RIIL INTERNET / BPS / BERITA PEMDA TERKINI

DATA PROVENANCE ENFORCEMENT:
- Setiap angka yang Anda tempatkan pada gambar WAJIB terdaftar di array 'extractedKeyFacts' beserta sumber dan tingkat kepercayaan ('grounded' atau 'estimated').
- Tandai 'grounded' jika angka diambil langsung dari data yang disediakan.
- Tandai 'estimated' jika merupakan estimasi wajar karena data eksak tidak tersedia.
- DILARANG membuat pie/donut chart kecuali data yang disajikan secara eksplisit merepresentasikan komponen dari satu keseluruhan yang berjumlah 100%.
- DILARANG mengubah persentase-persentase yang tidak saling berhubungan menjadi satu pie chart.

ATURAN STRUKTURAL REKAYASA PROMPT VISUAL ("imagePrompt"):
1. Susun instruksi visual bahasa Inggris yang sangat presisi untuk model generasi gambar.
2. Terapkan secara eksplisit 7 VISUAL ZONES sesuai arsitektur di atas, lengkap dengan alokasi persentase tinggi kanvas.
3. ZONE HERO (${topReserved}%-${topReserved + 20}%) harus berupa foto/visual FULL-WIDTH edge-to-edge. DILARANG menyisakan area putih kosong di bawah area header. Overlay judul dan subjudul di atas hero menggunakan kontras kuat.
4. PETA/MAP harus berukuran besar dan dominan (~18% kanvas), BUKAN peta kecil di dalam kartu. Sertakan label distrik, legenda, dan 2-4 callout anotasi data.
5. Tetapkan palet warna tegas: Dominan ${archetype.primaryColor}, Sekunder ${archetype.secondaryColor}, Aksen ${archetype.accentColor} di atas latar belakang putih bersih (#FFFFFF).
6. SELURUH TEKS, JUDUL, DAN LABEL PADA GAMBAR WAJIB 100% DALAM BAHASA INDONESIA RESMI.
7. DILARANG memunculkan logo, lambang, cap, atau watermark apapun.
8. VARIASI VISUAL: Jangan render setiap zone sebagai rectangular card. Campurkan full-width photography, metric strips, charts, maps, timelines, diagrams, icons, callout numbers, dan photographic panels.
9. WAJIB: Sisakan area KOSONG PUTIH BERSIH selebar ${topReserved}% di bagian PALING ATAS kanvas (0% hingga ${topReserved}% dari atas) — TANPA gambar, grafik, teks, maupun dekorasi apapun. Area ini adalah tempat bar header resmi instansi (tinggi ${headerPct}% dari kanvas + ruang aman).
10. WAJIB: Sisakan area KOSONG PUTIH BERSIH selebar ${bottomReserved}% di bagian PALING BAWAH kanvas (${100 - bottomReserved}% hingga 100% dari atas) — TANPA gambar, grafik, teks, maupun dekorasi apapun. Area ini adalah tempat bar footer resmi instansi (tinggi ${footerPct}% dari kanvas + ruang aman).
11. Semua konten infografis (foto, chart, peta, teks) HANYA boleh menempati zona tengah: dari ${topReserved}% hingga ${100 - bottomReserved}% tinggi kanvas.
12. Tutup prompt DALL-E dengan: "Ultra-sharp 8k resolution, dense editorial grid layout, professional vector typography strictly in Indonesian language, no logos, no watermarks, high information density, official government report style, STRICT ${topReserved}% blank white top margin (0-${topReserved}% of canvas height) reserved for official letterhead overlay, STRICT ${bottomReserved}% blank white bottom margin (${100 - bottomReserved}-100% of canvas height) reserved for official footer overlay, all infographic content strictly between ${topReserved}% and ${100 - bottomReserved}% of canvas height, balanced visual rhythm."`;

    const userMessage = `[TOPIK INFOGRAFIS]: ${options.topic}

[SUMBER DATA 1 - ARSIP SELURUH DATABASE BRIDA MIMIKA]:
${databaseContext || 'Arsip dokumen BRIDA belum memuat bab khusus topik ini, gunakan data rujukan resmi umum.'}

[SUMBER DATA 2 - PENELUSURAN LIVE INTERNET (BPS / PEMDA / BERITA RESMI)]:
${internetContext || 'Penelusuran web tidak menemukan artikel spesifik, gunakan estimasi indikator baku.'}

[ASPEK RASIO TARGET]: ${options.aspectRatio}
${options.customInstructions ? `[INSTRUKSI KHUSUS PENGGUNA]: ${options.customInstructions}` : ''}

Rancang konsep infografis pemerintah PADAT INFORMASI yang memenuhi seluruh kanvas. Integrasikan data riil di atas. Pastikan semua teks dalam Bahasa Indonesia resmi. Setiap angka yang muncul pada gambar wajib terdaftar di extractedKeyFacts beserta sumbernya. Hasilkan output JSON sesuai skema.`;

    const result = await this.llmAdapter.generateStructuredAnalysis<ArtDirectorOutputDto>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ART_DIRECTOR_OUTPUT_SCHEMA,
      0.3,
    );

    result.imagePrompt = this.enforceCanvasMargins(result.imagePrompt, options.aspectRatio);

    return result;
  }

  /**
   * Tahap 2: Prompt Evolution — Revisi visual berdasarkan instruksi chat pengguna
   */
  async evolvePosterPrompt(options: PromptEvolutionOptions): Promise<ArtDirectorOutputDto> {
    this.logger.log(
      `[Prompt Evolution] Menganalisis permintaan revisi: "${options.userRevisionQuery}"`,
    );

    const [databaseContext, internetContext] = await Promise.all([
      this.searchDatabaseDocuments(`${options.topic} ${options.userRevisionQuery}`),
      this.searchInternetWeb(`${options.topic} ${options.userRevisionQuery}`),
    ]);

    const { archetype, visualGrammarPrompt } = this.resolveTopicArchetype(`${options.topic} ${options.userRevisionQuery}`);
    const canvasComposition = resolveCanvasComposition(options.aspectRatio);

    const safeArea = (options.aspectRatio && options.aspectRatio in SAFE_AREA_CONFIG)
      ? SAFE_AREA_CONFIG[options.aspectRatio as keyof typeof SAFE_AREA_CONFIG]
      : SAFE_AREA_CONFIG['9:16'];
    const headerPct = safeArea.headerBarPercent;
    const footerPct = safeArea.footerBarPercent;

    const systemPrompt = `Anda adalah Art Director AI BRIDA Kabupaten Mimika yang sedang berdialog dengan pengguna untuk merevisi infografis.

${MASTER_DESIGN_SYSTEM}

${canvasComposition}

${visualGrammarPrompt}

Tugas Anda:
1. Pahami instruksi revisi pengguna (menambah chart, mengganti warna, mengubah angka, menambah data sektoral, memperbesar peta, dsb).
2. Perbarui prompt visual DALL-E 3 ("imagePrompt") sebelumnya dengan menerapkan perubahan yang diminta secara konsisten tanpa merusak Canvas Composition dan Visual Grammar induk.
3. Pertahankan CANVAS OCCUPANCY 85-92% (antara margin atas dan bawah). Jangan membuat poster menjadi lebih kosong di area tengah.
4. Pertahankan palet warna tematik (Dominan: ${archetype.primaryColor}, Sekunder: ${archetype.secondaryColor}, Aksen: ${archetype.accentColor}) di atas latar belakang bersih (#FFFFFF).
5. Seluruh teks pada gambar WAJIB 100% BAHASA INDONESIA RESMI.
6. DILARANG memunculkan logo, lambang, atau watermark apapun.
7. Setiap angka baru yang ditambahkan WAJIB terdaftar di extractedKeyFacts beserta sumber dan confidence.
8. WAJIB PERTAHANKAN: Area KOSONG PUTIH BERSIH selebar ${headerPct}% di bagian PALING ATAS kanvas (0%-${headerPct}%) tanpa gambar/teks/dekorasi apapun untuk logo dan nama instansi resmi.
9. WAJIB PERTAHANKAN: Area KOSONG PUTIH BERSIH selebar ${footerPct}% di bagian PALING BAWAH kanvas (${100 - footerPct}%-100%) tanpa gambar/teks/dekorasi apapun untuk informasi alamat resmi.
10. Berikan komentar dialog ("aiCommentary") yang menjelaskan revisi apa yang diterapkan. DILARANG bertanya balik.`;

    const userMessage = `[PROMPT DALL-E SEBELUMNYA]:
${options.previousPrompt}

[TOPIK UTAMA]:
${options.topic}

[DATA KONTEKS DATABASE & INTERNET TERBARU]:
${databaseContext.substring(0, 1000)}
${internetContext.substring(0, 1000)}

[INSTRUKSI REVISI DARI PENGGUNA]:
"${options.userRevisionQuery}"

[ASPEK RASIO]: ${options.aspectRatio}

Perbarui konsep visual dan hasilkan prompt terevolusi dalam skema JSON. Pastikan seluruh teks dalam Bahasa Indonesia dan canvas occupancy tetap 92-97%.`;

    const result = await this.llmAdapter.generateStructuredAnalysis<ArtDirectorOutputDto>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ART_DIRECTOR_OUTPUT_SCHEMA,
      0.3,
    );

    result.imagePrompt = this.enforceCanvasMargins(result.imagePrompt, options.aspectRatio);

    return result;
  }

  /**
   * Memastikan secara mutlak bahwa imagePrompt yang dikirim ke DALL-E / OpenAI
   * diawali dan diakhiri dengan instruksi batas margin kosong atas dan bawah
   * tanpa kompromi, sehingga model AI tidak pernah menaruh teks/gambar di area tersebut.
   */
  private enforceCanvasMargins(imagePrompt: string, aspectRatio?: string): string {
    const safeArea = getSafeAreaForAspectRatio(aspectRatio || '9:16');
    const topPct = safeArea.topReservedPercent;        // e.g. 12.0
    const bottomPct = safeArea.bottomReservedPercent;  // e.g. 6.0
    const headerBarPct = safeArea.headerBarPercent;    // e.g. 9.5
    const footerBarPct = safeArea.footerBarPercent;    // e.g. 4.0

    const prefix = `[MANDATORY CANVAS MARGIN RULES - STRICT PRIORITY 1]:
1. TOP MARGIN: The top ${topPct}% of the image canvas (from y=0% down to y=${topPct}%) MUST BE 100% COMPLETELY BLANK, SOLID PURE UNTEXTURED WHITE (#FFFFFF) with ABSOLUTELY ZERO text, zero titles, zero banners, zero photography, and zero graphics. This clean white space is strictly reserved for official government letterhead overlay (height ${headerBarPct}%).
2. BOTTOM MARGIN: The bottom ${bottomPct}% of the canvas (from y=${100 - bottomPct}% to y=100%) MUST BE 100% COMPLETELY BLANK, SOLID PURE UNTEXTURED WHITE (#FFFFFF) with zero text, zero sources, and zero graphics (reserved for official footer overlay).
3. CONTENT BOUNDARIES: ALL infographic elements, hero photography, main titles, charts, maps, and illustrations MUST start strictly below y=${topPct}% and end strictly above y=${100 - bottomPct}%.

`;

    const suffix = `

[FINAL VERIFICATION]: Double check that the top ${topPct}% of the canvas is completely untouched, solid white void with zero visual elements, and the bottom ${bottomPct}% is solid white void. All graphics and text are strictly contained between y=${topPct}% and y=${100 - bottomPct}%.`;

    // Bersihkan frasa yang berpotensi memicu AI menaruh elemen di 0%
    let cleaned = imagePrompt
      .replace(/ZONE HERO \(0-20%\)/gi, `ZONE HERO (${topPct}%-${topPct + 20}%)`)
      .replace(/from the very top/gi, `starting below the top ${topPct}% white margin`)
      .replace(/at the very top/gi, `below the top ${topPct}% white margin`)
      .replace(/at the top edge/gi, `below the top ${topPct}% white margin`);

    return `${prefix}${cleaned}${suffix}`;
  }
}

