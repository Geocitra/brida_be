import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  remainingTokens: number;
  estimatedCostIdr: number;
  remainingCostIdr: number;
  maxMonthlyPaguIdr: number;
  quotaPercentage: number;
  paguStatus: 'SAFE' | 'ALERT' | 'WARNING';
}

@Injectable()
export class AnalysisMathService {
  constructor(private readonly configService: ConfigService) {}

  // Tarif Biaya Komputasi Terpusat (GPT-4o-mini Weighted Average): USD 0.00000024 per Token
  private readonly TOKEN_PRICE_USD = 0.00000024;

  // Kurs Terkini dari User: Rp18.076,- per USD
  private readonly KURS_USD_TO_IDR = 18076;

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
    const totalCreditUsd = parseFloat(
      this.configService.get<string>('OPENAI_TOTAL_CREDIT_USD') || '5.00'
    );
    const preUsedCreditUsd = parseFloat(
      this.configService.get<string>('OPENAI_PRE_USED_CREDIT_USD') || '0.38'
    );

    const estimatedCostUsd = totalTokens * this.TOKEN_PRICE_USD;
    const estimatedCostIdr = Math.round(estimatedCostUsd * this.KURS_USD_TO_IDR);
    
    // Total Kredit yang dibeli (pagu max)
    const maxMonthlyPaguIdr = Math.round(totalCreditUsd * this.KURS_USD_TO_IDR);
    
    // Sisa saldo & token
    const remainingCostUsd = Math.max(0, totalCreditUsd - preUsedCreditUsd - estimatedCostUsd);
    const remainingCostIdr = Math.round(remainingCostUsd * this.KURS_USD_TO_IDR);
    const remainingTokens = Math.max(0, Math.floor(remainingCostUsd / this.TOKEN_PRICE_USD));

    // Hitung persentase pemakaian terhadap pagu bulanan (dibatasi maksimum 100%)
    const totalUsedUsd = preUsedCreditUsd + estimatedCostUsd;
    const quotaPercentage = parseFloat(
      Math.min(100, (totalUsedUsd / totalCreditUsd) * 100).toFixed(1)
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
      remainingTokens,
      estimatedCostIdr,
      remainingCostIdr,
      maxMonthlyPaguIdr,
      quotaPercentage,
      paguStatus,
    };
  }
}