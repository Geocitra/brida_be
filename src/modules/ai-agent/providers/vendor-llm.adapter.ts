import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jsonrepair } from 'jsonrepair';
import { ILlmProvider } from '../interfaces/llm-provider.interface';
import { LlmChatMessage } from '../utils/prompt-assembly.builder';
import { NetworkResilienceUtil } from '../utils/network-resilience.util';
import { AnalysisResponseDto } from '../schemas/analysis-response.dto';

// Ekstensi Interface Polimorfis khusus untuk mendukung data biner/Base64 Multimodal
export interface MultimodalChatMessage extends LlmChatMessage {
  parts?: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string; // String Base64 berkas visual (JPEG/PNG) atau transien
    };
  }>;
}

// ============================================================
// PENDEKATAN 1: Google Gemini (via generativelanguage.googleapis.com)
// PENDEKATAN 2: OpenAI ChatGPT (via api.openai.com)
//
// Kontrol provider aktif via env: LLM_PROVIDER=gemini|openai
// Default fallback: gemini
// ============================================================

@Injectable()
export class VendorLlmAdapter implements ILlmProvider {
  private readonly logger = new Logger(VendorLlmAdapter.name);

  constructor(
    private readonly resilienceUtil: NetworkResilienceUtil,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Mengembalikan nama provider LLM aktif berdasarkan konfigurasi LLM_PROVIDER.
   * Pendekatan 1 → Google Gemini | Pendekatan 2 → OpenAI ChatGPT
   */
  getProviderName(): string {
    const provider = this.getActiveProvider();

    if (provider === 'openai') {
      const model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
      return `OpenAiChatGptAdapter (${model})`;
    }

    // Default: Gemini
    const model = this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-flash';
    return `GoogleGeminiAdapter (${model})`;
  }

  /**
   * Mengeksekusi generasi teks terstruktur berbasis JSON Schema dengan penanganan kebal-gagal (resilience).
   * Otomatis memilih implementasi provider berdasarkan env LLM_PROVIDER.
   */
  async generateStructuredAnalysis<T = AnalysisResponseDto>(
    messages: MultimodalChatMessage[],
    jsonSchema: any,
    temperature: number = 0.0,
  ): Promise<T> {
    const provider = this.getActiveProvider();

    this.logger.log(
      `[VendorLlmAdapter] Provider aktif: ${provider.toUpperCase()} | Mengirim ${messages.length} pesan (temperature=${temperature})...`,
    );

    // Mengeksekusi dengan Exponential Backoff Resilience (Maksimal 3 Kali Percobaan)
    return this.resilienceUtil.executeWithRetry(async () => {
      let rawResponse: string;

      if (provider === 'openai') {
        // ── PENDEKATAN 2: OpenAI ChatGPT ─────────────────────────────────
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        if (!apiKey || apiKey.trim().length === 0) {
          this.logger.warn('[OPENAI_API_KEY Kosong] Jatuh ke mock response. Set OPENAI_API_KEY pada .env.');
          rawResponse = await this.mockVendorApiCall();
        } else {
          rawResponse = await this.callRealOpenAiApi(apiKey, messages, jsonSchema, temperature);
        }
      } else {
        // ── PENDEKATAN 1: Google Gemini (Default) ────────────────────────
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (!apiKey || apiKey.trim().length === 0) {
          this.logger.warn('[GEMINI_API_KEY Kosong] Jatuh ke mock response. Set GEMINI_API_KEY pada .env.');
          rawResponse = await this.mockVendorApiCall();
        } else {
          rawResponse = await this.callRealGeminiApi(apiKey, messages, jsonSchema, temperature);
        }
      }

      // Bersihkan pagar Markdown (```json ... ```) & Validasi Hasil
      return this.validateAndParseOutput<T>(rawResponse);
    }, 3, 2000); // Backoff awal 2s (2s, 4s, 8s)
  }

  // ================================================================
  //  PENDEKATAN 1 — GOOGLE GEMINI IMPLEMENTATION
  // ================================================================

  /**
   * Memanggil API Google Gemini Resmi dengan format payload Multimodal terpadu.
   * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
   */
  private async callRealGeminiApi(
    apiKey: string,
    messages: MultimodalChatMessage[],
    jsonSchema?: any,
    temperature: number = 0.0,
  ): Promise<string> {
    const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    // Konversi pesan: Dukung parts multimodal jika tersedia, fallback ke teks biasa
    const contents = messages
      .filter((m) => m.role !== 'system') // Gemini tidak punya role 'system' di contents
      .map((m) => {
        const role = m.role === 'assistant' ? 'model' : 'user';

        if (m.parts && m.parts.length > 0) {
          return { role, parts: m.parts };
        }

        return { role, parts: [{ text: m.content }] };
      });

    // Gemini mendukung system instruction terpisah (systemInstruction field)
    const systemMsg = messages.find((m) => m.role === 'system');
    const systemInstruction = systemMsg
      ? { parts: [{ text: systemMsg.content }] }
      : undefined;

    // Sanitasi JSON Schema untuk mencegah penolakan API struktural Gemini
    let cleanedSchema = undefined;
    if (jsonSchema) {
      try {
        cleanedSchema = JSON.parse(JSON.stringify(jsonSchema));
        const sanitizeSchema = (obj: any) => {
          if (obj && typeof obj === 'object') {
            if ('additionalProperties' in obj) {
              delete obj.additionalProperties;
            }
            for (const key of Object.keys(obj)) {
              sanitizeSchema(obj[key]);
            }
          }
        };
        sanitizeSchema(cleanedSchema);
      } catch (err) {
        cleanedSchema = jsonSchema;
      }
    }

    const requestBody: any = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: cleanedSchema,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    this.logger.log(`[Gemini] Mengirim request ke model: ${modelName}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
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

    this.logger.log(`[Gemini] Response diterima (${textOutput.length} karakter).`);
    return textOutput;
  }

  // ================================================================
  //  PENDEKATAN 2 — OPENAI CHATGPT IMPLEMENTATION
  // ================================================================

  /**
   * Memanggil API OpenAI ChatGPT resmi menggunakan format Chat Completions.
   * Endpoint: https://api.openai.com/v1/chat/completions
   *
   * Fitur utama:
   * - Mendukung JSON Mode (response_format: json_object) untuk output terstruktur
   * - Mendukung multi-turn conversation (system + user + assistant messages)
   * - Temperature & max_tokens dapat dikonfigurasi via parameter
   */
  private async callRealOpenAiApi(
    apiKey: string,
    messages: MultimodalChatMessage[],
    jsonSchema?: any,
    temperature: number = 0.0,
  ): Promise<string> {
    const modelName = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    const url = 'https://api.openai.com/v1/chat/completions';

    // Konversi pesan ke format OpenAI (role: system | user | assistant)
    // Mendukung input teks biasa dan input biner multimodal (gambar + teks) secara penuh
    const openAiMessages: any[] = messages.map((m) => {
      const role = m.role as 'system' | 'user' | 'assistant';

      if (m.parts && m.parts.length > 0) {
        const contentArray = m.parts.map((part) => {
          if (part.inlineData) {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
              },
            };
          }
          return {
            type: 'text',
            text: part.text || '',
          };
        });

        return {
          role,
          content: contentArray,
        };
      }

      return {
        role,
        content: m.content || '',
      };
    });

    // OpenAI JSON Mode: instruksikan model untuk selalu menghasilkan JSON valid
    // Catatan: OpenAI memerlukan kata "json" dalam system prompt jika json_object mode aktif
    if (jsonSchema) {
      const systemMsgIndex = openAiMessages.findIndex((m) => m.role === 'system');
      const jsonInstruction = [
        '\n\n[FORMAT OUTPUT — WAJIB DIIKUTI]',
        'Kembalikan output HANYA dalam format JSON valid sesuai schema.',
        'PENTING: Nilai dari field string (terutama "answer", "fullText", "draftMarkdown") WAJIB menggunakan format Markdown yang kaya dan terstruktur:',
        '  - Gunakan ## untuk subjudul, **teks** untuk bold, - untuk bullet list',
        '  - Gunakan tabel Markdown jika membandingkan data',
        '  - Sertakan token sitasi [docId:chunkIndex] di sebelah klaim faktual',
        '  - Jangan mengembalikan teks polos/plain tanpa formatting',
        'Output harus berupa JSON object tunggal, tanpa teks apapun di luar kurung kurawal {}.',
      ].join('\n');

      if (systemMsgIndex >= 0) {
        openAiMessages[systemMsgIndex].content += jsonInstruction;
      } else {
        openAiMessages.unshift({
          role: 'system',
          content: `Anda adalah asisten AI BRIDA yang menghasilkan output JSON dengan konten Markdown kaya.${jsonInstruction}`,
        });
      }
    }

    const requestBody: any = {
      model: modelName,
      messages: openAiMessages,
      temperature,
      max_completion_tokens: 8192,
    };

    // Aktifkan JSON Mode / Structured Outputs jika ada jsonSchema
    if (jsonSchema) {
      try {
        const openAiSchema = JSON.parse(JSON.stringify(jsonSchema));
        delete openAiSchema.$schema;
        delete openAiSchema.title;

        // OpenAI Structured Outputs strict mode requirements:
        // 1. additionalProperties: false on all object schemas
        // 2. all properties listed in required list
        const makeStrictSchema = (schema: any) => {
          if (schema && typeof schema === 'object') {
            if (schema.type === 'object') {
              schema.additionalProperties = false;
              if (schema.properties) {
                schema.required = Object.keys(schema.properties);
                for (const key of Object.keys(schema.properties)) {
                  makeStrictSchema(schema.properties[key]);
                }
              }
            } else if (schema.type === 'array' && schema.items) {
              makeStrictSchema(schema.items);
            }
          }
        };

        makeStrictSchema(openAiSchema);

        requestBody.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'brida_analysis_response',
            strict: true,
            schema: openAiSchema,
          },
        };
        this.logger.log(`[OpenAI] Mengaktifkan Structured Outputs (json_schema) untuk kepatuhan skema.`);
      } catch (err: any) {
        this.logger.warn(`[OpenAI Schema Conv Failed] Gagal konversi ke strict schema: ${err.message}. Fallback ke json_object.`);
        requestBody.response_format = { type: 'json_object' };
      }
    }

    this.logger.log(`[OpenAI] Mengirim request ke model: ${modelName} | JSON Mode: ${jsonSchema ? 'ON' : 'OFF'}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || 'Gagal memanggil API OpenAI.';
      const errorCode = data?.error?.code || response.status;
      this.logger.error(`[OpenAI API Error ${errorCode}]: ${errorMsg}`);
      throw new Error(`[OpenAI API Error ${errorCode}]: ${errorMsg}`);
    }

    const textOutput = data?.choices?.[0]?.message?.content;
    if (!textOutput) {
      throw new Error('API OpenAI mengembalikan respons kosong.');
    }

    const usage = data?.usage;
    if (usage) {
      this.logger.log(
        `[OpenAI] Response diterima | Prompt tokens: ${usage.prompt_tokens} | Completion tokens: ${usage.completion_tokens} | Total: ${usage.total_tokens}`,
      );
    }

    return textOutput;
  }

  // ================================================================
  //  SHARED UTILITIES
  // ================================================================

  /**
   * Membaca provider aktif dari env LLM_PROVIDER.
   * Nilai valid: 'gemini' | 'openai'. Default: 'gemini'.
   */
  private getActiveProvider(): 'gemini' | 'openai' {
    const raw = this.configService.get<string>('LLM_PROVIDER') || 'gemini';
    const normalized = raw.trim().toLowerCase();

    if (normalized === 'openai') return 'openai';
    return 'gemini'; // Default aman ke Gemini
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
          rincian: 'Penyaluran dana termin tidak sesuai dengan persentase realisasi fisik pekerjaan di lapangan.',
        },
      ],
      kesimpulanAnalisis:
        'Dokumen laporan menunjukkan bukti awal yang cukup kuat terkait ketidaksesuaian prosedur administratif dan indikasi kerugian keuangan daerah. Direkomendasikan untuk dilakukan audit investigatif lanjutan.',
    };

    return `\`\`\`json\n${JSON.stringify(mockResult, null, 2)}\n\`\`\``;
  }

  /**
   * Validasi akhir dan pemulihan parsing JSON menggunakan jsonrepair jika terjadi anomali sintaks
   */
  private validateAndParseOutput<T>(rawString: string): T {
    const sanitized = this.stripMarkdownFences(rawString);

    try {
      return JSON.parse(sanitized) as T;
    } catch (err: any) {
      this.logger.warn(`[JSON Parse Warning]: ${err.message}. Running jsonrepair engine...`);

      try {
        const repairedString = jsonrepair(sanitized);
        const parsedRepaired = JSON.parse(repairedString);
        this.logger.log(`[JSON Auto-Repair Pass] Berhasil memulihkan struktur JSON menggunakan jsonrepair.`);
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