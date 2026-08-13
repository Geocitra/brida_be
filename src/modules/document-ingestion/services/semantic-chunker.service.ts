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
    
    // 2. Sentence/Table-Level Fallback: Handle giant paragraphs and preserve tables
    const normalizedParagraphs: string[] = [];
    for (const paragraph of rawParagraphs) {
      const cleanPara = paragraph.trim();
      if (!cleanPara) continue;

      if (this.isMarkdownTable(cleanPara)) {
        if (cleanPara.length > this.targetChunkSize) {
          const tableSubChunks = this.splitMarkdownTable(cleanPara);
          normalizedParagraphs.push(...tableSubChunks);
        } else {
          normalizedParagraphs.push(cleanPara);
        }
      } else if (cleanPara.length > this.targetChunkSize) {
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

          let finalChunkText = currentChunkText.trim();
          if (this.isMarkdownTable(finalChunkText) && !finalChunkText.startsWith('[Metadata Tabel')) {
            finalChunkText = this.generateTableMetadataPrefix(finalChunkText) + finalChunkText;
          }

          chunks.push({
            chunkIndex: chunkIndex++,
            rawText: finalChunkText,
            tokenCount: this.estimateTokenCount(finalChunkText),
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

      let finalChunkText = currentChunkText.trim();
      if (this.isMarkdownTable(finalChunkText) && !finalChunkText.startsWith('[Metadata Tabel')) {
        finalChunkText = this.generateTableMetadataPrefix(finalChunkText) + finalChunkText;
      }

      chunks.push({
        chunkIndex: chunkIndex++,
        rawText: finalChunkText,
        tokenCount: this.estimateTokenCount(finalChunkText),
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
   * Mendeteksi apakah suatu teks berisi blok tabel Markdown
   */
  private isMarkdownTable(text: string): boolean {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      const nextLine = lines[i + 1].trim();
      if (line.startsWith('|') && nextLine.startsWith('|') && nextLine.includes('-')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Memecah tabel Markdown yang sangat besar dengan menerapkan Header Propagation
   */
  private splitMarkdownTable(tableText: string): string[] {
    const lines = tableText.split('\n');
    
    // Temukan baris header dan divider tabel
    let headerIdx = -1;
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      const nextLine = lines[i + 1].trim();
      if (line.startsWith('|') && nextLine.startsWith('|') && nextLine.includes('-')) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1 || lines.length <= headerIdx + 2) {
      return [tableText];
    }

    // Salin header tabel asli (2 baris pertama tabel)
    const headerLines = lines.slice(headerIdx, headerIdx + 2);
    const headerText = headerLines.join('\n');
    const dataLines = lines.slice(headerIdx + 2);

    const subChunks: string[] = [];
    let currentRows: string[] = [];
    let currentSize = headerText.length;

    for (const row of dataLines) {
      const trimmedRow = row.trim();
      if (!trimmedRow) continue;

      if (currentRows.length > 0 && currentSize + 1 + trimmedRow.length > this.targetChunkSize) {
        subChunks.push(headerText + '\n' + currentRows.join('\n'));
        currentRows = [trimmedRow];
        currentSize = headerText.length + 1 + trimmedRow.length;
      } else {
        currentRows.push(trimmedRow);
        currentSize += 1 + trimmedRow.length;
      }
    }

    if (currentRows.length > 0) {
      subChunks.push(headerText + '\n' + currentRows.join('\n'));
    }

    this.logger.log(
      `[SemanticChunkerService] Tabel besar dipecah menjadi ${subChunks.length} bagian dengan Header Propagation.`,
    );

    return subChunks;
  }

  /**
   * Menghasilkan teks deskripsi singkat untuk disisipkan sebagai metadata pencarian semantik (Semantic Enrichment)
   */
  private generateTableMetadataPrefix(text: string): string {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      const nextLine = lines[i + 1].trim();
      if (line.startsWith('|') && nextLine.startsWith('|') && nextLine.includes('-')) {
        const columns = line
          .split('|')
          .map(col => col.trim())
          .filter(col => col.length > 0);
        if (columns.length > 0) {
          return `[Metadata Tabel: Data statistik sektoral Kabupaten Mimika yang memuat indikator/kolom: ${columns.join(', ')}]\n`;
        }
      }
    }
    return '[Metadata Tabel: Data statistik kuantitatif sektoral Kabupaten Mimika]\n';
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
