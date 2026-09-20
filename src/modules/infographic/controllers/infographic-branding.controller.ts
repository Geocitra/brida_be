import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
  UploadedFile,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { InfographicBrandingService } from '../services/infographic-branding.service';
import { UpsertPosterBrandingDto } from '../dtos/poster-branding.dto';
import { ImageSignatureValidationPipe } from '../pipes/image-signature-validation.pipe';

@Controller('infographic/agent/posters/:id/branding')
@UseGuards(JwtAuthGuard)
export class InfographicBrandingController {
  constructor(private readonly brandingService: InfographicBrandingService) {}

  /**
   * GET /infographic/agent/posters/:id/branding
   * Mengambil konfigurasi branding poster saat ini
   */
  @Get()
  async getBranding(
    @Param('id', new ParseUUIDPipe({ version: '4' })) posterId: string,
  ) {
    const data = await this.brandingService.getBranding(posterId);
    return {
      success: true,
      data,
    };
  }

  /**
   * PUT /infographic/agent/posters/:id/branding
   * Menyimpan perubahan teks, aktivasi kop/footer, serta layoutConfig warna latar
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  async updateBranding(
    @Param('id', new ParseUUIDPipe({ version: '4' })) posterId: string,
    @Body() dto: UpsertPosterBrandingDto,
  ) {
    const data = await this.brandingService.upsertBranding(posterId, dto);
    return {
      success: true,
      data,
    };
  }

  /**
   * POST /infographic/agent/posters/:id/branding/logo
   * Mengunggah berkas logo resmi (PNG/JPEG max 2MB)
   */
  @Post('logo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('logo'))
  async uploadLogo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) posterId: string,
    @UploadedFile(new ImageSignatureValidationPipe()) file: Express.Multer.File,
  ) {
    const data = await this.brandingService.uploadLogo(posterId, file);
    return {
      success: true,
      data,
    };
  }

  /**
   * DELETE /infographic/agent/posters/:id/branding/logo
   * Menghapus logo yang terpasang
   */
  @Delete('logo')
  @HttpCode(HttpStatus.OK)
  async deleteLogo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) posterId: string,
  ) {
    const data = await this.brandingService.deleteLogo(posterId);
    return {
      success: true,
      data,
    };
  }
}
