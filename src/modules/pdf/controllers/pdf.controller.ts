import { Controller, Post, Body, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { PdfService } from '../services/pdf.service';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

@Controller('pdf')
export class PdfController {
  private readonly logger = new Logger(PdfController.name);

  constructor(private readonly pdfService: PdfService) {}

  @Post('generate')
  async generatePdf(@Body() dto: GeneratePdfDto, @Res() res: Response) {
    try {
      const pdfBuffer = await this.pdfService.generatePdf(dto);
      
      const filename = dto.filename || 'Draf_Artikel_AKLS_Mimika.pdf';
      const cleanFilename = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(cleanFilename)}"`,
        'Content-Length': pdfBuffer.length,
      });

      res.end(pdfBuffer);
    } catch (error) {
      this.logger.error('Gagal memproses pembuatan PDF:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        statusCode: 500,
        message: `Gagal membuat PDF: ${errMsg}`,
        error: 'Internal Server Error'
      });
    }
  }
}
