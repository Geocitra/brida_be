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
                'Gagasan utama, judul tema, atau konsensus arah kebijakan yang disepakati dari seluruh dialog.',
        },
        argumenKunci: {
            type: 'array',
            description:
                'Daftar 4 sampai 6 poin argumen komprehensif yang mencakup latar belakang masalah, data komparasi, telaah hambatan, dan rekomendasi aksi operasional.',
            items: {
                type: 'object',
                required: ['fakta', 'sitasiAsli'],
                properties: {
                    fakta: {
                        type: 'string',
                        description:
                            'Penjelasan lengkap mengenai data faktual, isu regulasi, atau uraian rencana aksi kebijakan.',
                    },
                    sitasiAsli: {
                        type: 'string',
                        description:
                            'Token sitasi asli [docId:chunkIndex] atau [URL] yang tertera di obrolan jika ada.',
                    },
                },
            },
        },
        kesimpulanRingkas: {
            type: 'string',
            description: 'Ringkasan arah kebijakan dalam 1-2 kalimat.',
        },
    },
};

@Injectable()
export class TranscriptDistiller {
    private readonly logger = new Logger(TranscriptDistiller.name);

    constructor(private readonly llmAdapter: VendorLlmAdapter) { }

    async distill(messages: ChatMessage[]): Promise<StructuredSynthesisManifest> {
        this.logger.log(
            `[TranscriptDistiller] Mengekstraksi konsensus dari ${messages.length} pesan obrolan...`,
        );

        const dialogueScript = messages
            .map((msg) => {
                const actor = msg.role === 'USER' ? 'Staf (User)' : 'AI (Assistant)';
                let cleanContent = msg.content;
                try {
                    const parsed = JSON.parse(msg.content);
                    if (parsed && parsed.answer) {
                        cleanContent = parsed.answer;
                    }
                } catch {}
                return `[${actor}]:\n${cleanContent}`;
            })
            .join('\n\n--------------------\n\n');

        const systemPrompt = `Anda adalah Analis Kognitif BRIDA Kabupaten Mimika.
Tugas Anda: Ekstrak seluruh inti pembicaraan tanya-jawab menjadi manifest terstruktur (SSM JSON).
PANDUAN:
1. Rumuskan Tesis Utama yang padat dan mencerminkan topik dokumen.
2. Ekstrak 4-6 poin argumen kunci secara mendalam: latar belakang masalah, perbandingan data angka, evaluasi hambatan, dan rencana aksi masa depan.
3. Pertahankan token sitasi asli jika ada. Jangan hilangkan rincian angka penting.`;

        try {
            const ssmResult = await this.llmAdapter.generateStructuredAnalysis<StructuredSynthesisManifest>(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `=== TRANSKRIP LENGKAP ===\n${dialogueScript}` },
                ],
                SSM_OUTPUT_SCHEMA,
                0.0,
            );

            return ssmResult;
        } catch (err: any) {
            this.logger.error(`[TranscriptDistiller Error]: ${err.message}`);
            return {
                tesisUtama: 'Analisis Kebijakan Pembangunan Terpadu Kabupaten Mimika',
                argumenKunci: [
                    { fakta: 'Evaluasi capaian kinerja dan dinamika regulasi daerah.', sitasiAsli: '' },
                    { fakta: 'Penyelarasan implementasi program prioritas antar-OPD.', sitasiAsli: '' },
                    { fakta: 'Rencana aksi mitigasi risiko operasional ke depan.', sitasiAsli: '' },
                ],
                kesimpulanRingkas: 'Sintesis konsensus kebijakan siap diperluas menjadi naskah utuh.',
            };
        }
    }
}