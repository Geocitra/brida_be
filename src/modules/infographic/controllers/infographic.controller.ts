import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InfographicService } from '../services/infographic.service';
import {
  GenerateInfographicDto,
  InfographicResponseDto,
  InfographicContentData,
} from '../dtos/generate-infographic.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('infographic')
@UseGuards(JwtAuthGuard)
export class InfographicController {
  constructor(private readonly infographicService: InfographicService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateInfographic(
    @Req() req: any,
    @Body() dto: GenerateInfographicDto,
  ): Promise<{ success: boolean; data: InfographicResponseDto }> {
    const userId = req.user?.id;
    const result = await this.infographicService.generateInfographic(dto, userId);
    return {
      success: true,
      data: result,
    };
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getHistory(): Promise<{ success: boolean; data: InfographicResponseDto[] }> {
    const history = await this.infographicService.getRecentInfographics();
    return {
      success: true,
      data: history,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getById(
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: InfographicResponseDto }> {
    const item = await this.infographicService.getInfographicById(id);
    return {
      success: true,
      data: item,
    };
  }

  @Put(':id/content')
  @HttpCode(HttpStatus.OK)
  async updateContent(
    @Param('id') id: string,
    @Body() body: InfographicContentData,
  ): Promise<{ success: boolean; data: InfographicResponseDto }> {
    const item = await this.infographicService.updateInfographicContent(id, body);
    return {
      success: true,
      data: item,
    };
  }
}
