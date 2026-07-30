import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const defaultNip = '197804122003121002';
  const defaultName = 'Darius Sabon Rain, S.E., M.Ec.Dev.';
  const rawPassword = 'password123'; // Password default yang jelas untuk Kepala BRIDA

  console.log('[Seeder] Memulai proses seeding akun Kepala BRIDA...');

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(rawPassword, saltRounds);

  // Gunakan upsert agar jika data sudah ada, sistem hanya memperbarui (tidak error duplikat)
  const executive = await prisma.executiveUser.upsert({
    where: { nip: defaultNip },
    update: {
      fullName: defaultName,
      passwordHash,
    },
    create: {
      nip: defaultNip,
      fullName: defaultName,
      passwordHash,
    },
  });

  console.log(`[Seeder Success] Akun Kepala BRIDA berhasil diamankan ke database:`);
  console.log(` - NIP      : ${executive.nip}`);
  console.log(` - Nama     : ${executive.fullName}`);
  console.log(` - Password : ${rawPassword} (Gunakan ini untuk login)`);
}

main()
  .catch((e) => {
    console.error('[Seeder Error] Terjadi kesalahan saat seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });