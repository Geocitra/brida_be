import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { UrlScraperService } from './url-scraper.service';

export interface SearchQueryResult {
    title: string;
    link: string;
    snippet: string;
    scrapedText?: string;
    relevanceScore?: number;
}

export interface SourceRelevanceEvaluation {
    geographicScore: number;
    indicatorScore: number;
    dataDensityScore: number;
    authorityScore: number;
    totalScore: number;
    isApproved: boolean;
    rejectionReason?: string;
}

@Injectable()
export class WebSearchService {
    private readonly logger = new Logger(WebSearchService.name);

    private readonly TRUSTED_DOMAINS_BOOST = [
        'bps.go.id',
        'go.id',
        'antaranews.com',
        'kompas.com',
        'tempo.co',
        'detik.com',
        'cnbcindonesia.com',
        'katadata.co.id',
        'bisnis.com',
        'kontan.co.id',
        'worldbank.org',
        'undp.org',
    ];

    private readonly BLOCKED_URL_PATTERNS: RegExp[] = [
        /download\.php/i,
        /web-api\.bps\.go\.id/i,
        /\/api\//i,
        /\.pdf$/i,
        /\.xlsx?$/i,
        /\.docx?$/i,
        /\.zip$/i,
        /\.rar$/i,
        /\/download\//i,
        /\/unduh\//i,
        /\/file\//i,
        /article\/download/i,
        /login/i,
    ];

    constructor(
        private readonly configService: ConfigService,
        private readonly llmAdapter: VendorLlmAdapter,
        private readonly urlScraperService: UrlScraperService,
    ) { }

    async extractSearchQueries(rawPrompt: string): Promise<string[]> {
        const preSanitizedPrompt = this.sanitizeMetaPrompt(rawPrompt);

        const mappedQueries = this.resolveMacroeconomicIndicators(rawPrompt);
        if (mappedQueries.length > 0) {
            this.logger.log(`[WebSearch] Intent-to-Indicator Mapping aktif: ${JSON.stringify(mappedQueries)}`);
            return mappedQueries;
        }

        const schema = {
            type: 'object',
            properties: {
                queries: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Daftar 1 sampai 2 kueri pencarian Google: satu kueri fokus pada konteks Kabupaten Mimika/Papua dan satu kueri tolak ukur (benchmark) nasional/kementerian.'
                }
            },
            required: ['queries'],
            additionalProperties: false
        };

        const systemInstructions = `Anda adalah spesialis penelusuran data kebijakan publik daerah dan nasional.
Tugas Anda:
1. Formulasikan 1 sampai maksimal 2 kueri pencarian Google terarah (3-5 kata per kueri).
2. Format: Kueri 1 berfokus pada data daerah (Kabupaten Mimika / Papua), Kueri 2 berfokus pada benchmark nasional atau standar indikator (BPS / Kementerian).
3. Hapus kata perintah meta seperti "buatkan", "tolong", "analisis".
Contoh Input: "Bandingkan stunting nasional dan kemiskinan mimika"
Contoh Output: {"queries": ["Prevalensi Stunting Mimika Papua BPS", "Standar Prevalensi Stunting Nasional Kemenkes"]}`;

        try {
            const llmResult = await this.llmAdapter.generateStructuredAnalysis<{ queries: string[] }>(
                [
                    { role: 'system', content: systemInstructions },
                    { role: 'user', content: `Instruksi Pengguna: "${preSanitizedPrompt}"` }
                ],
                schema,
                0.0
            );

            if (llmResult && Array.isArray(llmResult.queries) && llmResult.queries.length > 0) {
                const cleaned = llmResult.queries
                    .map(q => this.sanitizeQueryString(q))
                    .filter(q => q.length > 0);
                if (cleaned.length > 0) {
                    return cleaned.slice(0, 2);
                }
            }
        } catch (err: any) {
            this.logger.error(`[WebSearch Query Extraction Failed]: ${err.message}`);
        }

        return ['PDRB Kabupaten Mimika BPS', 'Laju Pertumbuhan Ekonomi Nasional BPS'];
    }

    async searchReputableWeb(userQuery: string, limit: number = 4): Promise<SearchQueryResult[]> {
        const apiKey = this.configService.get<string>('SERPER_API_KEY');

        if (!apiKey || apiKey.trim().length === 0) {
            this.logger.warn('[WebSearch] SERPER_API_KEY tidak dikonfigurasi. Mengabaikan web search.');
            return [];
        }

        try {
            const cleanQueries = await this.extractSearchQueries(userQuery);
            this.logger.log(`[WebSearch] Kueri penelusuran dijalankan: ${JSON.stringify(cleanQueries)}`);

            const allCandidates: SearchQueryResult[] = [];
            const visitedUrls = new Set<string>();
            const limitPerQuery = Math.max(2, Math.ceil((limit * 2) / cleanQueries.length));

            for (const query of cleanQueries) {
                this.logger.log(`[WebSearch] Mengirim kueri ke Google Serper: "${query}"`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4500);

                try {
                    const response = await fetch('https://google.serper.dev/search', {
                        method: 'POST',
                        headers: {
                            'X-API-KEY': apiKey,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            q: query,
                            num: limitPerQuery,
                            gl: 'id',
                            hl: 'id',
                        }),
                        signal: controller.signal,
                    });

                    clearTimeout(timeoutId);

                    if (response.ok) {
                        const searchJson = await response.json();
                        const organicResults = searchJson.organic || [];

                        for (const item of organicResults) {
                            const link = item.link || '';
                            if (link && !visitedUrls.has(link) && !this.isBlockedUrl(link)) {
                                visitedUrls.add(link);
                                allCandidates.push({
                                    title: (item.title || 'Artikel Terkait').replace(/\u0000/g, ''),
                                    link: link,
                                    snippet: (item.snippet || '').replace(/\u0000/g, ''),
                                });
                            }
                        }
                    }
                } catch (singleQueryErr: any) {
                    this.logger.error(`[WebSearch Single Query Failed] "${query}": ${singleQueryErr.message}`);
                }
            }

            const candidatesToScrape = allCandidates.slice(0, Math.max(limit, 4));
            this.logger.log(`[WebSearch] Mengunduh & mengevaluasi relevansi ${candidatesToScrape.length} kandidat URL...`);

            const scrapePromises = candidatesToScrape.map(
                async (candidate): Promise<SearchQueryResult | null> => {
                try {
                    const scraped = await this.urlScraperService.scrapeAndExtract(candidate.link);
                    const cleanText = scraped.cleanText;

                    const evaluation = this.evaluateSourceRelevance(
                        candidate.title,
                        cleanText,
                        candidate.link
                    );

                    if (evaluation.isApproved) {
                        return {
                            ...candidate,
                            scrapedText: cleanText,
                            relevanceScore: evaluation.totalScore,
                        };
                    } else {
                        this.logger.warn(`[WebSearch Relevance ✗ REJECTED] ${candidate.link}: ${evaluation.rejectionReason}`);
                        return null;
                    }
                } catch (scrapeErr: any) {
                    const snippetEval = this.evaluateSourceRelevance(
                        candidate.title,
                        candidate.snippet,
                        candidate.link
                    );

                    if (snippetEval.isApproved) {
                        return {
                            ...candidate,
                            relevanceScore: snippetEval.totalScore,
                        };
                    }
                    return null;
                }
            });

            const resolvedResults = await Promise.all(scrapePromises);
            const approvedResults: SearchQueryResult[] = resolvedResults.filter(
                (res): res is SearchQueryResult => res !== null && res !== undefined,
            );

            approvedResults.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

            let finalResults = approvedResults.slice(0, limit);
            if (finalResults.length === 0 && allCandidates.length > 0) {
                this.logger.warn(`[WebSearch Fail-Safe] Menggunakan kandidat teratas sebagai rujukan acuan.`);
                finalResults = allCandidates.slice(0, limit);
            }

            this.logger.log(`[WebSearch Selesai] Berhasil menyajikan ${finalResults.length} sumber rujukan terpercaya.`);
            return finalResults;

        } catch (err: any) {
            this.logger.error(`[WebSearch Failed] Penelusuran web terganggu: ${err.message}`);
            return [];
        }
    }

    evaluateSourceRelevance(
        title: string,
        content: string,
        url: string
    ): SourceRelevanceEvaluation {
        const textToEvaluate = `${title} ${content}`.toLowerCase();
        const urlLower = url.toLowerCase();

        let geographicScore = 0;
        const localGeoKeywords = ['mimika', 'timika', 'papua tengah', 'papua'];
        const nationalGeoKeywords = ['indonesia', 'nasional', 'kementerian', 'bappenas', 'kemenkes', 'kemendagri'];

        for (const geo of localGeoKeywords) {
            if (textToEvaluate.includes(geo)) {
                geographicScore = 35;
                break;
            }
        }
        if (geographicScore === 0) {
            for (const nat of nationalGeoKeywords) {
                if (textToEvaluate.includes(nat)) {
                    geographicScore = 20; // Tetap bernilai untuk tolak ukur nasional
                    break;
                }
            }
        }

        let indicatorScore = 0;
        const indicators = [
            'pdrb', 'penduduk', 'stunting', 'kemiskinan', 'inflasi', 'anggaran', 'apbd',
            'infrastruktur', 'pertumbuhan ekonomi', 'ipm', 'sdm', 'kesehatan', 'pendidikan'
        ];

        let matchCount = 0;
        for (const ind of indicators) {
            if (textToEvaluate.includes(ind)) matchCount++;
        }

        if (matchCount >= 2) indicatorScore = 35;
        else if (matchCount === 1) indicatorScore = 20;

        let dataDensityScore = 0;
        const hasNumbers = /\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b|\b\d+(?:,\d+)?%\b/g.test(content);
        const hasUnits = /(persen|jiwa|miliar|triliun|rupiah|rp|tahun|ton|hektar)/i.test(content);

        if (hasNumbers && hasUnits) dataDensityScore = 15;
        else if (hasNumbers || hasUnits) dataDensityScore = 8;

        let authorityScore = 0;
        for (const domain of this.TRUSTED_DOMAINS_BOOST) {
            if (urlLower.includes(domain)) {
                authorityScore = 15;
                break;
            }
        }

        const isAcademicWritingNoise = /(panduan penulisan skripsi|workshop jurnal ilmiah|pedoman penulisan tesis)/i.test(textToEvaluate);
        if (isAcademicWritingNoise) {
            indicatorScore = 0;
            geographicScore = 0;
        }

        const totalScore = geographicScore + indicatorScore + dataDensityScore + authorityScore;
        const isApproved = totalScore >= 30 && !isAcademicWritingNoise;

        return {
            geographicScore,
            indicatorScore,
            dataDensityScore,
            authorityScore,
            totalScore,
            isApproved,
            rejectionReason: isApproved ? undefined : `Skor tidak memenuhi ambang minimum (${totalScore}/100)`,
        };
    }

    private resolveMacroeconomicIndicators(prompt: string): string[] {
        const pLower = prompt.toLowerCase();
        const queries: string[] = [];

        if (pLower.includes('stunting')) {
            queries.push('Prevalensi Stunting Kabupaten Mimika BPS');
            queries.push('Target Nasional Penurunan Stunting Kemenkes Bappenas');
            return queries;
        }

        if (pLower.includes('pdrb') || pLower.includes('pertumbuhan ekonomi')) {
            queries.push('PDRB Kabupaten Mimika BPS');
            queries.push('Laju Pertumbuhan Ekonomi Nasional BPS');
            return queries;
        }

        if (pLower.includes('kemiskinan') || pLower.includes('ipm')) {
            queries.push('Indeks Pembangunan Manusia Mimika BPS');
            queries.push('Tingkat Kemiskinan Ekstrem Nasional');
            return queries;
        }

        if (pLower.includes('inflasi')) {
            queries.push('Tingkat Inflasi IHK Kabupaten Mimika BPS');
            queries.push('Laju Inflasi Nasional Bank Indonesia');
            return queries;
        }

        return queries;
    }

    private sanitizeMetaPrompt(rawPrompt: string): string {
        return rawPrompt
            .replace(/https?:\/\/[^\s]+/gi, '')
            .replace(/\b(dengan merujuk|pada dokumen acuan|buatkan|buat|tolong|analisa|analisis|buatlah|tulis|tuliskan|laporan|artikel|dari web search|internet|secara lengkap)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private sanitizeQueryString(query: string): string {
        return query
            .replace(/[^\w\s\u00C0-\u017F]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private isBlockedUrl(url: string): boolean {
        for (const pattern of this.BLOCKED_URL_PATTERNS) {
            if (pattern.test(url)) return true;
        }
        return false;
    }
}