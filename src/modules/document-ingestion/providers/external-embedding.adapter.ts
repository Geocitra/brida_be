import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmbeddingProvider } from '../interfaces/embedding-provider.interface';

@Injectable()
export class ExternalEmbeddingAdapter implements IEmbeddingProvider {
  private readonly logger = new Logger(ExternalEmbeddingAdapter.name);
  private readonly dimension = 768; // 768-dimensional float vectors

  constructor(private readonly configService: ConfigService) {}

  getVectorDimension(): number {
    return this.dimension;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');

    if (apiKey && apiKey.trim().length > 0) {
      try {
        return await this.callRealGeminiEmbeddingApi(apiKey, texts);
      } catch (err: any) {
        this.logger.warn(
          `[Gemini Embedding API Error]: ${err.message}. Menggunakan fallback vector generator.`,
        );
      }
    }

    // Deterministic mock fallback vector generator for dev testing
    return texts.map((text, idx) => this.generateDeterministicVector(text, idx));
  }

  private async callRealGeminiEmbeddingApi(apiKey: string, texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`;

    const requests = texts.map((t) => ({
      model: 'models/text-embedding-004',
      content: { parts: [{ text: t }] },
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    const data = await response.json();
    if (!response.ok || !data.embeddings) {
      throw new Error(data?.error?.message || 'Gagal menghasilkan embeddings via Gemini.');
    }

    return data.embeddings.map((item: any) => item.values);
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
