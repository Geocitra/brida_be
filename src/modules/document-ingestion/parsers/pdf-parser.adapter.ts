import { Injectable, UnprocessableEntityException, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { IDocumentParser, ParsedDocumentOutput } from '../interfaces/document-parser.interface';

@Injectable()
export class PdfParserAdapter implements IDocumentParser {
  private readonly logger = new Logger(PdfParserAdapter.name);

  supports(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async parse(buffer: Buffer): Promise<ParsedDocumentOutput> {
    try {
      const apiKey = process.env.LLAMA_CLOUD_API_KEY;
      if (apiKey && apiKey.trim().length > 0) {
        this.logger.log(`[PdfParserAdapter] Memulai ekstraksi Layout-Aware ke Markdown menggunakan LlamaParse...`);
        const markdownText = await this.extractToMarkdownWithTablePreservation(buffer, apiKey);
        
        if (markdownText && markdownText.trim().length > 0) {
          const estimatedPages = Math.max(1, Math.ceil(markdownText.length / 3000));
          return {
            rawText: markdownText,
            pageCount: estimatedPages,
          };
        }
        this.logger.warn(`[PdfParserAdapter] LlamaParse mengembalikan hasil kosong atau gagal. Jatuh ke parser standar.`);
      }

      this.logger.log(`[PdfParserAdapter] Menggunakan pdf-parse standar.`);
      const data = await pdfParse(buffer);
      const rawText = data.text ? data.text.trim() : '';

      if (!rawText || rawText.length === 0) {
        throw new UnprocessableEntityException(
          'Tidak ada teks yang dapat diekstraksi dari PDF. Dokumen mungkin berupa scan gambar murni tanpa lapisan OCR.',
        );
      }

      this.logger.log(`[PdfParserAdapter] Berhasil mengekstraksi ${data.numpages} halaman PDF (${rawText.length} karakter).`);

      return {
        rawText,
        pageCount: data.numpages || 1,
      };
    } catch (err: any) {
      if (err instanceof UnprocessableEntityException) {
        throw err;
      }
      if (err.message && err.message.toLowerCase().includes('password')) {
        throw new UnprocessableEntityException('PDF terproteksi kata sandi.');
      }
      this.logger.error(`Error pada PdfParserAdapter: ${err.message}`);
      throw new UnprocessableEntityException(`Gagal membaca struktur PDF: ${err.message}`);
    }
  }

  private async extractToMarkdownWithTablePreservation(buffer: Buffer, apiKey: string): Promise<string> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
      formData.append('file', blob, 'document.pdf');

      this.logger.log(`[LlamaParse] Mengunggah dokumen ke LlamaCloud...`);
      const uploadResponse = await fetch('https://api.cloud.llamaindex.ai/api/v2/parse/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Unggah LlamaParse gagal: ${errorText}`);
      }

      const uploadResult: any = await uploadResponse.json();
      const jobId = uploadResult.id;
      this.logger.log(`[LlamaParse] Unggah sukses. Job ID: ${jobId}. Memulai polling status...`);

      let status = 'PENDING';
      let checkResult: any = null;
      const maxRetries = 60; // 2 menit maksimal
      
      for (let i = 0; i < maxRetries; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        
        const checkResponse = await fetch(`https://api.cloud.llamaindex.ai/api/v2/parse/${jobId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });

        if (!checkResponse.ok) {
          throw new Error(`Polling status LlamaParse gagal: ${await checkResponse.text()}`);
        }

        checkResult = await checkResponse.json();
        status = checkResult.status;
        this.logger.log(`[LlamaParse] Polling #${i + 1}: Status = ${status}`);

        if (status === 'SUCCESS') {
          break;
        }
        if (status === 'ERROR') {
          throw new Error(`Job LlamaParse gagal di server: ${checkResult.error || 'Unknown error'}`);
        }
      }

      if (status !== 'SUCCESS') {
        throw new Error('Timeout tercapai saat menunggu proses LlamaParse selesai.');
      }

      this.logger.log(`[LlamaParse] Proses selesai. Mengambil data hasil Markdown...`);
      const markdownResponse = await fetch(`https://api.cloud.llamaindex.ai/api/v2/parse/${jobId}?expand=markdown`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!markdownResponse.ok) {
        throw new Error(`Gagal mengambil hasil markdown: ${await markdownResponse.text()}`);
      }

      const finalResult: any = await markdownResponse.json();
      const markdownText = finalResult.markdown?.full_markdown 
        || finalResult.markdown?.pages?.map((p: any) => p.markdown).join('\n\n')
        || '';

      this.logger.log(`[LlamaParse] Sukses mengambil Markdown (${markdownText.length} karakter).`);
      return markdownText;
    } catch (err: any) {
      this.logger.error(`[LlamaParse Error] Gagal melakukan ekstraksi: ${err.message}`);
      return ''; // Mengembalikan teks kosong agar jatuh ke fallback parser
    }
  }
}
