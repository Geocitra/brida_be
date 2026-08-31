import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class SystemSettingService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllSettings() {
    return this.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async getSettingByKey(key: string) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (!setting) {
      throw new NotFoundException(`Pengaturan dengan key '${key}' tidak ditemukan.`);
    }
    return setting;
  }

  async updateSetting(key: string, value: string) {
    return this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
