import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SearchQueryResult {
    title: string;
    link: string;
    snippet: string;
}

@Injectable()
export class WebSearchService {
    private readonly logger = new Logger(WebSearchService.name);

    // Kebijakan Whitelist Portal Tepercaya Dewan Pers & Instansi Negara Indonesia
    private readonly REPUTABLE_SITES_WHITELIST = [
        'site:antaranews.com',
        'site:kompas.com',
        'site:tempo.co',
        'site:republika.co.id',
        'site:detik.com',
        'site:cnbcindonesia.com',
        'site:bps.go.id',
        'site:bappenas.go.id',
        'site:kemkes.go.id',
        'site:kemendagri.go.id',
        'site:sinta.kemdikbud.go.id',
        'site:garuda.kemdikbud.go.id'
    ];

    constructor(private readonly configService: ConfigService) { }

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
            const enrichedQuery = this.formulateEnrichedQuery(userQuery);
            this.logger.log(`[WebSearch] Mengirim kueri proaktif berfilter: ${enrichedQuery}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // Timeout pencarian eksternal maksimal 5 detik

            const response = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    q: enrichedQuery,
                    num: limit,
                    gl: 'id', // Lokasi geografis: Indonesia
                    hl: 'id', // Bahasa: Indonesia
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Koneksi ke Serper API ditolak dengan status: ${response.status}`);
            }

            const searchJson = await response.json();
            const organicResults = searchJson.organic || [];

            const parsedResults: SearchQueryResult[] = organicResults.map((item: any) => ({
                title: item.title || 'Artikel Terkait',
                link: item.link || '',
                snippet: item.snippet || '',
            })).filter((item: any) => item.link.length > 0);

            this.logger.log(`[WebSearch] Sukses mengumpulkan ${parsedResults.length} hasil pencarian eksternal tervalidasi.`);
            return parsedResults;

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

        // Bangun ekspresi filter: "kueri" (site:A OR site:B OR site:C)
        const siteFilters = `(${this.REPUTABLE_SITES_WHITELIST.join(' OR ')})`;

        return `"${sanitizedQuery}" ${siteFilters}`;
    }
}