import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { UrlScraperService } from './url-scraper.service';

export interface SearchQueryResult {
    title: string;
    link: string;
    snippet: string;
    scrapedText?: string;
}

@Injectable()
export class WebSearchService {
    private readonly logger = new Logger(WebSearchService.name);

    // Kebijakan Whitelist Portal Tepercaya — Pemerintah, Berita Nasional, & Akademik Relevan
    // CATATAN: site:ac.id SENGAJA DIHAPUS karena terlalu luas — menangkap semua jurnal universitas
    // Indonesia tanpa membedakan relevansi topik (ekonomi, statistik, vs penulisan akademik generik).
    // Sebagai gantinya, hanya domain akademik yang spesifik relevan dengan topik ekonomi/statistik yang diizinkan.
    private readonly REPUTABLE_SITES_WHITELIST = [
        'site:go.id',                 // Seluruh portal resmi pemerintah Indonesia (.go.id) — BPS, Kemendag, dll.
        'site:antaranews.com',        // Kantor Berita Negara (LKBN Antara)
        'site:kompas.com',
        'site:tempo.co',
        'site:detik.com',
        'site:cnbcindonesia.com',     // Media ekonomi & bisnis
        'site:tirto.id',
        'site:bisnis.com',            // Media bisnis terkemuka
        'site:kontan.co.id',          // Media ekonomi & pasar modal
        'site:databoks.katadata.co.id', // Agregator data ekonomi & statistik
        'site:papuabaratprov.go.id',  // Pemprov Papua Barat
        'site:papua.go.id',           // Pemprov Papua
    ];

    constructor(
        private readonly configService: ConfigService,
        private readonly llmAdapter: VendorLlmAdapter,
        private readonly urlScraperService: UrlScraperService,
    ) { }

    /**
     * Mengekstrak kueri pencarian yang bersih dan fokus menggunakan LLM
     */
    async extractSearchQueries(rawPrompt: string): Promise<string[]> {
        const schema = {
            type: 'object',
            properties: {
                queries: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Daftar 1 sampai 2 kata kunci pencarian yang sangat terfokus untuk Google Search (misal: "elastisitas PDRB Mimika"). Bersihkan seluruh instruksi meta seperti "buatkan", "tulis", "cari", "web search".'
                }
            },
            required: ['queries'],
            additionalProperties: false
        };

        const systemInstructions = `Anda adalah asisten AI pembuat kueri pencarian Google yang bertugas memformulasikan kata kunci pencarian BERBASIS DATA dari instruksi pengguna.
Tugas Anda:
1. Analisis instruksi pengguna yang diberikan.
2. Identifikasi HANYA data/fakta/statistik eksternal spesifik apa yang perlu dicari (misalnya: proyeksi demografi, data pertumbuhan PDRB, angka inflasi, data BPS, regulasi tertentu).
3. Ekstrak dan susun 1 hingga maksimal 2 kueri pencarian Google yang sangat terfokus dan berbasis DATA (masing-masing 3-6 kata). Prioritaskan pencarian sumber RESMI (BPS, pemerintah, media bisnis/ekonomi).
4. DILARANG KERAS menyertakan kata-kata berikut dalam kueri:
   - Kata perintah penulisan: "buatkan", "tulis", "analisis", "buat", "laporan", "merujuk pada", "sesuai dokumen acuan", "tambahkan data", "dari web search"
   - Kata metodologi generik: "elastisitas formula", "cara menghitung", "rumus", "metode analisis", "kajian teori"
   - Kata generik: "internet", "referensi", "acuan", "sumber"
5. Hasil harus berupa kueri pencarian DATA STATISTIK/EKONOMI mentah untuk mesin pencari.
6. PRIORITASKAN kata kunci yang akan menemukan data numerik konkret dari BPS atau media ekonomi, BUKAN jurnal akademik tentang cara penulisan.
Contoh:
Input: "Dengan merujuk dokumen acuan buatkan analisa penduduk mimika 2030 dan elastisitas PDRB dari web search"
Output BENAR: {"queries": ["PDRB Kabupaten Mimika BPS 2023", "proyeksi penduduk Mimika 2030"]}
Output SALAH: {"queries": ["elastisitas formula ekonomi", "cara menulis artikel jurnal"]}`;

        try {
            const llmResult = await this.llmAdapter.generateStructuredAnalysis<{ queries: string[] }>(
                [
                    { role: 'system', content: systemInstructions },
                    { role: 'user', content: `Instruksi Pengguna: "${rawPrompt}"` }
                ],
                schema,
                0.0 // Sangat deterministik
            );

            if (llmResult && Array.isArray(llmResult.queries) && llmResult.queries.length > 0) {
                const cleaned = llmResult.queries.map(q => q.trim()).filter(q => q.length > 0);
                if (cleaned.length > 0) {
                    return cleaned;
                }
            }
        } catch (err: any) {
            this.logger.error(`[WebSearch Query Extraction Failed] Gagal memformulasi kueri: ${err.message}`);
        }

        // Fallback jika LLM gagal: gunakan kueri mentah yang dibersihkan secara basic
        const basicClean = rawPrompt
            .replace(/https?:\/\/[^\s]+/gi, '')
            .replace(/[^\w\s\u00C0-\u017F]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return [basicClean];
    }

    /**
     * Melakukan pencarian eksternal menggunakan Google Serper API dengan query expansion yang aman
     */
    async searchReputableWeb(userQuery: string, limit: number = 3): Promise<SearchQueryResult[]> {
        const apiKey = this.configService.get<string>('SERPER_API_KEY');

        if (!apiKey || apiKey.trim().length === 0) {
            this.logger.warn('[WebSearch] SERPER_API_KEY tidak dikonfigurasi di file .env. Mengaktifkan fallback pencarian kosong.');
            return [];
        }

        try {
            // 1. Ekstrak kueri-kueri pencarian terfokus menggunakan LLM
            const cleanQueries = await this.extractSearchQueries(userQuery);
            this.logger.log(`[WebSearch] Berhasil mengekstrak kueri pencarian terarah: ${JSON.stringify(cleanQueries)}`);

            const allResults: SearchQueryResult[] = [];
            const visitedUrls = new Set<string>();

            // Gunakan limit per kueri disesuaikan agar total hasil tidak melampaui limit keseluruhan
            const limitPerQuery = Math.max(2, Math.ceil(limit / cleanQueries.length));

            for (const query of cleanQueries) {
                const enrichedQuery = this.formulateEnrichedQuery(query);
                this.logger.log(`[WebSearch] Mengirim kueri proaktif berfilter: ${enrichedQuery}`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000); // Timeout pencarian eksternal maksimal 4 detik per kueri

                try {
                    const response = await fetch('https://google.serper.dev/search', {
                        method: 'POST',
                        headers: {
                            'X-API-KEY': apiKey,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            q: enrichedQuery,
                            num: limitPerQuery,
                            gl: 'id', // Lokasi geografis: Indonesia
                            hl: 'id', // Bahasa: Indonesia
                        }),
                        signal: controller.signal,
                    });

                    clearTimeout(timeoutId);

                    if (response.ok) {
                        const searchJson = await response.json();
                        const organicResults = searchJson.organic || [];

                        for (const item of organicResults) {
                            const link = item.link || '';
                            if (link && !visitedUrls.has(link)) {
                                visitedUrls.add(link);
                                allResults.push({
                                    title: (item.title || 'Artikel Terkait').replace(/\u0000/g, '').replace(/\x00/g, ''),
                                    link: link,
                                    snippet: (item.snippet || '').replace(/\u0000/g, '').replace(/\x00/g, ''),
                                });
                            }
                        }
                    }
                } catch (singleQueryErr: any) {
                    this.logger.error(`[WebSearch Single Query Failed] Gagal mencari kueri "${query}": ${singleQueryErr.message}`);
                }
            }

            const finalResults = allResults.slice(0, limit);

            // Jalankan scraping untuk top 3 hasil pencarian secara paralel agar data lebih utuh
            const topResultsToScrape = finalResults.slice(0, 3);
            const remainingResults = finalResults.slice(3);

            this.logger.log(`[WebSearch] Memulai pengunduhan halaman web untuk ${topResultsToScrape.length} hasil pencarian teratas secara paralel...`);
            const scrapePromises = topResultsToScrape.map(async (res) => {
                try {
                    const scraped = await this.urlScraperService.scrapeAndExtract(res.link);
                    return {
                        ...res,
                        scrapedText: scraped.cleanText,
                    };
                } catch (scrapeErr: any) {
                    this.logger.warn(`[WebSearch Scrape Failed] Gagal menarik konten penuh dari ${res.link}: ${scrapeErr.message}`);
                    return res;
                }
            });

            const scrapedResults = await Promise.all(scrapePromises);
            const enrichedResults = [...scrapedResults, ...remainingResults];

            this.logger.log(`[WebSearch] Sukses mengumpulkan ${enrichedResults.length} hasil pencarian eksternal tervalidasi (dengan ${scrapedResults.filter(r => r.scrapedText).length} konten penuh terunduh).`);
            return enrichedResults;

        } catch (err: any) {
            // Protected Variations: Jika pencarian internet mati/rate-limited, sistem tidak boleh crash
            this.logger.error(`[WebSearch Failed] Pencarian eksternal terganggu (Protected Variations Active): ${err.message}`);
            return []; // Mengembalikan array kosong agar sistem tetap menyajikan data lokal secara anggun
        }
    }

    /**
     * Memformulasikan kueri pencarian dengan teknik Query Expansion untuk menyaring domain terpercaya
     */
    private formulateEnrichedQuery(userQuery: string): string {
        // Bersihkan kueri dari karakter tanda baca aneh untuk mencegah sintaks pencarian rusak
        const sanitizedQuery = userQuery
            .replace(/[^\w\s\u00C0-\u017F]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (sanitizedQuery.length === 0) {
            return 'Kabupaten Mimika';
        }

        // Bangun ekspresi filter: kueri (site:A OR site:B OR site:C)
        const siteFilters = `(${this.REPUTABLE_SITES_WHITELIST.join(' OR ')})`;

        return `${sanitizedQuery} ${siteFilters}`;
    }
}