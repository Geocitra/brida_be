import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmbeddingProvider } from '../interfaces/embedding-provider.interface';

@Injectable()
export class ExternalEmbeddingAdapter implements IEmbeddingProvider {
  private readonly logger = new Logger(ExternalEmbeddingAdapter.name);
  
  // Dimensi vektor baku (kompatibel dengan schema pgvector & embedding-3-small)
  private readonly dimension = 768;

  constructor(private readonly configService: ConfigService) {}

  getVectorDimension(): number {
    return this.dimension;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const openAiKey = this.configService.get<string>('OPENAI_API_KEY');
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');

    // 1. Prioritas Utama: OpenAI Embeddings (Menggunakan OPENAI_API_KEY tunggal)
    if (openAiKey && openAiKey.trim().length > 0) {
      try {
        return await this.callRealOpenAiEmbeddingApi(openAiKey, texts);
      } catch (err: any) {
        this.logger.warn(
          `[OpenAI Embedding Error]: ${err.message}. Mencoba fallback...`,
        );
      }
    }

    // 2. Opsi Sekunder: Gemini Embeddings (jika ada)
    if (geminiKey && geminiKey.trim().length > 0) {
      try {
        return await this.callRealGeminiEmbeddingApi(geminiKey, texts);
      } catch (err: any) {
        this.logger.warn(`[Gemini Embedding Error]: ${err.message}.`);
      }
    }

    // 3. Fallback Deterministik jika koneksi eksternal terputus
    return texts.map((text, idx) => this.generateDeterministicVector(text, idx));
  }

  /**
   * Menghasilkan embedding semantik berdimensi 768 via OpenAI API
   */
  private async callRealOpenAiEmbeddingApi(apiKey: string, texts: string[]): Promise<number[][]> {
    const model = this.configService.get<string>('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';
    const url = 'https://api.openai.com/v1/embeddings';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
        dimensions: this.dimension, // Mengunci dimensi pada 768 agar pas dengan tabel DB
      }),
    });

    const data = await response.json();

    if (!response.ok || !data?.data) {
      throw new Error(data?.error?.message || 'Gagal memanggil OpenAI Embedding API.');
    }

    // Mengurutkan kembali vektor sesuai urutan input teks
    const sortedVectors = data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((item: any) => item.embedding);

    return sortedVectors;
  }

  private async callRealGeminiEmbeddingApi(apiKey: string, texts: string[]): Promise<number[][]> {
    const model = 'text-embedding-004';
    const embedSingle = async (text: string): Promise<number[]> => {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:embedContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      const data = await response.json();
      if (!response.ok || !data?.embedding?.values) {
        throw new Error(data?.error?.message || 'Gemini embedding error.');
      }
      return data.embedding.values.slice(0, this.dimension);
    };

    return Promise.all(texts.map((t) => embedSingle(t)));
  }

  private generateDeterministicVector(text: string, seedOffset: number): number[] {
    const vector: number[] = [];
    let hash = seedOffset + 1;

    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }

    for (let d = 0; d < this.dimension; d++) {
      const val = Math.sin(hash + d * 0.1);
      vector.push(parseFloat(val.toFixed(6)));
    }

    return vector;
  }
}
