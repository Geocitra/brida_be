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
}

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(documentIdsHash: string, reportType: string = 'NOTA_DINAS_BUPATI'): Promise<any | null> {
    return this.prisma.generatedReport.findFirst({
      where: {
        documentIdsHash,
        reportType,
        status: DocumentStatus.READY,
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
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.generatedReport.findUnique({
      where: { id },
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

  async findAll(): Promise<any[]> {
    return this.prisma.generatedReport.findMany({
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
    const { documentIds, ...reportData } = input;

    return this.prisma.generatedReport.create({
      data: {
        ...reportData,
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

  async delete(id: string): Promise<GeneratedReport> {
    return this.prisma.generatedReport.delete({
      where: { id },
    });
  }
}
