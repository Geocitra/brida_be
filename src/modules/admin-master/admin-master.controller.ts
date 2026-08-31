import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, HttpCode, HttpStatus, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { AdminMasterService } from './admin-master.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminMasterController {
  constructor(private readonly adminMasterService: AdminMasterService) {}

  // ==========================================
  // 1. OPD (Dinas) Endpoints
  // ==========================================
  @Get('opds')
  @Roles(UserRole.ADMIN, UserRole.USER)
  async getAllOpds() {
    const data = await this.adminMasterService.getAllOpds();
    return { success: true, data };
  }

  @Post('opds')
  async createOpd(@Body() body: { name: string; code: string; headName?: string; headPhone?: string }) {
    const data = await this.adminMasterService.createOpd(body);
    return { success: true, data };
  }

  @Put('opds/:id')
  async updateOpd(@Param('id') id: string, @Body() body: { name?: string; code?: string; headName?: string; headPhone?: string }) {
    const data = await this.adminMasterService.updateOpd(id, body);
    return { success: true, data };
  }

  @Delete('opds/:id')
  async deleteOpd(@Param('id') id: string) {
    await this.adminMasterService.deleteOpd(id);
    return { success: true, message: 'OPD berhasil dihapus.' };
  }

  // ==========================================
  // 2. DocumentCategory Endpoints
  // ==========================================
  @Get('categories')
  @Roles(UserRole.ADMIN, UserRole.USER)
  async getAllCategories() {
    const data = await this.adminMasterService.getAllCategories();
    return { success: true, data };
  }

  @Post('categories')
  async createCategory(@Body() body: { name: string; code: string; description?: string; analyticalRole?: string }) {
    const data = await this.adminMasterService.createCategory(body);
    return { success: true, data };
  }

  @Put('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() body: { name?: string; code?: string; description?: string; analyticalRole?: string }) {
    const data = await this.adminMasterService.updateCategory(id, body);
    return { success: true, data };
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string) {
    await this.adminMasterService.deleteCategory(id);
    return { success: true, message: 'Kategori dokumen berhasil dihapus.' };
  }

  // ==========================================
  // 3. District (Wilayah) Endpoints
  // ==========================================
  @Get('districts')
  async getAllDistricts() {
    const data = await this.adminMasterService.getAllDistricts();
    return { success: true, data };
  }

  @Post('districts')
  async createDistrict(
    @Body()
    body: {
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
    },
  ) {
    const data = await this.adminMasterService.createDistrict(body);
    return { success: true, data };
  }

  @Put('districts/:id')
  async updateDistrict(
    @Param('id') id: string,
    @Body()
    body: {
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
    const data = await this.adminMasterService.updateDistrict(id, body);
    return { success: true, data };
  }

  @Delete('districts/:id')
  async deleteDistrict(@Param('id') id: string) {
    await this.adminMasterService.deleteDistrict(id);
    return { success: true, message: 'Distrik berhasil dihapus.' };
  }

  // ==========================================
  // 4. User Management Endpoints
  // ==========================================
  @Get('users')
  async getAllUsers() {
    const data = await this.adminMasterService.getAllUsers();
    return { success: true, data };
  }

  @Post('users')
  async createUser(@Body() body: { nip: string; fullName: string; role: 'ADMIN' | 'USER'; opdId?: string; password?: string }) {
    const data = await this.adminMasterService.createUser(body);
    return { success: true, data };
  }

  @Put('users/:id')
  async updateUser(@Param('id') id: string, @Body() body: { fullName?: string; role?: 'ADMIN' | 'USER'; opdId?: string | null; password?: string }) {
    const data = await this.adminMasterService.updateUser(id, body);
    return { success: true, data };
  }

  @Delete('users/:id')
  async deleteUser(@Req() req: any, @Param('id') id: string) {
    const currentAdminId = req.user.id;
    await this.adminMasterService.deleteUser(id, currentAdminId);
    return { success: true, message: 'User berhasil dihapus.' };
  }

  @Post('districts/upload-media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
  )
  async uploadDistrictImage(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File gambar wajib diunggah.');
    }
    const extMatch = (file.originalname || '').match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : (file.mimetype.split('/')[1] || 'png');
    const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) ? ext : 'png';
    const filename = `district_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${safeExt}`;

    const mediaDir = join(process.cwd(), 'uploads', 'media');
    if (!existsSync(mediaDir)) {
      mkdirSync(mediaDir, { recursive: true });
    }
    const targetFilePath = join(mediaDir, filename);
    writeFileSync(targetFilePath, file.buffer);

    const relativeUrl = `/uploads/media/${filename}`;
    return {
      success: true,
      data: {
        url: relativeUrl,
      },
    };
  }
}
