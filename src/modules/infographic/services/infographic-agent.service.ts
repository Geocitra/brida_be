import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  IMAGE_GENERATOR_TOKEN,
  IImageGeneratorAdapter,
  PosterAspectRatio,
} from '../interfaces/image-generator.interface';
import { ArtDirectorPromptArchitect } from './art-director.service';
import { PosterStorageService } from './poster-storage.service';
import {
  CreateInfographicSessionDto,
  ChatInfographicAgentDto,
} from '../dtos/infographic-agent.dto';

@Injectable()
export class InfographicAgentService {
  private readonly logger = new Logger(InfographicAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly artDirector: ArtDirectorPromptArchitect,
    private readonly posterStorage: PosterStorageService,
    @Inject(IMAGE_GENERATOR_TOKEN)
    private readonly imageGenerator: IImageGeneratorAdapter,
  ) {}

  /**
   * Menginisialisasi sesi obrolan kreatif baru dan langsung merender Poster Versi 1 (v1)
   */
  async createSession(dto: CreateInfographicSessionDto, userId?: string) {
    const aspectRatio: PosterAspectRatio = dto.aspectRatio || '9:16';
    this.logger.log(
      `[InfographicAgent] Inisiasi sesi baru untuk topik: "${dto.topic.substring(0, 45)}..."`,
    );

    // 1. Art Director merancang konsep visual awal & prompt DALL-E 3
    const artConcept = await this.artDirector.craftInitialPosterPrompt({
      topic: dto.topic,
      documentId: dto.documentId,
      aspectRatio,
      customInstructions: dto.customInstructions,
    });

    // 2. Eksekusi DALL-E 3 dengan penegakan Headroom dan Margin deterministik
    const enforcedPrompt = this.enforceHeadroomAndMargins(
      artConcept.imagePrompt,
      artConcept.posterTitle,
    );

    const imageResult = await this.imageGenerator.generateImage({
      prompt: enforcedPrompt,
      aspectRatio,
      quality: 'hd',
    });

    const sessionTitle =
      dto.title?.trim() || artConcept.posterTitle || 'Poster Riset Kebijakan';

    // 3. Catat Sesi Baru ke Database PostgreSQL
    const session = await this.prisma.infographicSession.create({
      data: {
        userId: userId || null,
        documentId: dto.documentId || null,
        title: sessionTitle,
        topic: dto.topic,
        aspectRatio,
      },
    });

    // 4. Simpan biner gambar ke disk lokal secara permanen
    const localImageUrl = this.posterStorage.savePosterBuffer(
      imageResult.buffer,
      session.id,
      1,
    );

    // 5. Catat Poster Versi 1 ke Database
    const initialPoster = await this.prisma.infographicPoster.create({
      data: {
        sessionId: session.id,
        versionNumber: 1,
        userPrompt: dto.topic,
        revisedPrompt: enforcedPrompt,
        aiCommentary: artConcept.aiCommentary,
        imageUrl: localImageUrl,
        aspectRatio,
        generationProfile: 'V2_CLEAN_CANVAS',
      },
    });

    this.logger.log(
      `[InfographicAgent] Sesi ID '${session.id}' berhasil dibuat dengan Poster v1.`,
    );

    return this.getSessionDetail(session.id, userId);
  }

  /**
   * Menerima pesan chat baru (Revisi / Re-prompting) dan merender Poster Versi Berikutnya (v2, v3, ...)
   */
  async handleChatTurn(dto: ChatInfographicAgentDto, userId?: string) {
    const session = await this.prisma.infographicSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        posters: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Sesi poster dengan ID '${dto.sessionId}' tidak ditemukan.`);
    }

    const latestPoster = session.posters[0];
    const nextVersionNumber = latestPoster ? latestPoster.versionNumber + 1 : 1;
    const aspectRatio: PosterAspectRatio = (dto.aspectRatio || session.aspectRatio) as PosterAspectRatio;

    this.logger.log(
      `[InfographicAgent Revision] Memproses revisi v${nextVersionNumber} untuk sesi '${session.id}'...`,
    );

    // 1. Art Director memperbarui prompt berdasarkan instruksi chat pengguna
    const previousPrompt =
      latestPoster?.revisedPrompt || latestPoster?.userPrompt || session.topic;

    const evolvedConcept = await this.artDirector.evolvePosterPrompt({
      previousPrompt,
      userRevisionQuery: dto.message,
      topic: session.topic,
      aspectRatio,
    });

    // 2. Render gambar poster baru versi revisi dengan penegakan Headroom dan Margin deterministik
    const enforcedPrompt = this.enforceHeadroomAndMargins(
      evolvedConcept.imagePrompt,
      evolvedConcept.posterTitle,
    );

    const imageResult = await this.imageGenerator.generateImage({
      prompt: enforcedPrompt,
      aspectRatio,
      quality: 'hd',
    });

    // 3. Simpan biner revisi ke disk lokal
    const localImageUrl = this.posterStorage.savePosterBuffer(
      imageResult.buffer,
      session.id,
      nextVersionNumber,
    );

    // 4. Catat poster revisi baru ke tabel relasional
    const newPoster = await this.prisma.infographicPoster.create({
      data: {
        sessionId: session.id,
        versionNumber: nextVersionNumber,
        userPrompt: dto.message,
        revisedPrompt: enforcedPrompt,
        aiCommentary: evolvedConcept.aiCommentary,
        imageUrl: localImageUrl,
        aspectRatio,
        generationProfile: 'V2_CLEAN_CANVAS',
      },
    });

    // 5. Update timestamp sesi
    await this.prisma.infographicSession.update({
      where: { id: session.id },
      data: {
        updatedAt: new Date(),
        ...(aspectRatio !== session.aspectRatio ? { aspectRatio } : {}),
      },
    });

    this.logger.log(
      `[InfographicAgent Revision Complete] Poster v${nextVersionNumber} berhasil disimpan di ${localImageUrl}`,
    );

    return {
      session: {
        id: session.id,
        title: session.title,
        topic: session.topic,
        aspectRatio,
        updatedAt: new Date(),
      },
      latestPoster: newPoster,
    };
  }

  /**
   * Mengambil daftar seluruh riwayat sesi poster pengguna
   */
  async getUserSessions(userId?: string) {
    const where = userId ? { userId } : {};
    const sessions = await this.prisma.infographicSession.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        document: {
          select: { id: true, title: true },
        },
        posters: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
        _count: {
          select: { posters: true },
        },
      },
    });

    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      topic: s.topic,
      aspectRatio: s.aspectRatio,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      document: s.document,
      totalVersions: s._count.posters,
      latestPoster: s.posters[0] || null,
    }));
  }

  /**
   * Mengambil detail satu sesi lengkap dengan semua riwayat versi posternya
   */
  async getSessionDetail(sessionId: string, userId?: string) {
    const where: any = { id: sessionId };
    if (userId) where.userId = userId;

    const session = await this.prisma.infographicSession.findFirst({
      where,
      include: {
        document: {
          select: { id: true, title: true, metadata: true },
        },
        posters: {
          orderBy: { versionNumber: 'asc' },
          include: {
            branding: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Sesi infografis dengan ID '${sessionId}' tidak ditemukan.`);
    }

    return {
      id: session.id,
      title: session.title,
      topic: session.topic,
      aspectRatio: session.aspectRatio,
      document: session.document,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      posters: session.posters,
    };
  }

  /**
   * Mengambil satu poster berdasarkan ID untuk kebutuhan download
   */
  async getPosterById(posterId: string) {
    return this.prisma.infographicPoster.findUnique({
      where: { id: posterId },
      include: {
        session: {
          select: { title: true },
        },
        branding: true,
      },
    });
  }

  /**
   * Menghapus sesi beserta membersihkan seluruh file biner PNG dari disk fisik
   */
  async deleteSession(sessionId: string, userId?: string) {
    const where: any = { id: sessionId };
    if (userId) where.userId = userId;

    const session = await this.prisma.infographicSession.findFirst({
      where,
      include: { posters: true },
    });

    if (!session) {
      throw new NotFoundException(`Sesi infografis dengan ID '${sessionId}' tidak ditemukan.`);
    }

    // 1. Bersihkan seluruh file gambar fisik dari disk server
    for (const poster of session.posters) {
      if (poster.imageUrl) {
        this.posterStorage.removePosterFile(poster.imageUrl);
      }
    }

    // 2. Hapus entitas sesi dari database (cascade ke posters)
    await this.prisma.infographicSession.delete({
      where: { id: sessionId },
    });

    this.logger.log(
      `[InfographicAgent Deleted] Sesi ID '${sessionId}' dan ${session.posters.length} file poster fisik berhasil dibersihkan.`,
    );

    return {
      success: true,
      message: `Sesi poster dan ${session.posters.length} berkas gambar berhasil dihapus.`,
    };
  }

  /**
   * Menyuntikkan aturan Headroom dan Margin secara deterministik sebelum dikirim ke DALL-E / Image Engine.
   * Model AI tidak mengerti sintaks persentase seperti (10-26%), sehingga wajib diinstruksikan
   * secara fisik: langit/pucuk kosong, judul ditarik ke bawah, dan kartu bawah tidak menyentuh tepi.
   */
  private enforceHeadroomAndMargins(rawPrompt: string, title?: string): string {
    const titleInstruction = title
      ? `The main headline title "${title}" MUST be positioned in the lower-middle portion of the hero scene, leaving generous clear open sky above it for the official government header.`
      : `All main headline titles MUST be placed in the lower-middle portion of the hero scene, leaving generous clear sky above it.`;

    const headroomDirectives = [
      'CRITICAL CANVAS COMPOSITION & HEADROOM RULES (MANDATORY):',
      '1. TOP HEADROOM MARGIN: The topmost 15% of the canvas MUST be a completely clean, uncluttered open sky or empty solid margin with ZERO text, ZERO titles, ZERO icons, and NO graphic borders.',
      `2. TITLE PLACEMENT: ${titleInstruction} Never place any title or headline at the topmost edge of the poster.`,
      '3. BOTTOM MARGIN: The bottom 8-10% of the canvas MUST be clean empty margin space. All cards, charts, icons, and bullet text must terminate strictly above this bottom margin and never touch the bottom edge of the poster.',
    ].join('\n');

    return `${headroomDirectives}\n\n${rawPrompt}`;
  }
}
