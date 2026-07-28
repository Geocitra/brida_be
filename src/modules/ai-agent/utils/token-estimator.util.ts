import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';

/**
 * Struktur Laporan Hasil Audit Token Proaktif (Multimodal-ready)
 */
export interface TokenAuditReport {
  isSafe: boolean;
  estimatedTokens: number;
  maxBudgetTokens: number;
  excessTokens: number;
  requiresCompaction: boolean;
}

@Injectable()
export class TokenEstimatorUtil {
  private readonly logger = new Logger(TokenEstimatorUtil.name);

  // Batas anggaran token standar per putaran kolaborasi (default: 8192 token)
  private readonly DEFAULT_BUDGET_TOKENS = 8192;

  // Ambang batas persentase di mana kompresi memori (compaction) harus dipicu (75%) [2]
  private readonly COMPACTION_TRIGGER_THRESHOLD_PCT = 0.75;

  // Konstanta baseline token gambar untuk Google Gemini 1.5
  private readonly GEMINI_BASE_IMAGE_TOKENS = 258;

  /**
   * Estimator adaptif untuk Bahasa Indonesia (Indonesian-Language Token Weight).
   * Rata-rata 1 kata Bahasa Indonesia setara dengan 1.3 - 1.6 token di tokenizer BPE Gemini.
   */
  estimateTokenCount(text: string): number {
    if (!text) return 0;

    const words = text.trim().split(/\s+/).length;
    const charCount = text.length;

    // Heuristik hibrida: Ambil batas atas antara pendekatan karakter-byte dan jumlah kata
    const wordBasedEstimation = Math.ceil(words * 1.5);
    const charBasedEstimation = Math.ceil(charCount / 2.8); // Lebih akurat untuk Bahasa Indonesia

    return Math.max(1, Math.max(wordBasedEstimation, charBasedEstimation));
  }

  /**
   * Menghitung estimasi token gambar spesifik untuk Google Gemini 1.5 Flash/Pro.
   * Jika resolusi dikirimkan, ia menghitung berdasarkan pemotongan ubin (tiling).
   * Jika tidak ada resolusi, ia menggunakan fallback baseline 258 token.
   */
  estimateImageTokenCount(width?: number, height?: number): number {
    // Skenario 1: Jika resolusi tidak diketahui, gunakan flat-rate standar Gemini
    if (!width || !height) {
      return this.GEMINI_BASE_IMAGE_TOKENS;
    }

    // Skenario 2: Resolusi sangat kecil (lebar dan tinggi <= 384px)
    if (width <= 384 && height <= 384) {
      return this.GEMINI_BASE_IMAGE_TOKENS;
    }

    // Skenario 3: Gambar besar memerlukan pembagian ubin (tiling)
    // Ukuran ubin bawaan adalah dimensi terkecil dibagi 1.5, dibatasi antara 256px - 768px
    const minDimension = Math.min(width, height);
    let tileSize = Math.floor(minDimension / 1.5);
    tileSize = Math.max(256, Math.min(768, tileSize));

    // Hitung jumlah ubin horizontal dan vertikal
    const horizontalTiles = Math.ceil(width / tileSize);
    const verticalTiles = Math.ceil(height / tileSize);
    const totalTiles = horizontalTiles * verticalTiles;

    // Setiap ubin dinormalisasi menjadi 768x768 dan menghabiskan 258 token
    const estimatedTokens = totalTiles * this.GEMINI_BASE_IMAGE_TOKENS;

    this.logger.log(
      `[Image Token Calc] Resolusi: ${width}x${height} -> Terbagi menjadi ${totalTiles} ubin (${horizontalTiles}x${verticalTiles}). Est. Token: ${estimatedTokens}`,
    );

    return estimatedTokens;
  }

  /**
   * Estimasi jumlah token dari gabungan teks dan sekumpulan gambar (Multimodal Assembly)
   */
  estimateMultimodalPayloadTokens(
    texts: string[],
    imagesCount: number,
    imageDimensions?: Array<{ width: number; height: number }>,
  ): number {
    const textTokens = this.estimateArrayTokenCount(texts);
    let imageTokens = 0;

    if (imagesCount > 0) {
      if (imageDimensions && imageDimensions.length === imagesCount) {
        // Hitung token gambar presisi menggunakan dimensi ubin
        imageTokens = imageDimensions.reduce(
          (acc, dim) => acc + this.estimateImageTokenCount(dim.width, dim.height),
          0,
        );
      } else {
        // Fallback rata jika dimensi tidak terlampir
        imageTokens = imagesCount * this.GEMINI_BASE_IMAGE_TOKENS;
      }
    }

    return textTokens + imageTokens;
  }

  /**
   * Estimasi jumlah token dari array teks standar (misalnya gabungan pesan obrolan).
   */
  estimateArrayTokenCount(texts: string[]): number {
    if (!texts || texts.length === 0) return 0;
    return texts.reduce((acc, t) => acc + this.estimateTokenCount(t), 0);
  }

  /**
   * Melakukan audit anggaran token dari sekumpulan teks dan gambar secara proaktif [5, 7].
   * Mengembalikan laporan detail apakah aman atau membutuhkan kompresi memori [2, 5].
   */
  auditTokenBudget(
    texts: string[],
    imagesCount: number = 0,
    imageDimensions?: Array<{ width: number; height: number }>,
    maxBudgetTokens: number = this.DEFAULT_BUDGET_TOKENS,
  ): TokenAuditReport {
    const estimatedTokens = this.estimateMultimodalPayloadTokens(
      texts,
      imagesCount,
      imageDimensions,
    );
    const excessTokens = Math.max(0, estimatedTokens - maxBudgetTokens);

    // Pemicu peringatan dini kompresi jika penggunaan token mencapai 75% dari anggaran [2]
    const requiresCompaction =
      estimatedTokens >= maxBudgetTokens * this.COMPACTION_TRIGGER_THRESHOLD_PCT;

    return {
      isSafe: estimatedTokens <= maxBudgetTokens,
      estimatedTokens,
      maxBudgetTokens,
      excessTokens,
      requiresCompaction,
    };
  }

  /**
   * Mekanisme Circuit Breaker Proaktif Multimodal [5, 7].
   * Melemparkan PayloadTooLargeException jika muatan token teks + gambar melampaui batas aman absolut,
   * mencegah server mengalami kegagalan akibat Context Overflow dari API Gemini [5, 7].
   */
  enforceBudgetCircuitBreaker(
    texts: string[],
    imagesCount: number = 0,
    imageDimensions?: Array<{ width: number; height: number }>,
    maxBudgetTokens: number = this.DEFAULT_BUDGET_TOKENS,
  ): void {
    const report = this.auditTokenBudget(texts, imagesCount, imageDimensions, maxBudgetTokens);

    if (!report.isSafe) {
      this.logger.error(
        `[Circuit Breaker Triggered] Estimasi token multimodal (${report.estimatedTokens}) melampaui batas aman anggaran (${report.maxBudgetTokens}). Alur eksekusi LLM dihentikan demi integritas sistem [5, 7].`,
      );

      throw new PayloadTooLargeException(
        `Muatan data kolaborasi (${report.estimatedTokens} estimated tokens, termasuk ${imagesCount} gambar) melampaui batas aman pemrosesan sistem BRIDA (${report.maxBudgetTokens} tokens). Silakan perkecil ukuran teks atau kurangi gambar screenshot [5, 7].`,
      );
    }
  }
}