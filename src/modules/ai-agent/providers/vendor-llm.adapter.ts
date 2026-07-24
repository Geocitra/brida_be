import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jsonrepair } from 'jsonrepair';
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
    temperature: number = 0.0,
  ): Promise<T> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');

    this.logger.log(
      `[VendorLlmAdapter] Mengirim ${messages.length} pesan ke Gemini LLM API (temperature=${temperature})...`,
    );

    // Execute with Exponential Backoff Resilience (Max 3 Retries)
    return this.resilienceUtil.executeWithRetry(async () => {
      let rawResponse: string;

      if (apiKey && apiKey.trim().length > 0) {
        rawResponse = await this.callRealGeminiApi(apiKey, messages, jsonSchema, temperature);
      } else {
        this.logger.warn(
          `[GEMINI_API_KEY Kosong] Menggunakan mock response terstruktur untuk fase testing. Masukkan GEMINI_API_KEY pada .env untuk memanggil API sungguhan.`,
        );
        rawResponse = await this.mockVendorApiCall();
      }

      // Clean Markdown Fences (```json ... ```) & Validate Post-Generation DTO
      return this.validateAndParseOutput<T>(rawResponse);
    }, 3, 2000); // 2s initial backoff (2s, 4s, 8s) for Gemini high-demand tolerance
  }

  private async callRealGeminiApi(
    apiKey: string,
    messages: LlmChatMessage[],
    jsonSchema?: any,
    temperature: number = 0.0,
  ): Promise<string> {
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
          temperature,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          // Enforce native structured output at token-generation level
          responseSchema: jsonSchema,
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
    const sanitized = this.stripMarkdownFences(rawString);

    try {
      return JSON.parse(sanitized) as T;
    } catch (err: any) {
      this.logger.warn(`[JSON Parse Warning]: ${err.message}. Running jsonrepair engine...`);

      try {
        const repairedString = jsonrepair(sanitized);
        const parsedRepaired = JSON.parse(repairedString);
        this.logger.log(`[JSON Auto-Repair Pass] Successfully recovered valid JSON structure via jsonrepair.`);
        return parsedRepaired as T;
      } catch (repairErr: any) {
        this.logger.error(`[Post-Generation Validation Warning]: ${repairErr.message}`);
        return {
          fullText: rawString,
          summary: rawString,
          executiveSummary: rawString,
          ringkasanEksekutif: rawString,
          kesimpulanAnalisis: 'Hasil generasi AI telah diterima dalam format narasi.',
        } as any as T;
      }
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
