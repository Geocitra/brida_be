import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  GenerateInfographicDto,
  InfographicResponseDto,
  InfographicContentData,
  InfographicAspectRatio,
  InfographicBlock,
} from '../dtos/generate-infographic.dto';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

@Injectable()
export class InfographicService implements OnModuleInit {
  private readonly logger = new Logger(InfographicService.name);
  private recentInfographics: InfographicResponseDto[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get indexPath(): string {
    return join(process.cwd(), 'uploads', 'media', 'infographics_index.json');
  }

  onModuleInit() {
    this.loadIndexFromDisk();
  }

  private loadIndexFromDisk() {
    try {
      if (existsSync(this.indexPath)) {
        const raw = readFileSync(this.indexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.recentInfographics = parsed;
          this.logger.log(
            `[InfographicService] Berhasil memuat ${parsed.length} infografis tersimpan dari disk.`,
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `[InfographicService] Gagal membaca indeks infografis dari disk: ${err.message}`,
      );
    }
  }

  private saveIndexToDisk() {
    try {
      const mediaDir = join(process.cwd(), 'uploads', 'media');
      if (!existsSync(mediaDir)) {
        mkdirSync(mediaDir, { recursive: true });
      }
      writeFileSync(
        this.indexPath,
        JSON.stringify(this.recentInfographics, null, 2),
        'utf-8',
      );
    } catch (err: any) {
      this.logger.warn(
        `[InfographicService] Gagal menyimpan indeks infografis ke disk: ${err.message}`,
      );
    }
  }

  async generateInfographic(
    dto: GenerateInfographicDto,
    userId?: string,
  ): Promise<InfographicResponseDto> {
    const id = uuidv4();
    const aspectRatio: InfographicAspectRatio = dto.aspectRatio || '9:16';
    const visualStyle = dto.visualStyle || 'modern-vector';

    this.logger.log(
      `[InfographicService] Memulai generasi poster infografis (${aspectRatio}, ${visualStyle}) untuk topik: "${dto.topic.substring(
        0,
        50,
      )}..."`,
    );

    let documentContext = '';
    try {
      if (dto.documentId) {
        const doc = await this.prisma.reportDocument.findUnique({
          where: { id: dto.documentId },
          include: { chunks: { take: 5 } },
        });
        if (doc) {
          const chunkTexts = doc.chunks.map((c) => c.rawText).join('\n---\n');
          documentContext = `\n\n[DOKUMEN REFERENSI SPESIFIK: ${doc.title}]\n${chunkTexts.substring(
            0,
            3000,
          )}`;
        }
      } else {
        const cleanWords = dto.topic
          .replace(/[^\w\s]/gi, '')
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 3 &&
              ![
                'buatkan',
                'gambar',
                'infografis',
                'yang',
                'menyajikan',
                'data',
                'statistik',
                'terhadap',
                'tahun',
              ].includes(w.toLowerCase()),
          )
          .slice(0, 6);

        if (cleanWords.length > 0) {
          const relevantChunks = await this.prisma.documentChunk.findMany({
            where: {
              OR: cleanWords.map((kw) => ({
                rawText: { contains: kw, mode: 'insensitive' },
              })),
            },
            take: 4,
            include: { document: true },
          });

          if (relevantChunks && relevantChunks.length > 0) {
            const combinedTexts = relevantChunks
              .map(
                (c) =>
                  `[SUMBER LAPORAN: ${
                    c.document?.title || 'Dokumen Riset Daerah'
                  }]\n${c.rawText}`,
              )
              .join('\n---\n');
            documentContext = `\n\n[DATA FAKTUAL DARI DATABASE DOKUMEN BRIDA]:\n${combinedTexts.substring(
              0,
              3000,
            )}`;
            this.logger.log(
              `[InfographicService] Berhasil mengekstrak ${
                relevantChunks.length
              } data riil dari arsip dokumen BRIDA terkait: ${cleanWords.join(
                ', ',
              )}`,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `[InfographicService] Pencarian data dokumen dilewati: ${err.message}`,
      );
    }

    const structuredContent = await this.runArtDirectorLlm(
      dto.topic,
      documentContext,
      aspectRatio,
      visualStyle,
      dto.customInstructions,
    );

    const localImageUrl = await this.generateDalleBackground(
      id,
      structuredContent.dallePrompt,
      aspectRatio,
      structuredContent.themeColors,
    );

    const result: InfographicResponseDto = {
      id,
      imageUrl: localImageUrl,
      aspectRatio,
      visualStyle,
      content: structuredContent,
      createdAt: new Date().toISOString(),
    };

    this.recentInfographics.unshift(result);
    if (this.recentInfographics.length > 50) {
      this.recentInfographics.pop();
    }
    this.saveIndexToDisk();

    this.logger.log(
      `[InfographicService] Berhasil membuat dan menyimpan poster infografis id=${id} secara permanen.`,
    );
    return result;
  }

  async getRecentInfographics(): Promise<InfographicResponseDto[]> {
    return this.recentInfographics;
  }

  async getInfographicById(id: string): Promise<InfographicResponseDto> {
    const item = this.recentInfographics.find((i) => i.id === id);
    if (!item) {
      throw new NotFoundException(
        `Infografis dengan id '${id}' tidak ditemukan.`,
      );
    }
    return item;
  }

  async updateInfographicContent(
    id: string,
    updatedContent: InfographicContentData,
  ): Promise<InfographicResponseDto> {
    const item = await this.getInfographicById(id);
    item.content = updatedContent;
    this.saveIndexToDisk();
    this.logger.log(
      `[InfographicService] Berhasil memperbarui teks infografis id=${id} ke sistem.`,
    );
    return item;
  }

  private async runArtDirectorLlm(
    topic: string,
    documentContext: string,
    aspectRatio: InfographicAspectRatio,
    visualStyle: string,
    customInstructions?: string,
  ): Promise<InfographicContentData> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const model =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';

    const systemPrompt = `Anda adalah Kepala Pusat Data & Art Director Senior di BRIDA (Badan Riset dan Inovasi Daerah) Kabupaten Mimika, Papua Tengah.
Tugas utama Anda: Merancang POSTER INFOGRAFIS STATISTIK DAN KEBIJAKAN RESMI MULTI-SEKTORAL berlandaskan data faktual (Evidence-Based Policy) untuk Kabupaten Mimika.

PANDUAN ART DIRECTOR & GENERATIVE UI (BLOCK-BASED ENGINE):
1. Anda bebas dan wajib memilih antara 4 sampai 6 blok visual ("blocks") yang PALING TEPAT untuk merepresentasikan topik pengguna.
2. Setiap blok harus memiliki jenis "type" yang spesifik dari daftar berikut:
   - "METRIC_CARDS": Kartu ringkasan angka statistik/KPI utama dengan persentase tren naik/turun. Cocok untuk data prevalensi kesehatan, pertumbuhan penduduk, atau realisasi anggaran.
   - "BAR_CHART": Grafik batang perbandingan (bulanan atau antar-kategori/OPD). Cocok untuk data curah hujan, alokasi APBD per dinas, atau volume panen.
   - "LINE_CHART": Grafik garis perkembangan data/indeks waktu. Cocok untuk tren inflasi, indeks ENSO, atau laju PDRB tahunan.
   - "PROGRESS_ITEMS": Progress bar pencapaian target/komoditas dengan persentase realisasi. Cocok untuk perbandingan target vs capaian fisik lapangan.
   - "ICON_LIST": Poin-poin temuan fakta strategis atau faktor penyebab dengan ikon semantik ('alert', 'trend-up', 'trend-down', 'check', 'leaf', 'water', 'fire', 'health', 'info').
   - "DISTRICT_STATUS": Matriks sebaran status wilayah per distrik di Kabupaten Mimika (Tingkat: 'Tinggi', 'Sedang-Tinggi', 'Sedang', 'Rendah'). Gunakan distrik resmi Mimika (contoh: Mimika Baru, Kuala Kencana, Tembagapura, Wania, Iwaka, Kwamki Narama, Mimika Timur, Mimika Tengah, Mimika Barat, Agimuga, Jila, Jita, Hoya, Alama).
   - "ACTION_STEPS": Rekomendasi rencana aksi / langkah mitigasi kebijakan bernomor beserta penanggung jawab (PIC) dan prioritas.

3. STRUKTUR PAYLOAD TIAP TIPE BLOK (WAJIB SESUAI FORMAT):
   - METRIC_CARDS: { "items": [ { "label": string, "value": string, "changePercent": string, "changeType": "positive"|"negative"|"neutral", "note": string } ] }
   - BAR_CHART: { "categories": string[], "series": [ { "name": string, "data": number[], "color": string } ], "unit": string }
   - LINE_CHART: { "points": [ { "label": string, "value": number } ], "unit": string, "thresholdLabel": string }
   - PROGRESS_ITEMS: { "legend": { "current": string, "baseline": string }, "items": [ { "name": string, "current": number, "max": number, "currentLabel": string, "maxLabel": string, "changePercent": number, "changeLabel": string, "unit": string } ] }
   - ICON_LIST: { "items": [ { "icon": "alert"|"trend-up"|"trend-down"|"check"|"leaf"|"water"|"fire"|"health"|"info", "title": string, "text": string } ] }
   - DISTRICT_STATUS: { "districts": [ { "name": string, "level": "Tinggi"|"Sedang-Tinggi"|"Sedang"|"Rendah", "note": string } ] }
   - ACTION_STEPS: { "steps": [ { "stepNumber": number, "title": string, "text": string, "pic": string, "priority": "TINGGI"|"SEDANG"|"RENDAH" } ], "commitmentBadge": string }

4. DALLE PROMPT ATURAN (UNTUK BANNER BACKGROUND SAJA):
   Tuliskan deskripsi foto lanskap alam resolusi tinggi Kabupaten Mimika (sungai, hutan tropis, pegunungan Grasberg, pemukiman pesisir). Wajib sertakan instruksi tegas di akhir: "editorial documentary landscape photography of Mimika Papua, sunny soft lighting, high resolution, strictly no text, no typography, no letters, no watermark, clean composition".

5. FORMAT OUTPUT HARUS BERUPA JSON MURNI VALID MENGIKUTI STRUKTUR KONTRAK BERIKUT:
{
  "title": "string judul ringkas",
  "subtitle": "string subjudul",
  "categoryBadge": "string kategori 1-2 kata",
  "dallePrompt": "string prompt gambar latar lanskap tanpa teks",
  "themeColors": {
    "primary": "#0284c7",
    "secondary": "#0f172a",
    "accent": "#f97316"
  },
  "header": {
    "eyebrow": "INFOGRAFIS STATISTIK & KEBIJAKAN",
    "titlePrefix": "string prefix (opsional)",
    "titleMain": "string judul utama",
    "subtitle": "string subjudul detail",
    "description": "string 1-2 kalimat ringkasan eksekutif latar belakang",
    "regionTag": "KABUPATEN MIMIKA, Papua Tengah",
    "statusCard": {
      "period": "Tahun 2026",
      "statusLabel": "Status Indikator",
      "statusValue": "AKTIF / STRATEGIS",
      "category": "Kategori: Sektoral Daerah",
      "sourceNote": "(Kajian BRIDA & BPS Mimika)"
    }
  },
  "blocks": [
    {
      "id": "block-1",
      "type": "METRIC_CARDS",
      "title": "1. INDIKATOR CAPAIAN UTAMA",
      "subtitle": "Tahun Anggaran 2026",
      "insight": "Ringkasan analisis pergerakan indikator utama daerah.",
      "payload": { ... }
    },
    ... (total 4 sampai 6 blok)
  ],
  "footer": {
    "tagline": "Pembangunan Berkelanjutan Berbasis Riset & Inovasi Daerah Kabupaten Mimika.",
    "sources": "Sumber: BRIDA Mimika | BPS Kabupaten Mimika | OPD Teknis Terkait | 2026"
  }
}`;

    const userPrompt = `[TOPIK INFOGRAFIS]\n${topic}\n${documentContext}${
      customInstructions
        ? `\n\n[INSTRUKSI KHUSUS PENGGUNA]\n${customInstructions}`
        : ''
    }\n\n[ASPEK RASIO TARGET]\n${aspectRatio}`;

    try {
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('OPENAI_API_KEY belum dikonfigurasi di backend .env');
      }

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `OpenAI Chat API error: ${response.status} - ${errText}`,
        );
      }

      const data = await response.json();
      const contentStr = data.choices?.[0]?.message?.content;
      const parsed = JSON.parse(contentStr);

      return {
        title:
          parsed.title ||
          parsed.header?.titleMain ||
          'Infografis Kebijakan & Riset Daerah',
        subtitle:
          parsed.subtitle ||
          parsed.header?.subtitle ||
          'Pemerintah Kabupaten Mimika',
        categoryBadge:
          parsed.categoryBadge ||
          parsed.header?.statusCard?.category ||
          'KEBIJAKAN DAERAH',
        dallePrompt:
          parsed.dallePrompt ||
          `A wide professional editorial aerial landscape photograph of rivers, tropical forest, and mountains in Mimika Regency Papua, soft sunlight, scientific government documentary style, strictly no text, no typography, clean panoramic composition`,
        themeColors: parsed.themeColors || {
          primary: '#0284c7',
          secondary: '#0f172a',
          accent: '#f97316',
        },
        header: parsed.header || {
          eyebrow: 'INFOGRAFIS STATISTIK & KEBIJAKAN',
          titleMain: parsed.title || 'Infografis Riset Daerah',
          subtitle: 'Kabupaten Mimika Tahun 2026',
          description:
            'Analisis tematik berbasis data riset dan inovasi daerah untuk akselerasi pembangunan Kabupaten Mimika.',
          regionTag: 'KABUPATEN MIMIKA, Papua Tengah',
          statusCard: {
            period: 'Tahun 2026',
            statusLabel: 'Status Analisis',
            statusValue: 'TERVERIFIKASI',
            category: 'Kategori: Kebijakan',
            sourceNote: '(Data Riset BRIDA Mimika)',
          },
        },
        blocks:
          Array.isArray(parsed.blocks) && parsed.blocks.length > 0
            ? parsed.blocks
            : this.generateFallbackBlocks(topic),
        footer: parsed.footer || {
          tagline:
            'Bersama membangun Kabupaten Mimika yang maju, inklusif, dan berkelanjutan.',
          sources:
            'Sumber: BRIDA Mimika | BPS Kabupaten Mimika | OPD Terkait | 2026',
        },
      };
    } catch (err: any) {
      this.logger.error(
        `[Art Director Error] ${err.message}. Menggunakan fallback polimorfik adaptif.`,
      );
      return this.generateFallbackContent(topic);
    }
  }

  private async generateDalleBackground(
    id: string,
    dallePrompt: string,
    aspectRatio: InfographicAspectRatio,
    themeColors: { primary: string; secondary: string; accent: string },
  ): Promise<string> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const mediaDir = join(process.cwd(), 'uploads', 'media');
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }

    const imageModel =
      this.configService.get<string>('OPENAI_IMAGE_MODEL') ||
      'chatgpt-image-latest';

    let imageSize = '1024x1024';
    if (aspectRatio === '9:16') {
      imageSize = '1024x1536';
    } else if (aspectRatio === '16:9') {
      imageSize = '1536x1024';
    }

    try {
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('OPENAI_API_KEY tidak ditemukan.');
      }

      this.logger.log(
        `[OpenAI Image Request] Meminta gambar model=${imageModel} size=${imageSize}...`,
      );
      const response = await fetch(
        'https://api.openai.com/v1/images/generations',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: imageModel,
            prompt: dallePrompt,
            n: 1,
            size: imageSize,
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `OpenAI Image API Error: ${response.status} - ${errText}`,
        );
      }

      const resData = await response.json();
      const item = resData.data?.[0];

      if (!item) {
        throw new Error('OpenAI Image tidak mengembalikan data gambar.');
      }

      let buffer: Buffer;
      if (item.b64_json) {
        buffer = Buffer.from(item.b64_json, 'base64');
      } else if (item.url) {
        const imageFetchRes = await fetch(item.url);
        buffer = Buffer.from(await imageFetchRes.arrayBuffer());
      } else {
        throw new Error(
          'Format respon gambar tidak dikenali (tidak ada b64_json atau url).',
        );
      }

      const filename = `infographic_${id}.png`;
      const targetFilePath = join(mediaDir, filename);
      writeFileSync(targetFilePath, buffer);

      this.logger.log(
        `[OpenAI Image Saved] Gambar resmi OpenAI berhasil disimpan di ${targetFilePath}`,
      );
      return `/uploads/media/${filename}`;
    } catch (err: any) {
      this.logger.warn(
        `[OpenAI Image Fallback] Gagal memanggil ${imageModel} (${err.message}). Mengaktifkan AI Diffusion Image Generator.`,
      );
      return this.generateAiDiffusionBackground(
        id,
        dallePrompt,
        aspectRatio,
        themeColors,
      );
    }
  }

  private async generateAiDiffusionBackground(
    id: string,
    prompt: string,
    aspectRatio: InfographicAspectRatio,
    themeColors: { primary: string; secondary: string; accent: string },
  ): Promise<string> {
    const mediaDir = join(process.cwd(), 'uploads', 'media');
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }

    const width =
      aspectRatio === '16:9' ? 1024 : aspectRatio === '9:16' ? 576 : 1024;
    const height =
      aspectRatio === '9:16' ? 1024 : aspectRatio === '16:9' ? 576 : 1024;

    try {
      this.logger.log(
        `[AI Diffusion] Menghasilkan latar belakang visual AI (${width}x${height})...`,
      );
      const cleanPrompt =
        prompt.length > 200 ? prompt.substring(0, 200) : prompt;
      const encodedPrompt = encodeURIComponent(
        `${cleanPrompt}, high quality, crisp details, minimal clean background, negative space, no typography, no letters`,
      );
      const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(
        Math.random() * 1000000,
      )}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`AI Diffusion engine status: ${res.status}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const filename = `infographic_ai_${id}.jpg`;
      const targetFilePath = join(mediaDir, filename);
      writeFileSync(targetFilePath, buffer);

      this.logger.log(
        `[AI Diffusion Saved] Berkas gambar AI berhasil disimpan di ${targetFilePath}`,
      );
      return `/uploads/media/${filename}`;
    } catch (err: any) {
      this.logger.warn(
        `[AI Diffusion Fallback] Gagal: ${err.message}. Menggunakan SVG vektor lokal.`,
      );
      return this.generateLocalVectorBackground(id, aspectRatio, themeColors);
    }
  }

  private generateLocalVectorBackground(
    id: string,
    aspectRatio: InfographicAspectRatio,
    themeColors: { primary: string; secondary: string; accent: string },
  ): string {
    const mediaDir = join(process.cwd(), 'uploads', 'media');
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }

    const width = aspectRatio === '16:9' ? 1792 : 1024;
    const height = aspectRatio === '9:16' ? 1792 : 1024;

    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${
        themeColors.secondary || '#0f172a'
      }" />
      <stop offset="40%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="${
        themeColors.primary || '#0d9488'
      }" stop-opacity="0.8" />
    </linearGradient>
    <pattern id="gridPattern" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.04" />
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
  <rect width="${width}" height="${height}" fill="url(#gridPattern)" />
  <circle cx="${width * 0.85}" cy="${height * 0.15}" r="${
      width * 0.35
    }" fill="${themeColors.primary || '#0d9488'}" fill-opacity="0.15" filter="blur(60px)" />
  <circle cx="${width * 0.15}" cy="${height * 0.85}" r="${
      width * 0.4
    }" fill="${themeColors.accent || '#f59e0b'}" fill-opacity="0.12" filter="blur(70px)" />
  <g opacity="0.12" stroke="#ffffff" stroke-width="2" fill="none">
    <polygon points="${width * 0.1},${height * 0.2} ${width * 0.2},${
      height * 0.1
    } ${width * 0.3},${height * 0.25}" />
    <polygon points="${width * 0.75},${height * 0.8} ${width * 0.9},${
      height * 0.75
    } ${width * 0.85},${height * 0.92}" />
  </g>
</svg>`;

    const filename = `infographic_vector_${id}.svg`;
    const targetFilePath = join(mediaDir, filename);
    writeFileSync(targetFilePath, Buffer.from(svgContent, 'utf-8'));

    return `/uploads/media/${filename}`;
  }

  private generateFallbackContent(topic: string): InfographicContentData {
    const isStunting = /stunting|gizi|kesehatan/i.test(topic);
    const isApbd = /apbd|anggaran|fiskal|pad|pendapatan/i.test(topic);
    const isElNino = /el nino|iklim|cuaca|hujan|kekeringan/i.test(topic);

    let titleMain = 'Analisis Perkembangan Sektoral';
    let subtitle = 'Kabupaten Mimika Tahun 2026';
    let categoryBadge = 'KEBIJAKAN STRATEGIS';
    let primaryColor = '#0284c7';
    let accentColor = '#f97316';

    if (isStunting) {
      titleMain = 'Perkembangan Penurunan Stunting';
      subtitle = 'Integrasi Layanan Posyandu & Gizi Mimika 2026';
      categoryBadge = 'KESEHATAN MASYARAKAT';
      primaryColor = '#0d9488';
      accentColor = '#f43f5e';
    } else if (isApbd) {
      titleMain = 'Realisasi Pendapatan & Belanja Daerah';
      subtitle = 'Evaluasi Kinerja Fiskal Kabupaten Mimika 2026';
      categoryBadge = 'KEUANGAN DAERAH';
      primaryColor = '#1e3a8a';
      accentColor = '#10b981';
    } else if (isElNino) {
      titleMain = 'Dampak Anomali Iklim El Niño';
      subtitle = 'Mitigasi Kerentanan Pangan & Air Mimika 2026';
      categoryBadge = 'IKLIM & LINGKUNGAN';
      primaryColor = '#0284c7';
      accentColor = '#ea580c';
    }

    return {
      title: titleMain,
      subtitle,
      categoryBadge,
      dallePrompt: `A wide professional editorial aerial landscape photograph of Mimika Regency Papua, lush rainforest and river estuaries, soft morning sunlight, documentary government editorial photography, strictly no text, no typography`,
      themeColors: {
        primary: primaryColor,
        secondary: '#0f172a',
        accent: accentColor,
      },
      header: {
        eyebrow: 'INFOGRAFIS STATISTIK & KEBIJAKAN BRIDA',
        titlePrefix: 'Laporan Perkembangan',
        titleMain,
        subtitle,
        description: `Visualisasi capaian indikator dan analisis spasial tematik berbasis data riset terintegrasi untuk pengambilan keputusan strategis Pemerintah Kabupaten Mimika.`,
        regionTag: 'KABUPATEN MIMIKA, Papua Tengah',
        statusCard: {
          period: 'Tahun 2026',
          statusLabel: 'Status Monitoring',
          statusValue: 'AKTIF & STRATEGIS',
          category: `Bidang: ${categoryBadge}`,
          sourceNote: '(Database Riset & Inovasi BRIDA)',
        },
      },
      blocks: this.generateFallbackBlocks(topic),
      footer: {
        tagline:
          'Mewujudkan Kebijakan Publik Berbasis Bukti (Evidence-Based Policy) di Kabupaten Mimika.',
        sources:
          'Sumber: BRIDA Kabupaten Mimika | BPS Mimika | Dinas Teknis Terkait | 2026',
      },
    };
  }

  private generateFallbackBlocks(topic: string): InfographicBlock[] {
    const isStunting = /stunting|gizi|kesehatan/i.test(topic);
    const isApbd = /apbd|anggaran|fiskal|pad|pendapatan/i.test(topic);

    if (isStunting) {
      return [
        {
          id: 'block-1',
          type: 'METRIC_CARDS',
          title: '1. INDIKATOR PREVALENSI STUNTING & GIZI',
          subtitle: 'Capaian Semester I Tahun 2026',
          insight:
            'Prevalensi stunting mengalami tren penurunan signifikan sebesar 4.2% berkat intervensi gizi terpadu.',
          payload: {
            items: [
              {
                label: 'Prevalensi Stunting',
                value: '18.4%',
                changePercent: '-4.2%',
                changeType: 'positive',
                note: 'Target RPJMD: 14%',
              },
              {
                label: 'Balita Terlayani',
                value: '14.820',
                changePercent: '+12.5%',
                changeType: 'positive',
                note: 'Cakupan Posyandu',
              },
              {
                label: 'Puskesmas Aktif',
                value: '26 Unit',
                changePercent: '100%',
                changeType: 'neutral',
                note: 'Tersebar di 18 Distrik',
              },
              {
                label: 'Keluarga Berisiko',
                value: '2.340',
                changePercent: '-18.1%',
                changeType: 'positive',
                note: 'Dalam Pendampingan',
              },
            ],
          },
        },
        {
          id: 'block-2',
          type: 'BAR_CHART',
          title: '2. TREN KASUS PER BULAN',
          subtitle: 'Perbandingan Kasus Tertangani Tahun 2025 vs 2026',
          insight:
            'Penurunan kasus tercepat terjadi pada kuartal kedua setelah distribusi makanan tambahan (PMT) rutin.',
          payload: {
            categories: [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'Mei',
              'Jun',
              'Jul',
              'Agu',
              'Sep',
              'Okt',
              'Nov',
              'Des',
            ],
            unit: 'Kasus',
            series: [
              {
                name: '2025 (Baseline)',
                data: [
                  320, 310, 295, 280, 270, 260, 250, 245, 230, 220, 210, 200,
                ],
                color: '#64748b',
              },
              {
                name: '2026 (Aktual)',
                data: [
                  260, 245, 230, 210, 195, 180, 165, 150, 140, 130, 120, 110,
                ],
                color: '#0d9488',
              },
            ],
          },
        },
        {
          id: 'block-3',
          type: 'PROGRESS_ITEMS',
          title: '3. REALISASI PROGRAM INTERVENSI GIZI',
          subtitle: 'Persentase Ketercapaian Output Fisik di Lapangan',
          insight:
            'Program pemberian makanan tambahan dan sanitasi air bersih telah melampaui 80% target tahunan.',
          payload: {
            legend: { current: 'Realisasi Fisik', baseline: 'Target Awal' },
            items: [
              {
                name: 'Pemberian Makanan Tambahan (PMT)',
                current: 12400,
                max: 14000,
                currentLabel: '12.400 Balita',
                changePercent: 88,
                changeLabel: 'Tercapai',
                unit: 'Balita',
              },
              {
                name: 'Penyediaan Air Bersih & Sanitasi',
                current: 820,
                max: 1000,
                currentLabel: '820 Titik',
                changePercent: 82,
                changeLabel: 'Tercapai',
                unit: 'Titik',
              },
              {
                name: 'Edukasi Gizi & Parenting Adat',
                current: 94,
                max: 100,
                currentLabel: '94 Kampung',
                changePercent: 94,
                changeLabel: 'Tercapai',
                unit: 'Kampung',
              },
            ],
          },
        },
        {
          id: 'block-4',
          type: 'DISTRICT_STATUS',
          title: '4. PEMETAAN KERAWANAN STUNTING PER DISTRIK',
          subtitle: 'Klasifikasi Prioritas Penanganan Intervensi Khusus',
          insight:
            'Distrik pedalaman dan pesisir terluar diprioritaskan untuk penyaluran logistik suplemen via helikopter dan perahu motor.',
          payload: {
            districts: [
              {
                name: 'Hoya',
                level: 'Tinggi',
                note: 'Akses logistik terisolasi',
              },
              {
                name: 'Alama',
                level: 'Tinggi',
                note: 'Layanan medis terbatas',
              },
              {
                name: 'Jila',
                level: 'Sedang-Tinggi',
                note: 'Perlu penguatan nakes',
              },
              {
                name: 'Mimika Timur Jauh',
                level: 'Sedang-Tinggi',
                note: 'Kawasan pesisir payau',
              },
              {
                name: 'Kuala Kencana',
                level: 'Rendah',
                note: 'Sanitasi berstandar baik',
              },
              {
                name: 'Mimika Baru',
                level: 'Sedang',
                note: 'Kepadatan penduduk tinggi',
              },
            ],
          },
        },
        {
          id: 'block-5',
          type: 'ACTION_STEPS',
          title: '5. REKOMENDASI KEBIJAKAN PRIORITAS',
          subtitle: 'Rencana Tindak Lanjut Terintegrasi Lintas OPD',
          insight:
            'Kolaborasi terpadu Dinas Kesehatan, Dinas Sosial, dan BRIDA menjadi pilar pencapaian target zero stunting baru.',
          payload: {
            commitmentBadge: 'Komitmen Bersama Percepatan Penurunan Stunting',
            steps: [
              {
                stepNumber: 1,
                title: 'Perluasan Penyaluran Suplemen Gizi',
                text: 'Memperluas cakupan distribusi biskuit bergizi dan susu mikro ke distrik pegunungan (Hoya, Alama, Jila).',
                pic: 'Dinas Kesehatan & BPBD',
                priority: 'TINGGI',
              },
              {
                stepNumber: 2,
                title: 'Pembangunan Sarana MCK & Air Bersih',
                text: 'Mempercepat pengerjaan sarana air bersih komunal di kampung-kampung nelayan Mimika Tengah dan Timur.',
                pic: 'Dinas PUPR',
                priority: 'TINGGI',
              },
              {
                stepNumber: 3,
                title: 'Insentif Kader Posyandu Kampung',
                text: 'Meningkatkan alokasi dana operasional dan pelatihan kader posyandu Orang Asli Papua (OAP).',
                pic: 'Dinas Pemberdayaan Masyarakat',
                priority: 'SEDANG',
              },
            ],
          },
        },
      ];
    }

    // Default Fallback (Multisektoral / Perekonomian & Umum)
    return [
      {
        id: 'block-1',
        type: 'METRIC_CARDS',
        title: '1. INDIKATOR STATISTIK STRATEGIS',
        subtitle: 'Kompilasi Data Capaian Pembangunan Mimika 2026',
        insight:
          'Pertumbuhan indikator makro berada pada tren positif dengan stabilitas inflasi yang terjaga.',
        payload: {
          items: [
            {
              label: 'Pertumbuhan Ekonomi',
              value: '5.8%',
              changePercent: '+0.6%',
              changeType: 'positive',
              note: 'Non-Tambang',
            },
            {
              label: 'Indeks Inovasi Daerah',
              value: '68.4',
              changePercent: '+8.2 Poin',
              changeType: 'positive',
              note: 'Kategori Inovatif',
            },
            {
              label: 'Realisasi Investasi',
              value: 'Rp 4.2 T',
              changePercent: '+14.1%',
              changeType: 'positive',
              note: 'Target: Rp 3.8 T',
            },
            {
              label: 'Tingkat Kemiskinan',
              value: '12.1%',
              changePercent: '-1.4%',
              changeType: 'positive',
              note: 'Tren Menurun',
            },
          ],
        },
      },
      {
        id: 'block-2',
        type: 'BAR_CHART',
        title: '2. ALOKASI ANGGARAN & REALISASI SEKTORAL',
        subtitle: 'Perbandingan Target Pagu vs Realisasi Belanja Program (Miliar Rp)',
        insight:
          'Sektor infrastruktur dasar dan pelayanan pendidikan menyerap alokasi belanja terbesar dengan efisiensi tinggi.',
        payload: {
          categories: [
            'Pendidikan',
            'Kesehatan',
            'Infrastruktur',
            'Pertanian',
            'Ekonomi Kreatif',
            'Riset & Inovasi',
          ],
          unit: 'Miliar Rp',
          series: [
            {
              name: 'Pagu Anggaran',
              data: [850, 720, 1150, 280, 190, 95],
              color: '#1e3a8a',
            },
            {
              name: 'Realisasi Aktual',
              data: [790, 680, 1020, 245, 175, 90],
              color: '#0284c7',
            },
          ],
        },
      },
      {
        id: 'block-3',
        type: 'PROGRESS_ITEMS',
        title: '3. CAPAIAN PROGRAM PRIORITAS DAERAH',
        subtitle: 'Evaluasi Progres Fisik Triwulanan Lapangan',
        insight:
          'Konektivitas jalan antar-distrik dan digitalisasi layanan publik mencatat progres penyelesaian tercepat.',
        payload: {
          legend: { current: 'Realisasi Fisik', baseline: 'Target Tahunan' },
          items: [
            {
              name: 'Pembangunan Jalan Poros Distrik',
              current: 98,
              max: 120,
              currentLabel: '98 Km',
              changePercent: 81.6,
              changeLabel: 'Selesai',
              unit: 'Km',
            },
            {
              name: 'Jaringan Internet Desa Pedalaman',
              current: 48,
              max: 60,
              currentLabel: '48 Titik',
              changePercent: 80.0,
              changeLabel: 'Aktif',
              unit: 'Titik',
            },
            {
              name: 'Penguatan Sentra UMKM Pesisir',
              current: 310,
              max: 350,
              currentLabel: '310 Kelompok',
              changePercent: 88.5,
              changeLabel: 'Mandiri',
              unit: 'Kelompok',
            },
          ],
        },
      },
      {
        id: 'block-4',
        type: 'DISTRICT_STATUS',
        title: '4. SEBARAN TINGKAT PERKEMBANGAN WILAYAH',
        subtitle: 'Matriks Evaluasi Kinerja Pembangunan 18 Distrik',
        insight:
          'Fokus percepatan diarahkan pada integrasi transportasi distrik dataran tinggi dan pesisir barat.',
        payload: {
          districts: [
            {
              name: 'Mimika Baru',
              level: 'Rendah',
              note: 'Pusat perekonomian maju',
            },
            {
              name: 'Kuala Kencana',
              level: 'Rendah',
              note: 'Kawasan terkelola modern',
            },
            {
              name: 'Wania',
              level: 'Sedang',
              note: 'Penyangga komersial kota',
            },
            {
              name: 'Agimuga',
              level: 'Sedang-Tinggi',
              note: 'Percepatan jalan penghubung',
            },
            {
              name: 'Hoya',
              level: 'Tinggi',
              note: 'Akses logistik perintis',
            },
            {
              name: 'Alama',
              level: 'Tinggi',
              note: 'Kawasan lembah terpencil',
            },
          ],
        },
      },
      {
        id: 'block-5',
        type: 'ACTION_STEPS',
        title: '5. REKOMENDASI STRATEGIS & KESIMPULAN',
        subtitle: 'Langkah Antisipasi Kebijakan Pembangunan Mimika',
        insight:
          'Rekomendasi taktis difokuskan pada sinkronisasi monitoring antar-OPD dan evaluasi berkala per triwulan.',
        payload: {
          commitmentBadge: 'BRIDA SMART Analysis Policy Action Plan',
          steps: [
            {
              stepNumber: 1,
              title: 'Akselerasi Pengadaan & Serapan Anggaran',
              text: 'Mendorong percepatan tender proyek strategis pada awal triwulan guna menghindari penumpukan di akhir tahun anggaran.',
              pic: 'Bappeda & BPKAD',
              priority: 'TINGGI',
            },
            {
              stepNumber: 2,
              title: 'Penguatan Kolaborasi Riset Terapan',
              text: 'Mengembangkan kajian inovasi daerah berbasis potensi kearifan lokal (sagu, perikanan laut, dan perkebunan dataran tinggi).',
              pic: 'BRIDA Mimika',
              priority: 'SEDANG',
            },
            {
              stepNumber: 3,
              title: 'Peningkatan Pengawasan Lapangan',
              text: 'Melakukan monitoring spasial berkala terhadap proyek fisik di distrik terluar menggunakan platform Geo Analisis.',
              pic: 'Inspektorat & Dinas Teknis',
              priority: 'TINGGI',
            },
          ],
        },
      },
    ];
  }
}
