import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { GenerateReportDto, CheckCacheDto } from './dto/generate-report.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateReport(@Body() dto: GenerateReportDto) {
    return this.reportsService.generateReport(dto);
  }

  @Post('check-cache')
  @HttpCode(HttpStatus.OK)
  async checkCache(@Body() dto: CheckCacheDto) {
    return this.reportsService.checkCache(dto.documentIds, dto.reportType);
  }

  @Get()
  async getAllReports() {
    const data = await this.reportsService.getAllReports();
    return {
      success: true,
      data,
    };
  }

  @Get(':id')
  async getReportById(@Param('id') id: string) {
    const data = await this.reportsService.getReportById(id);
    return {
      success: true,
      data,
    };
  }

  @Delete(':id')
  async deleteReport(@Param('id') id: string) {
    await this.reportsService.deleteReport(id);
    return {
      success: true,
      message: `Laporan dengan ID '${id}' berhasil dihapus.`,
    };
  }
}
