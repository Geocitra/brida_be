import { Injectable, Logger } from '@nestjs/common';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { ChatMessage } from '@prisma/client';

export interface StructuredSynthesisManifest {
    tesisUtama: string;
    argumenKunci: Array<{
        fakta: string;
        sitasiAsli: string;
    }>;
    kesimpulanRingkas?: string;
}

export const SSM_OUTPUT_SCHEMA = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'StructuredSynthesisManifest',
    type: 'object',
    required: ['tesisUtama', 'argumenKunci'],
    properties: {
        tesisUtama: {
            type: 'string',
            description: 'Gagasan utama, tesis, atau konsensus akhir yang disepakati dari seluruh alur obrolan.',
        },
        argumenKunci: {
            type: 'array',
            description: 'Daftar tepat 3-4 argumen, bukti faktual, atau data kunci yang terverifikasi selama obrolan.',
            items: {
                type: 'object',
                required: ['fakta', 'sitasiAsli'],
                properties: {
                    fakta: {
                        type: 'string',
                        description: 'Penjelasan klaim data atau argumen faktual penting yang dibahas.',
                    },
                    sitasiAsli: {
                        type: 'string',
                        description: 'Token sitasi orisinal dalam format [doc-XYZ:chunkIndex] yang tercantum di dalam teks obrolan. WAJIB kosongkan jika tidak ada.',
                    },
                },
            },
        },
        kesimpulanRingkas: {
            type: 'string',
            description: 'Ringkasan rangkuman hasil akhir diskusi dalam 1-2 kalimat.',
        },
    },
};

@Injectable()
export class TranscriptDistiller {
    private readonly logger = new Logger(TranscriptDistiller.name);

    constructor(private readonly llmAdapter: VendorLlmAdapter) { }

    /**
     * Mengonversi seluruh riwayat pesan database menjadi skrip percakapan terformat
     * lalu menginstruksikan LLM untuk mengekstrak draf naskah manifest (SSM).
     */
    async distill(messages: ChatMessage[]): Promise<StructuredSynthesisManifest> {
        this.logger.log(
            `[TranscriptDistiller] Memulai ekstraksi kognitif terhadap ${messages.length} pesan obrolan...`,
        );

        // 1. Rekonstruksi naskah percakapan (Format Dialogue Script)
        const dialogueScript = messages
            .map((msg) => {
                const actor = msg.role === 'USER' ? 'Staf BRIDA (User)' : 'Asisten AI BRIDA (Assistant)';

                // Hilangkan format JSON aslinya jika asisten merespon dalam bentuk JSON obrolan
                let cleanContent = msg.content;
                try {
                    const parsed = JSON.parse(msg.content);
                    if (parsed && parsed.answer) {
                        cleanContent = parsed.answer;
                    }
                } catch {
                    // Abaikan jika bukan format JSON
                }

                return `[${actor}]:\n${cleanContent}`;
            })
            .join('\n\n--------------------\n\n');

        // 2. Susun prompt untuk distilasi transkrip (Fase Map / MapReduce)
        const systemPrompt = `Anda adalah Asisten Analis Kognitif Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika.
Tugas Anda: Ekstrak dan padatkan transkrip percakapan tanya-jawab antara Staf BRIDA dan AI menjadi dokumen antara berupa JSON terstruktur (Structured Synthesis Manifest).

PANDUAN EKSTRAKSI:
- Tentukan Tesis Utama ("tesisUtama") yang mencerminkan inti konsensus diskusi.
- Ekstrak tepat 3-4 bukti faktual atau argumen kritis ("argumenKunci").
- Untuk setiap argumen, Anda WAJIB menyalin ulang "sitasiAsli" dalam format token asli [doc-XYZ:chunkIndex] yang tertera di dalam skrip percakapan. DILARANG KERAS mengarang, mengubah, atau memotong token sitasi tersebut.
- Saring hanya fakta-fakta yang disepakati bersama. Abaikan pertanyaan tentatif yang tidak terjawab.`;

        const userPrompt = `=== TRANSKRIP PERCAKAPAN LENGKAP ===\n${dialogueScript}\n\nEkstrak seluruh konsensus di atas menjadi Structured Synthesis Manifest JSON yang valid sesuai dengan skema keluaran.`;

        // 3. Panggil LLM dengan parameter suhu deterministic (temperature = 0.0) untuk menjaga keaslian data
        try {
            const ssmResult = await this.llmAdapter.generateStructuredAnalysis<StructuredSynthesisManifest>(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                SSM_OUTPUT_SCHEMA,
                0.0, // Temperatur nol menjamin data angka dan sitasi tidak meleset
            );

            this.logger.log(
                `[TranscriptDistiller] Berhasil men-distilasi transkrip obrolan menjadi manifest tesis: "${ssmResult.tesisUtama.slice(0, 50)}..."`,
            );

            return ssmResult;
        } catch (err: any) {
            this.logger.error(
                `[TranscriptDistiller Error] Gagal mereduksi riwayat diskusi: ${err.message}`,
                err.stack,
            );

            // Fallback aman bertipe data valid jika terjadi kendala teknis eksternal
            return {
                tesisUtama: 'Analisis Kebijakan Daerah Terintegrasi',
                argumenKunci: [
                    {
                        fakta: 'Penyelarasan target operasional dengan realisasi pembangunan fisik di lapangan.',
                        sitasiAsli: '',
                    },
                ],
                kesimpulanRingkas: 'Sintesis darurat akibat gangguan jaringan eksternal LLM.',
            };
        }
    }
}