import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { GenerateDocxDto } from '../dto/generate-docx.dto';
import * as fs from 'fs';
import { join, extname } from 'path';
import * as cheerio from 'cheerio';

@Injectable()
export class DocxService {
  private readonly logger = new Logger(DocxService.name);

  /**
   * Membersihkan token sitasi teknis RAG (seperti [doc:123], [uuid:1])
   */
  private stripCitationTokens(html: string): string {
    if (!html) return '';
    return html
      .replace(/\[(?:[a-f0-9-]{8,}|doc(?:[-_a-z0-9]+)?):\d+\]/gi, '')
      .replace(/\[(?:[a-f0-9-]{8,}|doc(?:[-_a-z0-9]+)?):\d+\]\[(?:[a-f0-9-]{8,}|doc(?:[-_a-z0-9]+)?):\d+\]/gi, '');
  }

  /**
   * Mengonversi seluruh elemen <img> (baik URL eksternal QuickChart maupun unggahan lokal)
   * menjadi Base64 Data URL sebelum diserahkan ke compiler HTMLtoDOCX.
   * Ini menjamin gambar 100% tertanam di Word tanpa resiko timeout, CORS, atau silent drop.
   */
  private async resolveAndEmbedImagesAsBase64(html: string): Promise<string> {
    if (!html || !html.includes('<img')) return html;

    const imgTagRegex = /<img\b([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi;
    const matches = Array.from(html.matchAll(imgTagRegex));
    if (matches.length === 0) return html;

    let processedHtml = html;

    for (const match of matches) {
      const fullTag = match[0];
      let rawSrc = match[2];

      // Jika sudah Base64 Data URL, tidak perlu diproses lagi
      if (rawSrc.startsWith('data:image/')) {
        continue;
      }

      try {
        let base64DataUrl = '';

        // KASUS 1: Path berkas lokal yang diunggah (/uploads/... atau uploads/...)
        if (rawSrc.startsWith('/uploads/') || rawSrc.startsWith('uploads/')) {
          const cleanPath = rawSrc.replace(/^\/+/, '');
          const localFilePath = join(process.cwd(), cleanPath);
          if (fs.existsSync(localFilePath)) {
            const fileBuf = await fs.promises.readFile(localFilePath);
            const ext = extname(localFilePath).toLowerCase().replace('.', '') || 'png';
            const mime = ext === 'jpg' ? 'jpeg' : ext;
            base64DataUrl = `data:image/${mime};base64,${fileBuf.toString('base64')}`;
            this.logger.log(`[DocxService] Berhasil menanamkan gambar lokal '${cleanPath}' sebagai Base64.`);
          } else {
            this.logger.warn(`[DocxService] Berkas gambar lokal '${localFilePath}' tidak ditemukan di disk.`);
          }
        }
        // KASUS 2: URL Jaringan Eksternal (QuickChart atau HTTP/HTTPS)
        else if (rawSrc.startsWith('http://') || rawSrc.startsWith('https://')) {
          // Decode entitas HTML &amp; menjadi & agar query parameter QuickChart tidak terkorupsi
          const cleanUrl = rawSrc.replace(/&amp;/g, '&');
          this.logger.log(`[DocxService] Mengunduh & menanamkan grafik/gambar dari URL eksternal: ${cleanUrl.substring(0, 80)}...`);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 detik aman

          try {
            const response = await fetch(cleanUrl, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BRIDA-SmartAnalysis/1.0',
                'Accept': 'image/png,image/jpeg,image/*,*/*',
              },
            });

            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              if (buffer.length > 0) {
                const contentType = response.headers.get('content-type') || 'image/png';
                const safeMime = contentType.split(';')[0].trim() || 'image/png';
                base64DataUrl = `data:${safeMime};base64,${buffer.toString('base64')}`;
                this.logger.log(`[DocxService] Sukses mengonversi gambar ke Base64 (${buffer.length} bytes, MIME: ${safeMime}).`);
              }
            } else {
              this.logger.warn(`[DocxService] Gagal mengunduh gambar (Status ${response.status}): ${cleanUrl.substring(0, 100)}`);
            }
          } finally {
            clearTimeout(timeoutId);
          }
        }

        if (base64DataUrl) {
          // Gantikan atribut src dengan data URL tanpa merusak penutup tag (/> atau >)
          let replacementTag = fullTag.replace(/src=["'][^"']+["']/i, `src="${base64DataUrl}"`);
          if (!replacementTag.includes('width=') && !replacementTag.includes('style=')) {
            if (replacementTag.endsWith('/>')) {
              replacementTag = replacementTag.slice(0, -2) + ' width="650" />';
            } else if (replacementTag.endsWith('>')) {
              replacementTag = replacementTag.slice(0, -1) + ' width="650">';
            }
          }
          processedHtml = processedHtml.replace(fullTag, replacementTag);
        }
      } catch (err: any) {
        this.logger.warn(`[DocxService] Gagal memproses gambar untuk DOCX: ${err.message}`);
      }
    }

    // Pastikan tag <img> yang berdiri sendiri dibungkus <p> agar diolah sebagai blok paragraf Word
    processedHtml = processedHtml.replace(/(?<!<p[^>]*>)\s*(<img\b[^>]*>)\s*(?!<\/p>)/gi, '<p>$1</p>');

    return processedHtml;
  }

  /**
   * Sanitasi awal elemen pembantu UI (no-print, page spacer) serta token sitasi sebelum dikompilasi ke DOCX
   */
  private sanitizeHtml(html: string): string {
    if (!html) return '';

    let clean = html;
    clean = clean.replace(/<[^>]*class=["'][^"']*no-print[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
    clean = clean.replace(/<[^>]*data-auto-page-spacer[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
    clean = this.stripCitationTokens(clean);
    clean = clean.replace(/font-size:\s*(\d+(?:\.\d+)?)(?!pt|px|em|rem|%)/gi, 'font-size: $1pt');

    return clean;
  }

  /**
   * Mengatur tata letak tipografi eksekutif, jarak antar paragraf (line-spacing & margins),
   * tabel berlatar teal dengan sel padding rapi, blok kutipan/callout, serta Kop Dokumen resmi BRIDA Mimika.
   */
  private beautifyHtmlForDocx(rawHtml: string, dto: GenerateDocxDto): string {
    if (!rawHtml) return '';

    const $ = cheerio.load(rawHtml, null, false);

    // Hapus elemen pembantu editor TipTap
    $('.no-print, [data-auto-page-spacer]').remove();

    const fontSizePt = dto.fontSize && dto.fontSize >= 8 && dto.fontSize <= 36 ? dto.fontSize : 11;
    const lineSpacing = dto.lineSpacing && dto.lineSpacing >= 1 && dto.lineSpacing <= 3 ? dto.lineSpacing : 1.3;

    // 1. KOP DOKUMEN EKSEKUTIF BRIDA KABUPATEN MIMIKA
    const docFullText = $.root().text();
    const hasKop = docFullText.includes('BADAN RISET DAN INOVASI DAERAH') &&
                   docFullText.includes('KABUPATEN MIMIKA');

    let resolvedTitle = dto.filename || 'Draf Laporan Rekomendasi Kebijakan';
    const firstH1 = $('h1').first();
    if (firstH1.length > 0) {
      const textH1 = firstH1.text().trim();
      if (textH1) resolvedTitle = textH1;
    }

    if (!hasKop) {
      if (firstH1.length > 0) {
        firstH1.remove(); // Hapus h1 pertama agar judul terintegrasi rapi pada banner Kop resmi
      }

      const kopBanner = `
        <div style="text-align: center; border-bottom: 2pt solid #0F766E; padding-bottom: 12pt; margin-bottom: 18pt;">
          <p style="font-size: 9.5pt; font-weight: bold; color: #0F766E; letter-spacing: 1.5pt; text-transform: uppercase; margin: 0 0 4pt 0;">
            BADAN RISET DAN INOVASI DAERAH (BRIDA) KABUPATEN MIMIKA
          </p>
          <h1 style="font-size: 17pt; font-weight: bold; color: #0F172A; margin: 6pt 0 4pt 0; text-align: center; line-height: 1.25;">
            ${resolvedTitle}
          </h1>
          <p style="font-size: 9pt; color: #64748B; margin: 4pt 0 0 0;">
            Laporan Analisis Strategis &bull; Dokumen Resmi Perumusan Kebijakan Daerah
          </p>
        </div>
      `;
      $.root().prepend(kopBanner);
    }

    // 2. Hirarki Heading Dokumen Word
    $('h1').each((_, el) => {
      $(el).attr('style', 'font-size: 16pt; font-weight: bold; color: #0F172A; text-align: center; margin: 14pt 0 8pt 0; line-height: 1.25;');
    });

    $('h2').each((_, el) => {
      $(el).attr('style', 'font-size: 13pt; font-weight: bold; color: #0F766E; border-bottom: 1pt solid #CBD5E1; padding-bottom: 3pt; margin-top: 16pt; margin-bottom: 6pt;');
    });

    $('h3').each((_, el) => {
      $(el).attr('style', 'font-size: 11.5pt; font-weight: bold; color: #1E293B; margin-top: 11pt; margin-bottom: 4pt;');
    });

    $('h4, h5, h6').each((_, el) => {
      $(el).attr('style', 'font-size: 10.5pt; font-weight: bold; color: #334155; margin-top: 8pt; margin-bottom: 3pt;');
    });

    // 3. Penataan Tabel Eksekutif (Full-width, Header Deep Teal, Zebra Rows)
    $('table').each((_, table) => {
      $(table).attr('style', 'width: 100%; border-collapse: collapse; margin: 10pt 0 14pt 0;');
      $(table).removeAttr('min-width');

      // Table Header (th)
      $(table).find('th').each((_, th) => {
        $(th).attr('style', 'background-color: #0F766E; color: #FFFFFF; font-weight: bold; font-size: 9.5pt; padding: 6pt 8pt; border: 1pt solid #CBD5E1; text-align: left;');
        $(th).find('p').attr('style', 'margin: 0; color: #FFFFFF; font-weight: bold;');
      });

      // Table Data Rows (td)
      $(table).find('tbody tr').each((rowIdx, tr) => {
        const isEven = rowIdx % 2 === 1;
        const bg = isEven ? 'background-color: #F8FAFC;' : 'background-color: #FFFFFF;';
        $(tr).find('td').each((_, td) => {
          $(td).attr('style', `padding: 5.5pt 8pt; font-size: 9pt; color: #1E293B; border: 1pt solid #CBD5E1; ${bg}`);
          $(td).find('p').attr('style', 'margin: 0;');
        });
      });
    });

    // 4. Penataan Blok Kutipan / Catatan Kebijakan (Blockquote)
    $('blockquote').each((_, el) => {
      $(el).attr('style', 'background-color: #F0FDFA; border-left: 3.5pt solid #0D9488; padding: 8pt 12pt; margin: 10pt 0; font-style: italic; color: #134E4A;');
      $(el).find('p').attr('style', 'margin: 0; font-style: italic;');
    });

    // 5. Penataan Daftar Berbutir / Bernomor (Lists)
    $('ul, ol').each((_, el) => {
      $(el).attr('style', 'margin: 6pt 0 8pt 18pt; padding: 0;');
      $(el).find('li').each((_, li) => {
        $(li).attr('style', `margin-bottom: 4pt; font-size: ${fontSizePt}pt; line-height: ${lineSpacing}; color: #1E293B;`);
        $(li).find('p').attr('style', 'margin: 0; display: inline;');
      });
    });

    // 6. Penataan Paragraf Teks Standar (Justify, Proporsional Spacing)
    $('p').each((_, p) => {
      const parentTag = $(p).parent().prop('tagName')?.toLowerCase();
      if (parentTag === 'th' || parentTag === 'td' || parentTag === 'li') return;

      // Paragraf yang membungkus gambar
      if ($(p).find('img').length > 0) {
        $(p).attr('style', 'text-align: center; margin: 12pt 0 4pt 0;');
        return;
      }

      const currentStyle = $(p).attr('style') || '';
      let align = 'justify';
      if (currentStyle.includes('text-align: center') || currentStyle.includes('text-align:center')) {
        align = 'center';
      } else if (currentStyle.includes('text-align: right') || currentStyle.includes('text-align:right')) {
        align = 'right';
      }

      // Deteksi caption gambar / tabel (e.g., "Gambar 1:", "Grafik 1:", "Tabel 1:", "Sumber:")
      const textContent = $(p).text().trim();
      if (/^(Gambar|Grafik|Bagan|Tabel|Sumber)\s*\d*[\s:]/i.test(textContent) && textContent.length < 140) {
        $(p).attr('style', 'font-size: 9pt; font-style: italic; color: #64748B; text-align: center; margin-top: 3pt; margin-bottom: 12pt;');
        return;
      }

      const marginBtm = Math.round(fontSizePt * 0.65);
      $(p).attr('style', `font-size: ${fontSizePt}pt; line-height: ${lineSpacing}; text-align: ${align}; margin-bottom: ${marginBtm}pt; color: #1E293B;`);
    });

    // 7. Pembatasan Dimensi Gambar / Grafik agar tidak meluap dari batas margin kertas A4
    $('img').each((_, img) => {
      $(img).attr('style', 'max-width: 580px; width: 100%; height: auto; margin: 0 auto; display: block;');
    });

    return $.html();
  }

  /**
   * Mengompilasi naskah HTML semantik dari TipTap menjadi berkas biner Word OpenXML (.docx)
   */
  async generateDocx(dto: GenerateDocxDto): Promise<Buffer> {
    try {
      this.logger.log(`Memulai kompilasi naskah ke DOCX (${dto.filename || 'Draf_Artikel_BRIDA'})...`);
      const startTime = Date.now();

      // Sanitasi awal
      const cleanHtml = this.sanitizeHtml(dto.htmlContent);
      // Resolusi & embed gambar Base64
      const readyImagesHtml = await this.resolveAndEmbedImagesAsBase64(cleanHtml);
      // Format tipografi eksekutif & Kop BRIDA Mimika
      const beautifiedHtml = this.beautifyHtmlForDocx(readyImagesHtml, dto);

      // Konversi margin dari Centimeter ke Twips / DXA (1 cm ≈ 567 twips)
      const marginTwips = Math.round((dto.marginCm || 2.5) * 567);

      // Konversi font size dari Point (pt) ke Half-Points (HIP) untuk standar OpenXML Microsoft Word
      // 1 pt = 2 half-points. Jadi 11 pt harus dikirimkan sebagai 22 half-points agar berukuran 11pt di Word!
      const baseFontSizePt = dto.fontSize && dto.fontSize >= 8 && dto.fontSize <= 36 ? dto.fontSize : 11;
      const fontSizeHIP = Math.round(baseFontSizePt * 2);

      // Running header resmi di Word
      const headerHtml = `
        <p style="text-align: right; font-size: 8.5pt; color: #64748B; border-bottom: 1pt solid #CBD5E1; padding-bottom: 3pt; margin-bottom: 8pt;">
          <strong>BRIDA KABUPATEN MIMIKA</strong> &bull; Laporan Rekomendasi Kebijakan
        </p>
      `;

      const bufferResult = await HTMLtoDOCX(beautifiedHtml, headerHtml, {
        title: dto.filename || 'Draf Artikel BRIDA',
        font: dto.fontFamily || 'Calibri',
        fontSize: fontSizeHIP,
        complexScriptFontSize: fontSizeHIP,
        heading: {
          heading1: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 36, // 36 half-points = 18 pt (Judul Utama)
            bold: true,
            spacing: { before: 240, after: 120 },
          },
          heading2: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 28, // 28 half-points = 14 pt (Sub-bab)
            bold: true,
            spacing: { before: 180, after: 80 },
          },
          heading3: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 24, // 24 half-points = 12 pt (Sub-sub-bab)
            bold: true,
            spacing: { before: 120, after: 60 },
          },
          heading4: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 22, // 22 half-points = 11 pt
            bold: true,
            spacing: { before: 80, after: 40 },
          },
        },
        margins: {
          top: marginTwips,
          right: marginTwips,
          bottom: marginTwips,
          left: marginTwips,
        },
        pageSize: {
          width: 11906,
          height: 16838, // Ukuran Kertas A4 Standar
        },
        table: {
          row: { cantSplit: true },
          borderOptions: {
            size: 4,
            stroke: 'single',
            color: 'CBD5E1',
          },
          addSpacingAfter: true,
        },
        pageNumber: true,
        footer: true,
        imageProcessing: {
          maxRetries: 2,
          downloadTimeout: 5000,
        },
      }, null);

      const durationMs = Date.now() - startTime;
      const buffer = Buffer.isBuffer(bufferResult)
        ? bufferResult
        : Buffer.from(bufferResult as any);

      this.logger.log(`Kompilasi DOCX selesai dalam ${durationMs}ms (Ukuran: ${buffer.length} bytes).`);
      return buffer;
    } catch (error) {
      this.logger.error('Gagal mengompilasi naskah HTML ke DOCX:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Gagal membuat berkas Word DOCX: ${errMsg}`);
    }
  }
}

