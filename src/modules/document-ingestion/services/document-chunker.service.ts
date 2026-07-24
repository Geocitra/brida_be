import { Injectable, Logger } from '@nestjs/common';

export interface GeneratedChunk {
  chunkIndex: number;
  rawText: string;
  tokenCount: number;
}

@Injectable()
export class DocumentChunkerService {
  private readonly logger = new Logger(DocumentChunkerService.name);

  // Target token per chunk (misal ~500 token atau ~2000 karakter)
  private readonly targetChunkSize = 2000;
  private readonly chunkOverlap = 200;

  createChunks(rawText: string): GeneratedChunk[] {
    if (!rawText || rawText.trim().length === 0) {
      return [];
    }

    const paragraphs = rawText.split(/\n\s*\n/);
    const chunks: GeneratedChunk[] = [];
    let currentChunkText = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const cleanParagraph = paragraph.trim();
      if (!cleanParagraph) continue;

      if ((currentChunkText + '\n\n' + cleanParagraph).length > this.targetChunkSize) {
        if (currentChunkText.length > 0) {
          chunks.push({
            chunkIndex: chunkIndex++,
            rawText: currentChunkText.trim(),
            tokenCount: this.estimateTokenCount(currentChunkText),
          });
          
          // Carry over overlap text
          const words = currentChunkText.split(' ');
          const overlapWords = words.slice(-Math.min(words.length, 30)).join(' ');
          currentChunkText = overlapWords + '\n\n' + cleanParagraph;
        } else {
          // Single paragraph is larger than target chunk size
          currentChunkText = cleanParagraph;
        }
      } else {
        currentChunkText = currentChunkText
          ? `${currentChunkText}\n\n${cleanParagraph}`
          : cleanParagraph;
      }
    }

    if (currentChunkText.trim().length > 0) {
      chunks.push({
        chunkIndex: chunkIndex++,
        rawText: currentChunkText.trim(),
        tokenCount: this.estimateTokenCount(currentChunkText),
      });
    }

    this.logger.log(`Berhasil membuat ${chunks.length} chunks dari total ${rawText.length} karakter.`);
    return chunks;
  }

  estimateTokenCount(text: string): number {
    // Estimasi standar NLP: ~1 token per 4 karakter Bahasa Indonesia/Inggris
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
