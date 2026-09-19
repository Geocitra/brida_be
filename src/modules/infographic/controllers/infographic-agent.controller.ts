import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { Response } from 'express';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { InfographicAgentService } from '../services/infographic-agent.service';
import { PosterCompositionService } from '../services/poster-composition.service';
import {
  CreateInfographicSessionDto,
  ChatInfographicAgentDto,
} from '../dtos/infographic-agent.dto';

@Controller('infographic/agent')
export class InfographicAgentController {
  constructor(
    private readonly agentService: InfographicAgentService,
    private readonly compositionService: PosterCompositionService,
  ) {}

  /**
   * POST /infographic/agent/session
   * Membuat sesi baru dan langsung menghasilkan poster versi 1
   */
  @Post('session')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Req() req: any, @Body() dto: CreateInfographicSessionDto) {
    const userId = req.user?.id;
    const data = await this.agentService.createSession(dto, userId);
    return {
      success: true,
      data,
    };
  }

  /**
   * POST /infographic/agent/chat
   * Mengirim pesan revisi dan merender poster versi berikutnya (v2, v3, ...)
   */
  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sendRevisionChat(@Req() req: any, @Body() dto: ChatInfographicAgentDto) {
    const userId = req.user?.id;
    const data = await this.agentService.handleChatTurn(dto, userId);
    return {
      success: true,
      data,
    };
  }

  /**
   * GET /infographic/agent/sessions
   * Mengambil daftar riwayat sesi poster milik pengguna
   */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async getSessionsList(@Req() req: any) {
    const userId = req.user?.id;
    const data = await this.agentService.getUserSessions(userId);
    return {
      success: true,
      data,
    };
  }

  /**
   * GET /infographic/agent/sessions/:id
   * Mengambil detail sesi lengkap dengan seluruh riwayat versinya
   */
  @Get('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async getSessionDetail(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const userId = req.user?.id;
    const data = await this.agentService.getSessionDetail(id, userId);
    return {
      success: true,
      data,
    };
  }

  /**
   * GET /infographic/agent/posters/:id/download
   * Mengunduh berkas fisik poster PNG dengan header Content-Disposition: attachment
   */
  @Get('posters/:id/download')
  @UseGuards(JwtAuthGuard)
  async downloadPoster(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('branded') branded: string,
    @Res() res: Response,
  ) {
    const poster = await this.agentService.getPosterById(id);
    if (!poster) {
      throw new NotFoundException('Poster dengan ID tersebut tidak ditemukan.');
    }

    let targetImageUrl = poster.imageUrl;
    let isBranded = false;

    if (branded === 'true') {
      targetImageUrl = await this.compositionService.composePoster(id);
      isBranded = targetImageUrl !== poster.imageUrl;
    }

    const cleanTitle = (poster.session?.title || 'Poster')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 50);
    const suffix = isBranded ? '_Resmi' : '';
    const filename = `Infografis_BRIDA_${cleanTitle}_v${poster.versionNumber}${suffix}.png`;

    const postersRoot = resolve(process.cwd(), 'uploads', 'media', 'posters');
    const relativePath = targetImageUrl.startsWith('/')
      ? targetImageUrl.substring(1)
      : targetImageUrl;
    const fullPath = resolve(process.cwd(), relativePath);

    // Containment check: cegah path traversal
    if (!fullPath.startsWith(postersRoot)) {
      throw new BadRequestException('Lokasi berkas poster tidak sah.');
    }

    if (!existsSync(fullPath)) {
      throw new NotFoundException('Berkas fisik poster tidak ditemukan pada disk server.');
    }

    return res.download(fullPath, filename);
  }

  /**
   * DELETE /infographic/agent/sessions/:id
   * Menghapus sesi dan menghapus file biner PNG dari disk
   */
  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async deleteSession(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const userId = req.user?.id;
    return this.agentService.deleteSession(id, userId);
  }
}
