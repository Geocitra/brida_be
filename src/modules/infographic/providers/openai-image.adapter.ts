import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IImageGeneratorAdapter,
  ImageGenerationOptions,
  GeneratedImageResult,
  PosterAspectRatio,
} from '../interfaces/image-generator.interface';

@Injectable()
export class OpenAiImageAdapter implements IImageGeneratorAdapter {
  private readonly logger = new Logger(OpenAiImageAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  getProviderName(): string {
    const model = this.configService.get<string>('OPENAI_IMAGE_MODEL') || 'chatgpt-image-latest';
    return `OpenAiImageAdapter (${model})`;
  }

  async generateImage(options: ImageGenerationOptions): Promise<GeneratedImageResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey || apiKey.trim().length === 0) {
      throw new InternalServerErrorException(
        'OPENAI_API_KEY belum dikonfigurasi pada environment server.',
      );
    }

    const configuredModel = this.configService.get<string>('OPENAI_IMAGE_MODEL') || 'chatgpt-image-latest';

    try {
      return await this.executeImageGeneration(configuredModel, options, apiKey);
    } catch (primaryErr: any) {
      this.logger.warn(
        `[OpenAiImageAdapter] Model '${configuredModel}' gagal (${primaryErr.message}). Mencoba fallback...`,
      );

      // Jika chatgpt-image-latest gagal, coba fallback ke dall-e-3
      if (configuredModel !== 'dall-e-3') {
        try {
          this.logger.log(`[OpenAiImageAdapter Fallback] Mencoba generasi dengan model 'dall-e-3'...`);
          return await this.executeImageGeneration('dall-e-3', options, apiKey);
        } catch (dalleErr: any) {
          this.logger.warn(`[OpenAiImageAdapter Fallback DALL-E 3 gagal]: ${dalleErr.message}`);
        }
      }

      // Fallback sekunder: Pollinations AI Diffusion Engine jika OpenAI kuota habis / error
      try {
        this.logger.log(`[OpenAiImageAdapter] Mengaktifkan High-Res Fallback Engine (Pollinations AI)...`);
        return await this.generatePollinationsFallback(options);
      } catch (fallbackErr: any) {
        this.logger.error(`[OpenAiImageAdapter] Seluruh engine generasi gagal: ${fallbackErr.message}`);
        throw new InternalServerErrorException(
          `Gagal merender poster visual: ${primaryErr.message}`,
        );
      }
    }
  }

  private async executeImageGeneration(
    model: string,
    options: ImageGenerationOptions,
    apiKey: string,
  ): Promise<GeneratedImageResult> {
    const isChatGptImage = model.includes('chatgpt-image');

    let resolution: string;
    let quality: string;

    if (isChatGptImage) {
      // chatgpt-image-latest didukung: 1024x1024, 1024x1536, 1536x1024, auto
      // Kualitas: low, medium, high, auto
      switch (options.aspectRatio) {
        case '1:1':
          resolution = '1024x1024';
          break;
        case '16:9':
        case '4:3':
          resolution = '1536x1024';
          break;
        case '9:16':
        case '3:4':
        default:
          resolution = '1024x1536';
          break;
      }
      quality = 'high';
    } else {
      // DALL-E 3 didukung: 1024x1024, 1024x1792, 1792x1024
      // Kualitas: standard, hd
      switch (options.aspectRatio) {
        case '1:1':
          resolution = '1024x1024';
          break;
        case '16:9':
        case '4:3':
          resolution = '1792x1024';
          break;
        case '9:16':
        case '3:4':
        default:
          resolution = '1024x1792';
          break;
      }
      quality = options.quality || 'hd';
    }

    this.logger.log(
      `[OpenAI Image Request] Model=${model}, Resolution=${resolution}, Quality=${quality}`,
    );

    const endpoint = 'https://api.openai.com/v1/images/generations';
    const payload: Record<string, any> = {
      model,
      prompt: options.prompt,
      n: 1,
      size: resolution,
      quality,
    };

    // PENTING: response_format hanya didukung pada DALL-E 2 / 3, dilarang dikirim ke chatgpt-image-latest
    if (!isChatGptImage) {
      payload.response_format = 'b64_json';
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.message || response.statusText;
      this.logger.error(`[OpenAI Image API Error]: ${errorMsg}`);
      throw new Error(`OpenAI Error (${response.status}): ${errorMsg}`);
    }

    const item = data?.data?.[0];
    if (!item || (!item.b64_json && !item.url)) {
      throw new Error('OpenAI tidak mengembalikan biner atau URL gambar.');
    }

    let buffer: Buffer;
    if (item.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64');
    } else {
      const imageFetch = await fetch(item.url);
      buffer = Buffer.from(await imageFetch.arrayBuffer());
    }

    this.logger.log(
      `[OpenAI Image Success] Gambar biner berhasil diperoleh (${(buffer.length / 1024).toFixed(2)} KB).`,
    );

    return {
      buffer,
      revisedPrompt: item.revised_prompt || options.prompt,
      originalUrl: item.url,
    };
  }

  /**
   * Fail-Safe Fallback: Pollinations AI Diffusion Engine
   */
  private async generatePollinationsFallback(
    options: ImageGenerationOptions,
  ): Promise<GeneratedImageResult> {
    const dimensions = this.mapAspectRatioToPixelDimensions(options.aspectRatio || '9:16');
    const encodedPrompt = encodeURIComponent(options.prompt.substring(0, 800));
    const randomSeed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${dimensions.width}&height=${dimensions.height}&seed=${randomSeed}&nologo=true&enhance=true`;

    this.logger.log(`[Pollinations Fallback] Mengambil gambar dari: ${url.substring(0, 100)}...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`Pollinations HTTP ${resp.status}: ${resp.statusText}`);
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      return {
        buffer,
        revisedPrompt: options.prompt,
        originalUrl: url,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private mapAspectRatioToPixelDimensions(
    ratio: PosterAspectRatio,
  ): { width: number; height: number } {
    switch (ratio) {
      case '1:1':
        return { width: 1080, height: 1080 };
      case '16:9':
        return { width: 1920, height: 1080 };
      case '4:3':
        return { width: 1440, height: 1080 };
      case '3:4':
        return { width: 1080, height: 1440 };
      case '9:16':
      default:
        return { width: 1080, height: 1920 };
    }
  }
}

