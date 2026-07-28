import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ChatRepository } from '../repositories/chat.repository';
import { TranscriptDistiller } from '../utils/transcript-distiller.util';
import { ArticleGeneratorService } from './article-generator.service';
import { ArticleLength, SessionType } from '@prisma/client';

export interface TransitionQaRequestDto {
    sessionId: string; // ID sesi QA obrolan asal
    articleTitle: string;
    targetLength?: ArticleLength;
    tone?: string;
    userInstruction?: string;
}

@Injectable()
export class DiscussionBridgeService {
    private readonly logger = new Logger(DiscussionBridgeService.name);

    constructor(
        private readonly chatRepository: ChatRepository,
        private readonly distiller: TranscriptDistiller,
        private readonly articleGenerator: ArticleGeneratorService,
    ) { }

    /**
     * Menjembatani konversi dari sesi diskusi (QA_CHAT) panjang lebar
     * menjadi sesi penulisan artikel independen baru (ARTICLE_GENERATOR).
     */
    async transitionQaToArticle(dto: TransitionQaRequestDto): Promise<any> {
        const { sessionId, articleTitle, targetLength = ArticleLength.MEDIUM, tone = 'solutif', userInstruction } = dto;

        this.logger.log(
            `[DiscussionBridgeService] Memulai inisiasi transisi sesi diskusi '${sessionId}' ke naskah artikel...`,
        );

        // 1. Validasi Sesi Diskusi Asal (Information Expert Check)
        const sourceSession = await this.chatRepository.findSessionById(sessionId);
        if (!sourceSession) {
            throw new NotFoundException(`Sesi diskusi asal dengan ID '${sessionId}' tidak ditemukan.`);
        }

        if (sourceSession.sessionType !== SessionType.QA_CHAT) {
            throw new BadRequestException(
                `Transisi hanya dapat dipicu dari sesi obrolan bertipe '${SessionType.QA_CHAT}'. Sesi aktif saat ini bertipe '${sourceSession.sessionType}'.`,
            );
        }

        // 2. Ambil Seluruh Kronologi Obrolan (Full History Retrieval)
        const messages = await this.chatRepository.getAllMessagesChronological(sessionId);
        if (!messages || messages.length === 0) {
            throw new BadRequestException(
                'Sesi obrolan diskusi Anda masih kosong. Silakan lakukan tanya-jawab dengan AI terlebih dahulu sebelum merakit naskah artikel.',
            );
        }

        // 3. Fase 1: Distilasi Transkrip Obrolan (Pass-1: Transcript Distillation)
        const synthesizedManifest = await this.distiller.distill(messages);

        // 4. Ekstraksi dan Unifikasi Dokumen Rujukan (Citation & Sources Integration)
        // Ambil semua ID dokumen rujukan dari tabel relasi jembatan sesi asal
        const documentIds: string[] = sourceSession.sources?.map((s: any) => s.documentId) || [];

        // Fallback jika ada ID dokumen utama yang belum tercatat di tabel jembatan
        if (sourceSession.documentId && !documentIds.includes(sourceSession.documentId)) {
            documentIds.push(sourceSession.documentId);
        }

        const uniqueDocIds = Array.from(new Set(documentIds.filter(Boolean) as string[]));
        if (uniqueDocIds.length === 0) {
            throw new BadRequestException(
                'Sesi diskusi asal tidak memiliki dokumen laporan acuan terdaftar yang dapat dijadikan rujukan penulisan.',
            );
        }

        this.logger.log(
            `[DiscussionBridgeService] Distilasi sukses. Meneruskan manifest ke pembuat draf dengan ${uniqueDocIds.length} dokumen rujukan.`,
        );

        // 5. Fase 2: Penulisan Draf Artikel Independen Baru (Pass-2: Drafting & Citations Assembly)
        // Mengarahkan generator artikel untuk melahirkan draf baru dengan referensi parentSessionId
        const articleResult = await this.articleGenerator.generateArticle({
            documentIds: uniqueDocIds,
            articleTitle,
            targetLength,
            tone,
            userInstruction,
            synthesizedManifest, // Meneruskan Structured Synthesis Manifest hasil Pass-1
            parentSessionId: sessionId, // Mengikat silsilah sesi QA asal secara independen
        });

        this.logger.log(
            `[DiscussionBridgeService] Sukses melahirkan sesi draf artikel baru ID '${articleResult.sessionId}' dari sesi QA '${sessionId}'.`,
        );

        return articleResult;
    }
}