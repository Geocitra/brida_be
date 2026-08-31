import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GeneratedReport, DocumentStatus } from '@prisma/client';

export interface CreateReportInput {
  title: string;
  reportType: string;
  documentIdsHash: string;
  executiveSummary: string;
  contentPayload: any;
  tokenCount: number;
  llmProvider: string;
  documentIds: string[];
  userId: string; // Menambahkan userId untuk isolasi
}

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(documentIdsHash: string, reportType: string = 'NOTA_DINAS_BUPATI', userId?: string): Promise<any | null> {
    const whereClause: any = {
      documentIdsHash,
      reportType,
      status: DocumentStatus.READY,
    };
    if (userId) {
      whereClause.userId = userId;
    }
    return this.prisma.generatedReport.findFirst({
      where: whereClause,
      include: {
        sources: {
          include: {
            document: {
              include: {
                metadata: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findById(id: string, userId?: string): Promise<any | null> {
    const whereClause: any = { id };
    if (userId) {
      whereClause.userId = userId;
    }
    return this.prisma.generatedReport.findFirst({
      where: whereClause,
      include: {
        sources: {
          include: {
            document: {
              include: {
                metadata: true,
              },
            },
          },
        },
      },
    });
  }

  async findAll(userId?: string): Promise<any[]> {
    const whereClause: any = {};
    if (userId) {
      whereClause.userId = userId;
    }
    return this.prisma.generatedReport.findMany({
      where: whereClause,
      include: {
        sources: {
          include: {
            document: {
              select: {
                id: true,
                title: true,
                fileUrl: true,
                metadata: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async create(input: CreateReportInput): Promise<any> {
    const { documentIds, userId, ...reportData } = input;

    return this.prisma.generatedReport.create({
      data: {
        ...reportData,
        userId,
        status: DocumentStatus.READY,
        sources: {
          create: documentIds.map((docId) => ({
            document: {
              connect: { id: docId },
            },
          })),
        },
      },
      include: {
        sources: {
          include: {
            document: {
              include: {
                metadata: true,
              },
            },
          },
        },
      },
    });
  }

  async delete(id: string, userId?: string): Promise<GeneratedReport> {
    const whereClause: any = { id };
    if (userId) {
      whereClause.userId = userId;
    }
    const exists = await this.prisma.generatedReport.findFirst({ where: whereClause });
    if (!exists) {
      throw new Error('Laporan tidak ditemukan atau Anda tidak memiliki akses untuk menghapusnya.');
    }
    return this.prisma.generatedReport.delete({
      where: { id },
    });
  }
}
