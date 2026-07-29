import { Injectable } from '@nestjs/common';

export interface MathDeviationResult {
  indicatorName: string;
  sector: string;
  targetValue: number;
  realizationValue: number;
  targetText: string;
  realizationText: string;
  deviationValue: number;
  deviationPercentage: number;
  urgencyStatus: 'NORMAL' | 'WASPADA' | 'KRITIS';
}

export interface TokenBudgetResult {
  totalTokens: number;
  estimatedCostIdr: number;
  maxMonthlyPaguIdr: number;
  quotaPercentage: number;
  paguStatus: 'SAFE' | 'ALERT' | 'WARNING';
}

@Injectable()
export class AnalysisMathService {
  // Tarif Biaya Komputasi Terpusat: IDR 0.26 per Token (Gabungan Input & Output)
  private readonly TOKEN_PRICE_IDR = 0.26;

  // Batas Pagu Anggaran AI Bulanan Kepala BRIDA: Rp500.000,-
  private readonly MAX_MONTHLY_PAGU_IDR = 500000;

  /**
   * Deterministic Math Calculation for Target vs Realization Deviation
   * 0 Token LLM cost - 100% precision with zero hallucination.
   */
  calculate(
    target: number,
    realization: number,
    indicatorName: string,
    sector: string = 'Fiskal & Ekonomi',
    unitPrefix: string = 'Rp ',
    unitSuffix: string = ' M',
  ): MathDeviationResult {
    const deviationValue = realization - target;
    const deviationPercentage = Number(((deviationValue / target) * 100).toFixed(1));

    let urgencyStatus: 'NORMAL' | 'WASPADA' | 'KRITIS' = 'NORMAL';
    if (deviationPercentage <= -20) {
      urgencyStatus = 'KRITIS';
    } else if (deviationPercentage <= -5) {
      urgencyStatus = 'WASPADA';
    }

    const formatNum = (val: number) =>
      `${unitPrefix}${val.toLocaleString('id-ID')}${unitSuffix}`;

    return {
      indicatorName,
      sector,
      targetValue: target,
      realizationValue: realization,
      targetText: formatNum(target),
      realizationText: formatNum(realization),
      deviationValue,
      deviationPercentage,
      urgencyStatus,
    };
  }

  /**
   * Mengkalkulasi konversi token komputasi AI menjadi representasi anggaran finansial Rupiah (IDR).
   * Bertindak sebagai Pakar Informasi (Information Expert) atas parameter dan aturan anggaran.
   * 
   * @param totalTokens Jumlah akumulasi token (input + output) dari aktivitas AI
   */
  calculateTokenBudget(totalTokens: number): TokenBudgetResult {
    const estimatedCostIdr = Math.round(totalTokens * this.TOKEN_PRICE_IDR);

    // Hitung persentase pemakaian terhadap pagu bulanan (dibatasi maksimum 100%)
    const quotaPercentage = parseFloat(
      Math.min(100, (estimatedCostIdr / this.MAX_MONTHLY_PAGU_IDR) * 100).toFixed(1)
    );

    // Penentuan ambang batas kepatuhan anggaran (Pagu Status Guard)
    let paguStatus: 'SAFE' | 'ALERT' | 'WARNING' = 'SAFE';
    if (quotaPercentage >= 80) {
      paguStatus = 'WARNING'; // Status Kritis / Melebihi 80% pagu
    } else if (quotaPercentage >= 60) {
      paguStatus = 'ALERT';   // Status Waspada / Melebihi 60% pagu
    }

    return {
      totalTokens,
      estimatedCostIdr,
      maxMonthlyPaguIdr: this.MAX_MONTHLY_PAGU_IDR,
      quotaPercentage,
      paguStatus,
    };
  }
}