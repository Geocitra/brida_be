import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import * as dns from 'dns';
import { promisify } from 'util';

const lookupAsync = promisify(dns.lookup);

export interface ScrapeResult {
    title: string;
    cleanText: string;
    sourceUrl: string;
    wordCount: number;
}

@Injectable()
export class UrlScraperService {
    private readonly logger = new Logger(UrlScraperService.name);

    // Batasan anggaran token transien: Maksimal 2.500 kata hasil scraping untuk menjaga stabilitas memori LLM
    private readonly MAX_WORD_LIMIT = 2500;

    /**
     * Mengunduh halaman web, men-sanitasi HTML, mengekstrak teks bersih, dan memvalidasi keamanan SSRF
     */
    async scrapeAndExtract(url: string): Promise<ScrapeResult> {
        this.logger.log(`[UrlScraper] Memulai proses verifikasi dan penarikan URL: ${url}`);

        try {
            const parsedUrl = new URL(url);

            // Keamanan Tahap 1: Validasi Protokol (Hanya mengizinkan HTTP dan HTTPS)
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                throw new BadRequestException('Protokol URL tidak diizinkan. Gunakan http atau https.');
            }

            // Keamanan Tahap 2: Proteksi SSRF (Resolusi DNS & Pemeriksaan IP Privat/Lokal)
            const resolvedDns = await lookupAsync(parsedUrl.hostname);
            const targetIp = resolvedDns.address;

            if (this.isPrivateOrLocalIp(targetIp)) {
                this.logger.warn(`[SSRF ALERT] Deteksi alamat IP privat/lokal: ${targetIp} pada domain ${parsedUrl.hostname}`);
                throw new BadRequestException('Koneksi ditolak: Akses ke alamat IP lokal/privat dilarang demi keamanan server.');
            }

            // Pengambilan Data dengan Timeout (Protected Variations)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // Batas maksimal fetch 6 detik

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Googlebot-Image/1.0)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new BadRequestException(`Gagal mengunduh halaman web. Server eksternal merespon dengan kode: ${response.status}`);
            }

            const rawHtml = await response.text();
            const extractedTitle = this.extractTitle(rawHtml, parsedUrl.hostname);
            const cleanContentText = this.sanitizeAndExtractText(rawHtml);

            // Potong teks jika melampaui batas anggaran kata untuk menghemat token
            const wordCount = cleanContentText.split(/\s+/).length;
            const finalizedText = this.truncateToWordLimit(cleanContentText, this.MAX_WORD_LIMIT);

            this.logger.log(`[UrlScraper] Berhasil mengunduh & men-sanitasi '${extractedTitle}' (${wordCount} kata).`);

            return {
                title: extractedTitle,
                cleanText: finalizedText,
                sourceUrl: url,
                wordCount: Math.min(wordCount, this.MAX_WORD_LIMIT),
            };
        } catch (err: any) {
            if (err.name === 'AbortError') {
                this.logger.error(`[Scraper Timeout] Koneksi ke ${url} melebihi batas waktu tunggu.`);
                throw new InternalServerErrorException('Waktu tunggu habis saat menghubungi server eksternal.');
            }
            if (err instanceof BadRequestException) {
                throw err;
            }
            this.logger.error(`[Scraper Failed] Gagal melakukan scraping pada ${url}: ${err.message}`);
            throw new InternalServerErrorException(`Sistem gagal mengekstrak konten web: ${err.message}`);
        }
    }

    /**
     * Mengecek apakah IP hasil resolusi DNS mengarah ke rentang IP privat/lokal (RFC 1918)
     */
    private isPrivateOrLocalIp(ip: string): boolean {
        // IPv4 Regex parser
        const ipv4Regex = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
        const match = ip.match(ipv4Regex);

        if (match) {
            const [, oct1, oct2] = match.map(Number);
            // Loopback (127.0.0.0/8)
            if (oct1 === 127) return true;
            // Private Class A (10.0.0.0/8)
            if (oct1 === 10) return true;
            // Private Class B (172.16.0.0/12)
            if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return true;
            // Private Class C (192.168.0.0/16)
            if (oct1 === 192 && oct2 === 168) return true;
            // Link-Local (169.254.0.0/16)
            if (oct1 === 169 && oct2 === 254) return true;
            return false;
        }

        // IPv6 Private & Local checks
        const cleanIp = ip.toLowerCase();
        if (
            cleanIp === '::1' ||
            cleanIp.startsWith('fe80:') ||
            cleanIp.startsWith('fc00:') ||
            cleanIp.startsWith('fd00:')
        ) {
            return true;
        }

        return false;
    }

    /**
     * Mengekstrak judul halaman dari tag <title>
     */
    private extractTitle(html: string, fallback: string): string {
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        if (titleMatch && titleMatch[1]) {
            return this.decodeHtmlEntities(titleMatch[1].trim());
        }
        return fallback;
    }

    /**
     * Membersihkan boilerplate HTML (script, style, nav, footer, dll.) dan mengekstrak paragraf murni
     */
    private sanitizeAndExtractText(html: string): string {
        // 1. Buang tag-tag non-konten secara agresif menggunakan Regex
        let cleaned = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
            .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

        // 2. Ekstrak isi tag-tag teks struktural (paragraf, judul, poin-poin)
        const textTagRegex = /<(p|h1|h2|h3|h4|h5|h6|li)[^>]*>([\s\S]*?)<\/\1>/gi;
        const textBlocks: string[] = [];
        let match;

        while ((match = textTagRegex.exec(cleaned)) !== null) {
            let blockText = match[2];

            // Bersihkan semua sisa inline HTML tag di dalam blok
            blockText = blockText.replace(/<[^>]*>/g, '');

            // Dekode entitas HTML umum (&nbsp;, &amp;, dll.)
            blockText = this.decodeHtmlEntities(blockText);

            const trimmed = blockText.trim();
            if (trimmed.length > 10) { // Saring teks yang terlalu pendek agar tidak menangkap remah navigasi
                textBlocks.push(trimmed);
            }
        }

        // 3. Fallback: Jika tidak ditemukan tag standar di atas, lakukan pembersihan teks bodi utama
        if (textBlocks.length === 0) {
            const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/gi.exec(cleaned);
            const bodyContent = bodyMatch ? bodyMatch[1] : cleaned;
            const strippedBody = bodyContent
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            return this.decodeHtmlEntities(strippedBody);
        }

        // Satukan paragraf dengan double-newline standar CommonMark (Setiap paragraf baru menambahkan 1 spasi)
        return textBlocks.join('\n\n');
    }

    /**
     * Menerjemahkan entitas HTML umum menjadi karakter teks asli
     */
    private decodeHtmlEntities(text: string): string {
        return text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Memotong naskah secara rapi jika melebihi batas kata maksimal
     */
    private truncateToWordLimit(text: string, limit: number): string {
        const words = text.split(/\s+/);
        if (words.length <= limit) return text;
        return words.slice(0, limit).join(' ') + '\n\n[Konten eksternal dipotong oleh sistem BRIDA untuk efisiensi token...]';
    }
}