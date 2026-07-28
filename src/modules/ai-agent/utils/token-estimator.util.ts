import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';

/**
 * Struktur Laporan Hasil Audit Token Proaktif
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

  // Batas anggaran token standar per putaran tanya-jawab (default: 8192 token)
  private readonly DEFAULT_BUDGET_TOKENS = 8192;

  // Ambang batas persentase di mana kompresi memori (compaction) harus dipicu (75%) [2]
  private readonly COMPACTION_TRIGGER_THRESHOLD_PCT = 0.75;

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
    const charBasedEstimation = Math.ceil(charCount / 2.8); // Lebih akurat daripada pembagian 4

    return Math.max(1, Math.max(wordBasedEstimation, charBasedEstimation));
  }

  /**
   * Estimasi jumlah token dari array teks (misalnya gabungan pesan obrolan).
   */
  estimateArrayTokenCount(texts: string[]): number {
    if (!texts || texts.length === 0) return 0;
    return texts.reduce((acc, t) => acc + this.estimateTokenCount(t), 0);
  }

  /**
   * Melakukan audit anggaran token dari sekumpulan teks secara proaktif.
   * Mengembalikan laporan detail apakah aman atau membutuhkan kompresi memori [2, 5].
   */
  auditTokenBudget(
    texts: string[],
    maxBudgetTokens: number = this.DEFAULT_BUDGET_TOKENS,
  ): TokenAuditReport {
    const estimatedTokens = this.estimateArrayTokenCount(texts);
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
   * Mekanisme Circuit Breaker Proaktif [5, 7].
   * Melemparkan PayloadTooLargeException jika muatan token melampaui batas aman absolut,
   * mencegah server mengalami kegagalan akibat Context Overflow dari API Gemini [5, 7].
   */
  enforceBudgetCircuitBreaker(
    texts: string[],
    maxBudgetTokens: number = this.DEFAULT_BUDGET_TOKENS,
  ): void {
    const report = this.auditTokenBudget(texts, maxBudgetTokens);

    if (!report.isSafe) {
      this.logger.error(
        `[Circuit Breaker Triggered] Estimasi token (${report.estimatedTokens}) melampaui batas aman anggaran (${report.maxBudgetTokens}). Alur eksekusi LLM dihentikan demi integritas sistem [5, 7].`,
      );

      throw new PayloadTooLargeException(
        `Muatan data obrolan (${report.estimatedTokens} estimated tokens) melampaui batas aman pemrosesan sistem BRIDA (${report.maxBudgetTokens} tokens). Silakan mulai sesi obrolan baru atau bersihkan dokumen acuan [5, 7].`,
      );
    }
  }
}