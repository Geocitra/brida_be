import { Module } from '@nestjs/common';
import { PdfController } from './controllers/pdf.controller';
import { PdfService } from './services/pdf.service';

@Module({
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
