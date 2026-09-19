import { Module } from '@nestjs/common';
import { DocxController } from './controllers/docx.controller';
import { DocxService } from './services/docx.service';

@Module({
  controllers: [DocxController],
  providers: [DocxService],
  exports: [DocxService],
})
export class DocxModule {}
