import { Injectable, Logger } from '@nestjs/common';
import { ChunkData } from '../interfaces/chunk-data.interface';

@Injectable()
export class SemanticChunkerService {
  private readonly logger = new Logger(SemanticChunkerService.name);

  // Target size in characters (approx 500-600 tokens / 2000 chars)
  private readonly targetChunkSize = parseInt(process.env.CHUNK_TARGET_SIZE || '2000', 10);

  // Overlap percentage (10% to 15%)
  private readonly overlapPercentage = parseFloat(process.env.CHUNK_OVERLAP_PERCENTAGE || '0.12');

  createSemanticChunks(sanitizedText: string): ChunkData[] {
    if (!sanitizedText || sanitizedText.trim().length === 0) {
      return [];
    }

    // 1. First-Pass: Split by paragraph boundaries
    const rawParagraphs = sanitizedText.split(/\n\s*\n/);
    
    // 2. Sentence-Level Fallback: Handle giant legal/investigation paragraphs exceeding targetChunkSize
    const normalizedParagraphs: string[] = [];
    for (const paragraph of rawParagraphs) {
      const cleanPara = paragraph.trim();
      if (!cleanPara) continue;

      if (cleanPara.length > this.targetChunkSize) {
        // Fallback to sentence boundaries (. , ? , ! , ;\n)
        const sentenceSubChunks = this.splitHugeParagraphBySentences(cleanPara);
        normalizedParagraphs.push(...sentenceSubChunks);
      } else {
        normalizedParagraphs.push(cleanPara);
      }
    }

    const chunks: ChunkData[] = [];
    let currentChunkText = '';
    let chunkIndex = 0;
    let currentOffset = 0;
    let previousOverlapText = '';

    for (const textUnit of normalizedParagraphs) {
      if ((currentChunkText + '\n\n' + textUnit).length > this.targetChunkSize) {
        if (currentChunkText.length > 0) {
          const startCharIndex = currentOffset;
          const endCharIndex = currentOffset + currentChunkText.length;

          const overlapLength = Math.floor(currentChunkText.length * this.overlapPercentage);
          previousOverlapText = currentChunkText.slice(-overlapLength);

          chunks.push({
            chunkIndex: chunkIndex++,
            rawText: currentChunkText.trim(),
            tokenCount: this.estimateTokenCount(currentChunkText),
            spatialMetadata: {
              startCharIndex,
              endCharIndex,
              overlapWithPrevious: chunks.length > 0,
            },
            overlapText: chunks.length > 0 ? previousOverlapText : undefined,
          });

          currentOffset = endCharIndex;
          currentChunkText = previousOverlapText + '\n\n' + textUnit;
        } else {
          currentChunkText = textUnit;
        }
      } else {
        currentChunkText = currentChunkText
          ? `${currentChunkText}\n\n${textUnit}`
          : textUnit;
      }
    }

    if (currentChunkText.trim().length > 0) {
      const startCharIndex = currentOffset;
      const endCharIndex = currentOffset + currentChunkText.length;

      chunks.push({
        chunkIndex: chunkIndex++,
        rawText: currentChunkText.trim(),
        tokenCount: this.estimateTokenCount(currentChunkText),
        spatialMetadata: {
          startCharIndex,
          endCharIndex,
          overlapWithPrevious: chunks.length > 0,
        },
        overlapText: chunks.length > 0 ? previousOverlapText : undefined,
      });
    }

    this.logger.log(
      `[SemanticChunkerService] Berhasil menghasilkan ${chunks.length} objek ChunkData berpasangan Sentence-Level Fallback & Overlap.`,
    );

    return chunks;
  }

  /**
   * Sentence-Level Fallback: Pemotongan paragraf raksasa berdasarkan tanda baca titik/kalimat
   */
  private splitHugeParagraphBySentences(hugeParagraph: string): string[] {
    this.logger.warn(
      `[Sentence-Level Fallback] Paragraf raksasa terdeteksi (${hugeParagraph.length} karakter). Melakukan pemotongan berbasis kalimat.`,
    );

    // Split using sentence punctuation (. , ! , ? , ;\n)
    const sentences = hugeParagraph.split(/(?<=[.!?;\n])\s+/);
    const subChunks: string[] = [];
    let currentSub = '';

    for (const sentence of sentences) {
      if ((currentSub + ' ' + sentence).length > this.targetChunkSize) {
        if (currentSub.length > 0) {
          subChunks.push(currentSub.trim());
          currentSub = sentence;
        } else {
          // Hard split if a single sentence is still larger than targetChunkSize
          subChunks.push(sentence.slice(0, this.targetChunkSize));
          currentSub = sentence.slice(this.targetChunkSize);
        }
      } else {
        currentSub = currentSub ? `${currentSub} ${sentence}` : sentence;
      }
    }

    if (currentSub.trim().length > 0) {
      subChunks.push(currentSub.trim());
    }

    return subChunks;
  }

  estimateTokenCount(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
