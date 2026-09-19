export type PosterAspectRatio = '1:1' | '9:16' | '16:9' | '3:4' | '4:3';

export interface ImageGenerationOptions {
  prompt: string;
  aspectRatio?: PosterAspectRatio;
  quality?: 'standard' | 'hd';
}

export interface GeneratedImageResult {
  buffer: Buffer;
  revisedPrompt?: string;
  originalUrl?: string;
}

export interface IImageGeneratorAdapter {
  getProviderName(): string;
  generateImage(options: ImageGenerationOptions): Promise<GeneratedImageResult>;
}

export const IMAGE_GENERATOR_TOKEN = Symbol('IImageGeneratorAdapter');
