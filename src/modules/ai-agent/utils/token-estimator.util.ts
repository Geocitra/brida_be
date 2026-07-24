import { Injectable } from '@nestjs/common';

@Injectable()
export class TokenEstimatorUtil {
  /**
   * Fast, reliable token estimation for Indonesian/English corporate text
   * Average ~4 characters per token
   */
  estimateTokenCount(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  estimateArrayTokenCount(texts: string[]): number {
    if (!texts || texts.length === 0) return 0;
    return texts.reduce((acc, t) => acc + this.estimateTokenCount(t), 0);
  }
}
