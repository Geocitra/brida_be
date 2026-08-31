import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { GenerateReportDto, CheckCacheDto } from './dto/generate-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateReport(@Req() req: any, @Body() dto: GenerateReportDto) {
    return this.reportsService.generateReport({
      ...dto,
      userId: req.user.id,
    });
  }

  @Post('check-cache')
  @HttpCode(HttpStatus.OK)
  async checkCache(@Req() req: any, @Body() dto: CheckCacheDto) {
    return this.reportsService.checkCache(dto.documentIds, dto.reportType, req.user.id);
  }

  @Get()
  async getAllReports(@Req() req: any) {
    const data = await this.reportsService.getAllReports(req.user.id);
    return {
      success: true,
      data,
    };
  }

  @Get(':id')
  async getReportById(@Req() req: any, @Param('id') id: string) {
    const data = await this.reportsService.getReportById(id, req.user.id);
    return {
      success: true,
      data,
    };
  }

  @Delete(':id')
  async deleteReport(@Req() req: any, @Param('id') id: string) {
    await this.reportsService.deleteReport(id, req.user.id);
    return {
      success: true,
      message: `Laporan dengan ID '${id}' berhasil dihapus.`,
    };
  }
}

@Controller('reports/share')
export class ReportsShareController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get(':id')
  async getSharedReport(@Param('id') id: string) {
    const data = await this.reportsService.getSharedReportById(id);
    return {
      success: true,
      data,
    };
  }
}
