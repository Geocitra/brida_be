import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ILlmProvider } from '../interfaces/llm-provider.interface';
import { LlmChatMessage } from '../utils/prompt-assembly.builder';
import { NetworkResilienceUtil } from '../utils/network-resilience.util';
import { AnalysisResponseDto } from '../schemas/analysis-response.dto';

@Injectable()
export class VendorLlmAdapter implements ILlmProvider {
  private readonly logger = new Logger(VendorLlmAdapter.name);

  constructor(
    private readonly resilienceUtil: NetworkResilienceUtil,
    private readonly configService: ConfigService,
  ) {}

  getProviderName(): string {
    const model = this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-flash';
    return `GoogleGeminiAdapter (${model})`;
  }

  async generateStructuredAnalysis<T = AnalysisResponseDto>(
    messages: LlmChatMessage[],
    jsonSchema: any,
  ): Promise<T> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');

    this.logger.log(
      `[VendorLlmAdapter] Mengirim ${messages.length} pesan ke Gemini LLM API (temperature=0.0)...`,
    );

    // Execute with Exponential Backoff Resilience (Max 3 Retries)
    return this.resilienceUtil.executeWithRetry(async () => {
      let rawResponse: string;

      if (apiKey && apiKey.trim().length > 0) {
        rawResponse = await this.callRealGeminiApi(apiKey, messages);
      } else {
        this.logger.warn(
          `[GEMINI_API_KEY Kosong] Menggunakan mock response terstruktur untuk fase testing. Masukkan GEMINI_API_KEY pada .env untuk memanggil API sungguhan.`,
        );
        rawResponse = await this.mockVendorApiCall();
      }

      // Clean Markdown Fences (```json ... ```) & Validate Post-Generation DTO
      return this.validateAndParseOutput<T>(rawResponse);
    }, 3, 1000);
  }

  private async callRealGeminiApi(apiKey: string, messages: LlmChatMessage[]): Promise<string> {
    const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    // Convert messages to Gemini contents format
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.0,
          responseMimeType: 'application/json',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data?.error?.message || 'Gagal memanggil API Google Gemini.';
      throw new Error(`[Gemini API Error]: ${errorMsg}`);
    }

    const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOutput) {
      throw new Error('API Gemini mengembalikan respons kosong.');
    }

    return textOutput;
  }

  private async mockVendorApiCall(): Promise<string> {
    const mockResult: AnalysisResponseDto = {
      ringkasanEksekutif:
        'Berdasarkan dokumen laporan statis yang dianalisis, ditemukan indikasi awal penyimpangan prosedur pengadaan barang dan jasa pada proyek pembangunan infrastruktur daerah.',
      entitasTerlibat: [
        {
          nama: 'Drs. Supriyanto, M.Si',
          peran: 'Pejabat Pembuat Komitmen (PPK)',
          entitasTerkait: 'Dinas Pekerjaan Umum Daerah',
        },
        {
          nama: 'PT Karya Sentosa Jaya',
          peran: 'Kontraktor Pelaksana Utama',
          entitasTerkait: 'Penyedia Jasa Swasta',
        },
      ],
      kronologiPeristiwa: [
        {
          tanggal: '15 Maret 2024',
          deskripsi: 'Penetapan pemenang tender proyek infrastruktur tanpa melalui proses pencairan jaminan penawaran.',
          lokasi: 'Kabupaten BRIDA',
        },
        {
          tanggal: '02 April 2024',
          deskripsi: 'Pencairan dana termin pertama sebesar 30% tanpa adanya laporan verifikasi fisik lapangan.',
        },
      ],
      indikasiPelanggaran: [
        {
          jenis: 'Dugaan Perbuatan Melawan Hukum & Penyalahgunaan Wewenang',
          pasalDugaan: 'Pasal 2 dan Pasal 3 UU No. 31 Tahun 1999 jo. UU No. 20 Tahun 2001',
          rincian: 'Penyalur dana termin tidak sesuai dengan persentase realisasi fisik pekerjaan di lapangan.',
        },
      ],
      kesimpulanAnalisis:
        'Dokumen laporan menunjukkan bukti awal yang cukup kuat terkait ketidaksesuaian prosedur administratif dan indikasi kerugian keuangan daerah. Direkomendasikan untuk dilakukan audit investigatif lanjutan.',
    };

    return `\`\`\`json\n${JSON.stringify(mockResult, null, 2)}\n\`\`\``;
  }

  private validateAndParseOutput<T>(rawString: string): T {
    try {
      const sanitizedJsonString = this.stripMarkdownFences(rawString);
      const parsed = JSON.parse(sanitizedJsonString);

      if (!parsed || typeof parsed !== 'object') {
        throw new UnprocessableEntityException('Output LLM bukan objek JSON yang valid.');
      }

      if (
        !parsed.ringkasanEksekutif ||
        !Array.isArray(parsed.entitasTerlibat) ||
        !Array.isArray(parsed.kronologiPeristiwa) ||
        !Array.isArray(parsed.indikasiPelanggaran) ||
        !parsed.kesimpulanAnalisis
      ) {
        throw new UnprocessableEntityException(
          'Output LLM tidak memenuhi skema DTO AnalysisResponseDto yang diwajibkan.',
        );
      }

      this.logger.log(`[Defensive Validation Pass] Output JSON LLM berhasil dibersihkan dari markdown dan lolos uji DTO.`);
      return parsed as T;
    } catch (err: any) {
      this.logger.error(`[Post-Generation Validation Failed]: ${err.message}`);
      throw new UnprocessableEntityException(`Gagal memverifikasi respons JSON dari LLM: ${err.message}`);
    }
  }

  private stripMarkdownFences(rawText: string): string {
    if (!rawText) return '';
    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/i, '');
    return cleaned.trim();
  }
}
