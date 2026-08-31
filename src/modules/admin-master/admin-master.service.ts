import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminMasterService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // 1. OPD (Dinas) CRUD
  // ==========================================
  async getAllOpds() {
    return this.prisma.oPD.findMany({
      include: {
        _count: {
          select: { users: true, documents: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createOpd(data: { name: string; code: string; headName?: string; headPhone?: string }) {
    return this.prisma.oPD.create({
      data,
    });
  }

  async updateOpd(id: string, data: { name?: string; code?: string; headName?: string; headPhone?: string }) {
    await this.getOpdById(id);
    return this.prisma.oPD.update({
      where: { id },
      data,
    });
  }

  async deleteOpd(id: string) {
    await this.getOpdById(id);
    const linkedUsers = await this.prisma.user.count({ where: { opdId: id } });
    const linkedDocs = await this.prisma.documentMetadata.count({ where: { opdId: id } });
    if (linkedUsers > 0 || linkedDocs > 0) {
      throw new BadRequestException('OPD tidak dapat dihapus karena masih terhubung dengan pengguna atau dokumen.');
    }
    return this.prisma.oPD.delete({
      where: { id },
    });
  }

  private async getOpdById(id: string) {
    const opd = await this.prisma.oPD.findUnique({ where: { id } });
    if (!opd) throw new NotFoundException('OPD tidak ditemukan.');
    return opd;
  }

  // ==========================================
  // 2. DocumentCategory CRUD
  // ==========================================
  async getAllCategories() {
    return this.prisma.documentCategory.findMany({
      include: {
        _count: {
          select: { documents: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(data: { name: string; code: string; description?: string; analyticalRole?: string }) {
    return this.prisma.documentCategory.create({
      data,
    });
  }

  async updateCategory(id: string, data: { name?: string; code?: string; description?: string; analyticalRole?: string }) {
    await this.getCategoryById(id);
    return this.prisma.documentCategory.update({
      where: { id },
      data,
    });
  }

  async deleteCategory(id: string) {
    await this.getCategoryById(id);
    const linkedDocs = await this.prisma.documentMetadata.count({ where: { categoryId: id } });
    if (linkedDocs > 0) {
      throw new BadRequestException('Kategori tidak dapat dihapus karena masih terhubung dengan dokumen.');
    }
    return this.prisma.documentCategory.delete({
      where: { id },
    });
  }

  private async getCategoryById(id: string) {
    const cat = await this.prisma.documentCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Kategori dokumen tidak ditemukan.');
    return cat;
  }

  // ==========================================
  // 3. District (Wilayah) CRUD
  // ==========================================
  async getAllDistricts() {
    return this.prisma.district.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createDistrict(data: {
    name: string;
    latitude: number;
    longitude: number;
    aliases?: string[];
    luasWilayah?: number;
    jumlahPenduduk?: number;
    deskripsi?: string;
    batasWilayah?: string;
    images?: string[];
    suggestions?: string[];
  }) {
    return this.prisma.district.create({
      data,
    });
  }

  async updateDistrict(
    id: string,
    data: {
      name?: string;
      latitude?: number;
      longitude?: number;
      aliases?: string[];
      luasWilayah?: number;
      jumlahPenduduk?: number;
      deskripsi?: string;
      batasWilayah?: string;
      images?: string[];
      suggestions?: string[];
    },
  ) {
    await this.getDistrictById(id);
    return this.prisma.district.update({
      where: { id },
      data,
    });
  }

  async deleteDistrict(id: string) {
    await this.getDistrictById(id);
    return this.prisma.district.delete({
      where: { id },
    });
  }

  async getDistrictById(id: string) {
    const dist = await this.prisma.district.findUnique({ where: { id } });
    if (!dist) throw new NotFoundException('Distrik tidak ditemukan.');
    return dist;
  }

  // ==========================================
  // 4. User Management CRUD (Untuk Admin)
  // ==========================================
  async getAllUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        nip: true,
        fullName: true,
        role: true,
        opdId: true,
        opd: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdAt: true,
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async createUser(data: { nip: string; fullName: string; role: 'ADMIN' | 'USER'; opdId?: string; password?: string }) {
    const exists = await this.prisma.user.findUnique({ where: { nip: data.nip } });
    if (exists) {
      throw new BadRequestException('NIP sudah terdaftar.');
    }
    const defaultPassword = data.password || 'password123';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    
    return this.prisma.user.create({
      data: {
        nip: data.nip,
        fullName: data.fullName,
        role: data.role,
        opdId: data.opdId || null,
        passwordHash,
      },
      select: {
        id: true,
        nip: true,
        fullName: true,
        role: true,
        opdId: true,
      },
    });
  }

  async updateUser(id: string, data: { fullName?: string; role?: 'ADMIN' | 'USER'; opdId?: string | null; password?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User tidak ditemukan.');

    const updatePayload: any = {};
    if (data.fullName !== undefined) updatePayload.fullName = data.fullName;
    if (data.role !== undefined) updatePayload.role = data.role;
    if (data.opdId !== undefined) updatePayload.opdId = data.opdId;
    if (data.password) {
      updatePayload.passwordHash = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: updatePayload,
      select: {
        id: true,
        nip: true,
        fullName: true,
        role: true,
        opdId: true,
      },
    });
  }

  async deleteUser(id: string, currentAdminId: string) {
    if (id === currentAdminId) {
      throw new BadRequestException('Anda tidak dapat menghapus akun Anda sendiri.');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User tidak ditemukan.');
    return this.prisma.user.delete({
      where: { id },
    });
  }
}
