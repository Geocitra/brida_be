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
            description:
                'Gagasan utama, tesis, atau konsensus akhir kebijakan yang disepakati dari seluruh alur obrolan.',
        },
        argumenKunci: {
            type: 'array',
            description:
                'Daftar tepat 3-4 poin gabungan antara diagnosis bukti faktual lampau dan rencana aksi strategis masa depan.',
            items: {
                type: 'object',
                required: ['fakta', 'sitasiAsli'],
                properties: {
                    fakta: {
                        type: 'string',
                        description:
                            'Uraian klaim data faktual atau rumusan rekomendasi aksi strategis ke depan yang dibahas.',
                    },
                    sitasiAsli: {
                        type: 'string',
                        description:
                            'Token sitasi orisinal dalam format [doc-XYZ:chunkIndex] atau [URL] yang tercantum di dalam teks obrolan. WAJIB dikosongkan jika poin berupa usulan rekomendasi masa depan.',
                    },
                },
            },
        },
        kesimpulanRingkas: {
            type: 'string',
            description: 'Ringkasan rangkuman hasil akhir diskusi dan arah kebijakan ke depan dalam 1-2 kalimat.',
        },
    },
};

@Injectable()
export class TranscriptDistiller {
    private readonly logger = new Logger(TranscriptDistiller.name);

    constructor(private readonly llmAdapter: VendorLlmAdapter) { }

    /**
     * Mengonversi seluruh riwayat pesan database menjadi skrip percakapan terformat
     * lalu menginstruksikan LLM untuk mengekstrak draf naskah manifest (SSM) secara temporal-aware.
     */
    async distill(messages: ChatMessage[]): Promise<StructuredSynthesisManifest> {
        this.logger.log(
            `[TranscriptDistiller] Memulai ekstraksi kognitif terhadap ${messages.length} pesan obrolan...`,
        );

        // 1. Rekonstruksi naskah percakapan (Format Dialogue Script)
        const dialogueScript = messages
            .map((msg) => {
                const actor =
                    msg.role === 'USER'
                        ? 'Staf BRIDA (User)'
                        : 'Asisten AI BRIDA (Assistant)';

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

        // 2. Susun prompt untuk distilasi transkrip dengan pemisahan bukti historis vs rekomendasi prospektif
        const systemPrompt = `Anda adalah Asisten Analis Kognitif Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika.
Tugas Anda: Ekstrak dan padatkan transkrip percakapan tanya-jawab antara Staf BRIDA dan AI menjadi dokumen antara berupa JSON terstruktur (Structured Synthesis Manifest / SSM).

PANDUAN EKSTRAKSI DUAL-AXIS (HISTORIS VS PROSPEKTIF):
1. Tentukan Tesis Utama ("tesisUtama") yang merangkum konsensus arah kebijakan dari diskusi.
2. Ekstrak tepat 3-4 poin kunci ("argumenKunci") dengan pembagian tegas:
   - KELOMPOK EVALUASI FAKTUAL (Retrospektif): Catat bukti data, angka realisasi, atau hambatan yang terjadi di periode evaluasi lampau. Wajib sertakan "sitasiAsli" ([docId:chunkIndex] / [URL]) yang tertera pada transkrip.
   - KELOMPOK REKOMENDASI KEBIJAKAN (Prospektif): Catat usulan solusi, langkah cepat (Quick Wins), atau mitigasi risiko yang disepakati untuk dieksekusi pada periode MASA DEPAN (semester mendatang). Kosongkan "sitasiAsli" jika poin merupakan usulan aksi baru.
3. DILARANG KERAS merumuskan rekomendasi aksi mundur ke masa yang sudah selesai.
4. Saring hanya fakta dan kesepakatan yang valid. Abaikan pertanyaan tentatif pengguna yang tidak terjawab.`;

        const userPrompt = `=== TRANSKRIP PERCAKAPAN LENGKAP ===\n${dialogueScript}\n\nEkstrak seluruh konsensus di atas menjadi Structured Synthesis Manifest JSON yang valid sesuai dengan skema keluaran.`;

        // 3. Panggil LLM dengan parameter suhu deterministic (temperature = 0.0) untuk menjaga keaslian data
        try {
            const ssmResult =
                await this.llmAdapter.generateStructuredAnalysis<StructuredSynthesisManifest>(
                    [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    SSM_OUTPUT_SCHEMA,
                    0.0, // Temperatur nol menjamin data angka dan sitasi tidak meleset
                );

            this.logger.log(
                `[TranscriptDistiller] Berhasil men-distilasi transkrip obrolan menjadi manifest tesis: "${ssmResult.tesisUtama.slice(
                    0,
                    50,
                )}..."`,
            );

            return ssmResult;
        } catch (err: any) {
            this.logger.error(
                `[TranscriptDistiller Error] Gagal mereduksi riwayat diskusi: ${err.message}`,
                err.stack,
            );

            // Fallback aman bertipe data valid jika terjadi kendala teknis eksternal
            return {
                tesisUtama: 'Analisis Kebijakan Pembangunan Daerah Terintegrasi',
                argumenKunci: [
                    {
                        fakta:
                            'Evaluasi capaian indikator pembangunan fisik dan realisasi fiskal pada periode laporan lampau.',
                        sitasiAsli: '',
                    },
                    {
                        fakta:
                            'Akselerasi mitigasi risiko operasional dan penajaman program prioritas untuk semester mendatang.',
                        sitasiAsli: '',
                    },
                ],
                kesimpulanRingkas:
                    'Sintesis darurat konsensus kebijakan akibat gangguan jaringan eksternal LLM.',
            };
        }
    }
}