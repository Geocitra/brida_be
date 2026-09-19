import { Controller, Post, Body, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { DocxService } from '../services/docx.service';
import { GenerateDocxDto } from '../dto/generate-docx.dto';

@Controller('docx')
export class DocxController {
  private readonly logger = new Logger(DocxController.name);

  constructor(private readonly docxService: DocxService) {}

  @Post('generate')
  async generateDocx(@Body() dto: GenerateDocxDto, @Res() res: Response) {
    try {
      const docxBuffer = await this.docxService.generateDocx(dto);

      const filename = dto.filename || 'Draf_Artikel_BRIDA.docx';
      const cleanFilename = filename.toLowerCase().endsWith('.docx') ? filename : `${filename}.docx`;

      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(cleanFilename)}"`,
        'Content-Length': docxBuffer.length,
      });

      res.end(docxBuffer);
    } catch (error) {
      this.logger.error('Gagal memproses pembuatan berkas DOCX:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        statusCode: 500,
        message: `Gagal membuat berkas DOCX: ${errMsg}`,
        error: 'Internal Server Error',
      });
    }
  }
}
