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

      // 1. Ambil chunks dari seluruh database yang mencocokkan kata kunci
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
        // Fallback: Ambil chunk terbaru dari arsip jika kata kunci belum terindeks
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

      // 2. Beri bobot relevansi (prioritas dokumen yang dipilih + kecocokan kata kunci)
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
      const query = `${cleanTopic} Kabupaten Mimika BPS data`;
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
   * Tahap 1: Merangkai Super-Prompt awal berdasarkan topik & fakta DARI SELURUH DB + INTERNET
   */
  async craftInitialPosterPrompt(
    options: InitialPromptCraftOptions,
  ): Promise<ArtDirectorOutputDto> {
    this.logger.log(
      `[Art Director] Merumuskan konsep visual awal untuk topik: "${options.topic.substring(0, 50)}..."`,
    );

    // Ambil data faktual secara paralel dari SELURUH DB dan INTERNET
    const [databaseContext, internetContext] = await Promise.all([
      this.searchDatabaseDocuments(options.topic, options.documentId),
      this.searchInternetWeb(options.topic),
    ]);

    const systemPrompt = `Anda adalah Art Director & Creative Prompt Architect Senior untuk BRIDA Kabupaten Mimika.
Tugas Anda: Merancang konsep visual POSTER / INFOGRAFIS RESMI BERMUTU TINGGI untuk Pemerintah Daerah Mimika, lalu merangkai prompt visual dalam bahasa Inggris untuk DALL-E 3 / Modern Image AI.

ATURAN UTAMA EKSEKUSI LANGSUNG (ZERO-CLARIFICATION DIRECTIVE):
1. DILARANG mengajukan pertanyaan balik atau meminta klarifikasi pada pengguna! Langsung tentukan konsep terbaik dan eksekusi.
2. DILARANG memberikan basa-basi pembuka atau penutup. Langsung berikan penjelasan singkat (maksimal 2-3 kalimat pada 'aiCommentary') mengenai konsep visual dan data angka kunci yang disintesis.
3. Seluruh judul, label diagram, dan teks pada visual WAJIB 100% DALAM BAHASA INDONESIA RESMI (DILARANG KERAS menggunakan istilah bahasa Inggris pada teks yang dicetak di gambar!).

SUMBER DATA ACUAN GANDA (DUAL-SOURCE GROUNDING):
Anda dibekali data riil dari 2 sumber:
1. ARSIP SELURUH DATABASE BRIDA KABUPATEN MIMIKA
2. DATA RIIL INTERNET / BPS / BERITA PEMDA TERKINI
TUGAS ANDA:
- Kaji data angka persentase, rasio, target, dan indikator riil dari kedua sumber data tersebut.
- Ekstrak 2 sampai 4 fakta angka kunci tersebut ke dalam array 'extractedKeyFacts' (misal: "Prevalensi stunting Mimika: 24.2% (BPS)", "Target penurunan nasional: 14%").
- Jelaskan pada 'aiCommentary' dalam Bahasa Indonesia secara singkat dan padat (maksimal 2-3 kalimat) bagaimana data ini diterjemahkan ke dalam komposisi visual infografis.

KEBEBASAN GAYA VISUAL OTONOM (STYLE-AGNOSTIC CREATIVE AUTONOMY):
Pilihlah gaya visual yang PALING TEPAT secara otonom berdasarkan kebutuhan topik dan instruksi pengguna:
1. GAYA INFOGRAFIS DATA 2D (FLAT VECTOR DATA INFOGRAPHIC) - SANGAT DIREKOMENDASIKAN untuk topik data, statistik, persentase, perbandingan, iklim/cuaca, APBD, stunting, atau laporan sektoral:
   - Visual: 2D modern flat editorial infographic layout, clean vector data charts, bar graphs, clean circular percentage indicators, minimalist statistics cards, crisp data tables, flat outline iconography, high data-to-ink ratio, clear visual hierarchy, Swiss graphic design aesthetic.
   - PENTING: DILARANG menyelipkan kata kunci "3D isometric, volumetric shapes, floating islands, 3D boxes" pada gaya ini agar tidak menjadi pulau/kotak 3D mengambang!
2. GAYA POSTER KONSEPTUAL / KAMPANYE VISUAL - Jika pengguna meminta poster kampanye tematik, kesadaran publik, atau perayaan:
   - Visual: Bold editorial concept poster, striking focal imagery, rich cinematic lighting or vector illustration, prominent headline typography.
3. WARNA & KOMPOSISI:
   - Sesuaikan palet warna dengan topik (misal: Teal & Amber Gold untuk Kesehatan/Stunting, Executive Deep Navy Blue & Gold untuk Fiskal/APBD, Emerald Slate untuk Spasial/Infrastruktur, Terra-cotta & Indigo untuk Iklim/Bencana).

ATURAN MUTLAK BAHASA INDONESIA UNTUK SELURUH TEKS PADA GAMBAR:
1. 'posterTitle': Judul resmi sesi poster WAJIB 100% DALAM BAHASA INDONESIA FORMAL (maksimal 6-8 kata).
2. 'imagePrompt': Walaupun prompt visual ditulis dalam Bahasa Inggris deskriptif untuk generator AI, SELURUH LABEL DATA, ANGKA, DAN HEADLINE YANG AKAN DICETAK PADA GAMBAR WAJIB MURNI DALAM BAHASA INDONESIA.
   - DILARANG menggunakan kata bahasa Inggris: "CURRENT RATE", "TARGET", "INFOGRAPHIC", "HEALTH REPORT", "DATA OVERVIEW".
   - WAJIB gunakan padanan resmi Bahasa Indonesia: "PREVALENSI SAAT INI", "TARGET CAPAIAN", "TAHUN 2026", "KABUPATEN MIMIKA", "DATA STATISTIK RESMI".
   - Wajib sertakan instruksi penutup tegas di dalam prompt DALL-E: "All typography, data labels, and headers printed on the graphic must be strictly in Indonesian language. No English words on the graphic. Professional editorial typography, clean visual hierarchy, award-winning vector infographic design, pristine crisp resolution."`;

    const userMessage = `[TOPIK POSTER]: ${options.topic}

[SUMBER DATA 1 - ARSIP SELURUH DATABASE BRIDA MIMIKA]:
${databaseContext || 'Arsip dokumen BRIDA belum memuat bab khusus topik ini, gunakan data rujukan resmi umum.'}

[SUMBER DATA 2 - PENELUSURAN LIVE INTERNET (BPS / PEMDA / BERITA RESMI)]:
${internetContext || 'Penelusuran web tidak menemukan artikel spesifik, gunakan estimasi indikator baku.'}

[ASPEK RASIO]: ${options.aspectRatio}
${options.customInstructions ? `[INSTRUKSI KHUSUS]: ${options.customInstructions}` : ''}

Rancang konsep poster infografis resmi dengan mengintegrasikan data riil di atas dan pastikan semua judul dan teks pada poster dalam Bahasa Indonesia resmi. Hasilkan output JSON sesuai skema.`;

    const result = await this.llmAdapter.generateStructuredAnalysis<ArtDirectorOutputDto>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ART_DIRECTOR_OUTPUT_SCHEMA,
      0.4,
    );

    return result;
  }

  /**
   * Tahap 2: Prompt Evolution — Mengubah prompt visual berdasarkan instruksi revisi obrolan pengguna
   */
  async evolvePosterPrompt(options: PromptEvolutionOptions): Promise<ArtDirectorOutputDto> {
    this.logger.log(
      `[Prompt Evolution] Menganalisis permintaan revisi: "${options.userRevisionQuery}"`,
    );

    // Ambil konteks tambahan jika revisi meminta data baru
    const [databaseContext, internetContext] = await Promise.all([
      this.searchDatabaseDocuments(`${options.topic} ${options.userRevisionQuery}`),
      this.searchInternetWeb(`${options.topic} ${options.userRevisionQuery}`),
    ]);

    const systemPrompt = `Anda adalah Art Director AI BRIDA Kabupaten Mimika yang sedang berdialog dengan pengguna untuk merevisi poster infografis.
Tugas Anda:
1. Pahami instruksi revisi pengguna dari kueri chat (misal: menambah pie chart, mengganti warna jadi hijau, mengubah teks angka, menambah data sektoral, dsb).
2. Perbarui prompt visual DALL-E 3 ("imagePrompt") sebelumnya dengan menerapkan perubahan yang diminta secara konsisten tanpa merusak elemen inti yang tidak diminta diubah.
3. Tetap pertahankan gaya 2D Flat Vector Data Layout jika pengguna meminta penyajian data/grafik, tanpa memunculkan pulau 3D atau kubus mengambang liar kecuali jika pengguna secara eksplisit meminta elemen 3D.
4. Seluruh judul, label data, dan teks pada gambar WAJIB 100% DALAM BAHASA INDONESIA RESMI (DILARANG menggunakan bahasa Inggris pada teks gambar).
5. Berikan komentar dialog dalam Bahasa Indonesia ("aiCommentary") yang menjelaskan secara ramah dan profesional revisi apa saja yang telah diterapkan pada poster baru, termasuk angka/fakta yang diperbarui.
6. Format output wajib berupa JSON sesuai skema.`;

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

Perbarui konsep visual dan hasilkan prompt DALL-E 3 terevolusi dalam skema JSON. Pastikan seluruh teks pada poster dalam Bahasa Indonesia resmi.`;

    const result = await this.llmAdapter.generateStructuredAnalysis<ArtDirectorOutputDto>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ART_DIRECTOR_OUTPUT_SCHEMA,
      0.3,
    );

    return result;
  }
}


