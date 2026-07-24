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

@Injectable()
export class AnalysisMathService {
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
}
