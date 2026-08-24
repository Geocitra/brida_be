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
    geographicScore: number;  // 0 - 35 (Kesesuaian wilayah: Mimika, Timika, Papua)
    indicatorScore: number;   // 0 - 35 (Kesesuaian indikator: PDRB, Penduduk, Ekonomi)
    dataDensityScore: number; // 0 - 15 (Keberadaan data numerik, persentase %, nominal)
    authorityScore: number;   // 0 - 15 (Otoritas domain: BPS, Pemkab, Media Bisnis)
    totalScore: number;       // 0 - 100
    isApproved: boolean;      // True jika memenuhi ambang batas relevansi minimum
    rejectionReason?: string;
}

@Injectable()
export class WebSearchService {
    private readonly logger = new Logger(WebSearchService.name);

    // Kebijakan Whitelist Portal Tepercaya — Portal Resmi Pemerintah & Media Bisnis/Ekonomi Nasional
    private readonly REPUTABLE_SITES_WHITELIST = [
        'site:bps.go.id',             // Seluruh portal Badan Pusat Statistik (Nasional, Provinsi, Kabupaten)
        'site:go.id',                 // Seluruh portal kementerian/lembaga & pemda resmi (.go.id)
        'site:antaranews.com',        // Kantor Berita Negara (LKBN Antara)
        'site:kompas.com',
        'site:tempo.co',
        'site:detik.com',
        'site:cnbcindonesia.com',     // Media ekonomi & bisnis
        'site:tirto.id',
        'site:bisnis.com',            // Media bisnis terkemuka
        'site:kontan.co.id',          // Media ekonomi & pasar modal
        'site:databoks.katadata.co.id', // Agregator data ekonomi & statistik resmi
        'site:papuabaratprov.go.id',  // Pemprov Papua Barat
        'site:papua.go.id',           // Pemprov Papua
    ];

    // Pola URL yang DILARANG MUTLAK — endpoint download dinamis, API internal, file biner
    private readonly BLOCKED_URL_PATTERNS: RegExp[] = [
        /download\.php/i,              // Endpoint download terenkripsi BPS yang rentan token error
        /web-api\.bps\.go\.id/i,       // API internal BPS (bukan halaman publik permanen)
        /\/api\//i,                    // Endpoint API mentah
        /\.pdf$/i,                     // File PDF langsung
        /\.xlsx?$/i,                   // File Excel
        /\.docx?$/i,                   // File Word
        /\.zip$/i,                     // File arsip
        /\.rar$/i,                     // File arsip
        /\/download\//i,              // Path download generik
        /\/unduh\//i,                  // Path unduh (Indonesia)
        /\/file\//i,                   // Path file langsung
        /article\/download/i,          // Endpoint download jurnal OJS
        /login/i,                      // Laman login/autentikasi
    ];

    constructor(
        private readonly configService: ConfigService,
        private readonly llmAdapter: VendorLlmAdapter,
        private readonly urlScraperService: UrlScraperService,
    ) { }

    /**
     * Mengekstrak dan memformulasikan kueri pencarian statistik berstandar enterprise.
     * Menggabungkan Intent-to-Indicator Mapping dan LLM Query Formulation.
     */
    async extractSearchQueries(rawPrompt: string): Promise<string[]> {
        // 1. Sanitasi Deterministik: Buang seluruh kata instruksi penulisan dan meta-prompt
        const preSanitizedPrompt = this.sanitizeMetaPrompt(rawPrompt);

        // 2. Intent-to-Indicator Mapping: Deteksi konsep makroekonomi spesifik
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
                    description: 'Daftar 1 sampai 2 kata kunci pencarian Google berfokus pada data statistik resmi BPS/pemerintah daerah.'
                }
            },
            required: ['queries'],
            additionalProperties: false
        };

        const systemInstructions = `Anda adalah asisten AI spesialis ekstraksi kata kunci pencarian statistik pemerintahan daerah (BPS & BRIDA).
Tugas Anda:
1. Analisis kebutuhan data eksternal pengguna.
2. Formulasikan 1 hingga maksimal 2 kueri pencarian Google murni berbasis data (3-5 kata per kueri).
3. Format Kueri Wajib: [Indikator Spesifik] [Entitas Wilayah: Kabupaten Mimika/Papua] [Sumber: BPS]
4. DILARANG KERAS menyertakan kata perintah (buatkan, analisa, laporan, merujuk, dari web search, artikel ilmiah, panduan penulisan).
Contoh:
Input: "Dengan merujuk dokumen acuan buatkan analisa penduduk mimika 2030 dan elastisitas PDRB dari web search"
Output: {"queries": ["PDRB Kabupaten Mimika BPS 2023 2024", "Proyeksi Penduduk Mimika 2030 BPS"]}`;

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
            this.logger.error(`[WebSearch Query Extraction Failed] Gagal memformulasi kueri: ${err.message}`);
        }

        // Fallback deterministik berbasis wilayah jika LLM gagal
        return ['PDRB Kabupaten Mimika BPS', 'Jumlah Penduduk Kabupaten Mimika BPS'];
    }

    /**
     * Melakukan pencarian eksternal, web scraping paralel, dan Multi-Factor Relevance Scoring
     */
    async searchReputableWeb(userQuery: string, limit: number = 3): Promise<SearchQueryResult[]> {
        const apiKey = this.configService.get<string>('SERPER_API_KEY');

        if (!apiKey || apiKey.trim().length === 0) {
            this.logger.warn('[WebSearch] SERPER_API_KEY tidak dikonfigurasi. Mengembalikan hasil kosong.');
            return [];
        }

        try {
            // 1. Ekstrak kueri-kueri pencarian terfokus
            const cleanQueries = await this.extractSearchQueries(userQuery);
            this.logger.log(`[WebSearch] Kueri pencarian terarah yang dijalankan: ${JSON.stringify(cleanQueries)}`);

            const allCandidates: SearchQueryResult[] = [];
            const visitedUrls = new Set<string>();
            const limitPerQuery = Math.max(2, Math.ceil((limit * 2) / cleanQueries.length));

            for (const query of cleanQueries) {
                const enrichedQuery = this.formulateEnrichedQuery(query);
                this.logger.log(`[WebSearch] Mengirim kueri ke Google Serper: "${enrichedQuery}"`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);

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

            // 2. Prioritaskan dan ambil kandidat terbaik untuk di-scrape
            const candidatesToScrape = allCandidates.slice(0, Math.max(limit, 3));
            this.logger.log(`[WebSearch] Menjalankan pengunduhan & penilaian multi-faktor untuk ${candidatesToScrape.length} kandidat URL...`);

            const evaluatedResults: SearchQueryResult[] = [];

            const scrapePromises = candidatesToScrape.map(async (candidate) => {
                try {
                    const scraped = await this.urlScraperService.scrapeAndExtract(candidate.link);
                    const cleanText = scraped.cleanText;

                    // 3. Multi-Factor Relevance Scoring Engine
                    const evaluation = this.evaluateSourceRelevance(
                        candidate.title,
                        cleanText,
                        candidate.link,
                        cleanQueries.join(' ')
                    );

                    if (evaluation.isApproved) {
                        this.logger.log(`[WebSearch Relevance ✓ APPROVED] ${candidate.link} (Skor: ${evaluation.totalScore}/100) - [Geo: ${evaluation.geographicScore}, Indikator: ${evaluation.indicatorScore}, Data: ${evaluation.dataDensityScore}, Otoritas: ${evaluation.authorityScore}]`);
                        return {
                            ...candidate,
                            scrapedText: cleanText,
                            relevanceScore: evaluation.totalScore,
                        };
                    } else {
                        this.logger.warn(`[WebSearch Relevance ✗ REJECTED] ${candidate.link} (Skor: ${evaluation.totalScore}/100) - Alasan: ${evaluation.rejectionReason}`);
                        return null; // Ditolak sepenuhnya dari konteks LLM
                    }
                } catch (scrapeErr: any) {
                    this.logger.warn(`[WebSearch Scrape Failed] Gagal menarik konten penuh dari ${candidate.link}: ${scrapeErr.message}`);
                    
                    // Fallback evaluasi berdasarkan snippet jika web gagal diunduh
                    const snippetEval = this.evaluateSourceRelevance(
                        candidate.title,
                        candidate.snippet,
                        candidate.link,
                        cleanQueries.join(' ')
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
            const approvedResults: SearchQueryResult[] = [];

            for (const res of resolvedResults) {
                if (res !== null && res !== undefined) {
                    approvedResults.push(res);
                }
            }

            approvedResults.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

            // JAMINAN KEBERADAAN REFERENSI (FAIL-SAFE GUARANTEE):
            // Jika filter terlalu ketat, jangan biarkan AI kehilangan referensi tautan resmi!
            // Ambil kandidat teratas dari Google Serper yang berasal dari domain whitelist.
            let finalResults = approvedResults.slice(0, limit);
            if (finalResults.length === 0 && allCandidates.length > 0) {
                this.logger.warn(`[WebSearch Fail-Safe Active] Menggunakan ${Math.min(limit, allCandidates.length)} tautan teratas dari domain resmi sebagai referensi acuan.`);
                finalResults = allCandidates.slice(0, limit);
            }

            this.logger.log(`[WebSearch Pipeline Selesai] Berhasil menyajikan ${finalResults.length} sumber data referensi resmi untuk AI.`);
            return finalResults;

        } catch (err: any) {
            this.logger.error(`[WebSearch Failed] Pencarian eksternal terganggu (Protected Variations Active): ${err.message}`);
            return [];
        }
    }

    /**
     * Multi-Factor Source Relevance Scoring Engine
     * Menghitung skor terbobot (0-100) untuk menjamin akurasi data daerah.
     */
    evaluateSourceRelevance(
        title: string,
        content: string,
        url: string,
        queryContext: string
    ): SourceRelevanceEvaluation {
        const textToEvaluate = `${title} ${content}`.toLowerCase();
        const urlLower = url.toLowerCase();

        // 1. Geographic Match (Bobot 35) — Wilayah Papua / Mimika
        let geographicScore = 0;
        const geoKeywords = ['mimika', 'timika', 'papua tengah', 'papua', 'provinsi papua'];
        for (const geo of geoKeywords) {
            if (textToEvaluate.includes(geo)) {
                geographicScore = geo === 'mimika' || geo === 'timika' ? 35 : 20;
                break;
            }
        }

        // 2. Indicator Match (Bobot 35) — Memuat indikator statistik/ekonomi riil
        let indicatorScore = 0;
        const primaryIndicators = ['pdrb', 'penduduk', 'proyeksi penduduk', 'adhk', 'adhb', 'produk domestik regional bruto'];
        const secondaryIndicators = ['pertumbuhan ekonomi', 'inflasi', 'kemiskinan', 'ketenagakerjaan', 'apbd', 'sektor pertambangan', 'freeport', 'statistik'];

        let matchedPrimary = 0;
        for (const ind of primaryIndicators) {
            if (textToEvaluate.includes(ind)) matchedPrimary++;
        }

        let matchedSecondary = 0;
        for (const ind of secondaryIndicators) {
            if (textToEvaluate.includes(ind)) matchedSecondary++;
        }

        if (matchedPrimary >= 2) {
            indicatorScore = 35;
        } else if (matchedPrimary === 1) {
            indicatorScore = 25 + Math.min(10, matchedSecondary * 5);
        } else if (matchedSecondary >= 1) {
            indicatorScore = Math.min(20, matchedSecondary * 10);
        }

        // 3. Data Density Score (Bobot 15) — Memuat data numerik, persentase %, atau nominal
        let dataDensityScore = 0;
        const hasNumbers = /\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b|\b\d+(?:,\d+)?%\b/g.test(content);
        const hasCurrencyOrUnits = /(miliar|triliun|persen|jiwa|ribu|rupiah|rp|tahun 202)/i.test(content);
        
        if (hasNumbers && hasCurrencyOrUnits) {
            dataDensityScore = 15;
        } else if (hasNumbers || hasCurrencyOrUnits) {
            dataDensityScore = 8;
        }

        // 4. Authority Score (Bobot 15) — Domain resmi terpercaya
        let authorityScore = 0;
        if (urlLower.includes('mimikakab.bps.go.id') || urlLower.includes('papua.bps.go.id')) {
            authorityScore = 15;
        } else if (urlLower.includes('bps.go.id') || urlLower.includes('mimikakab.go.id')) {
            authorityScore = 12;
        } else if (urlLower.includes('.go.id') || urlLower.includes('databoks.katadata.co.id')) {
            authorityScore = 10;
        } else if (urlLower.includes('antaranews.com') || urlLower.includes('cnbcindonesia.com') || urlLower.includes('bisnis.com') || urlLower.includes('kontan.co.id')) {
            authorityScore = 8;
        }

        // Penalti Khusus: Jika memuat topik panduan penulisan akademik / workshop jurnal
        const academicWritingNoise = /(panduan penulisan|workshop penulisan|gaya selingkung|buku teks|belajar mandiri|kemampuan belajar)/i.test(textToEvaluate);
        if (academicWritingNoise) {
            indicatorScore = Math.max(0, indicatorScore - 25);
            geographicScore = Math.max(0, geographicScore - 20);
        }

        const totalScore = geographicScore + indicatorScore + dataDensityScore + authorityScore;

        // Kriteria Kelulusan (Approval Threshold):
        // Lolos jika:
        // 1. Memiliki indikator relevan (indicatorScore >= 15) DAN (ada konteks wilayah ATAU dari domain otoritas resmi BPS/Pemerintah/Media Bisnis).
        // 2. ATAU skor total >= 35 dan bukan noise akademik.
        const isOfficialOrNews = authorityScore >= 8;
        const hasRelevantIndicator = indicatorScore >= 15;
        const hasGeographicContext = geographicScore > 0;

        let isApproved = false;
        let rejectionReason: string | undefined;

        if (academicWritingNoise) {
            isApproved = false;
            rejectionReason = 'Terdeteksi sebagai panduan penulisan akademik / workshop jurnal.';
        } else if (hasRelevantIndicator && (hasGeographicContext || isOfficialOrNews)) {
            isApproved = true;
        } else if (totalScore >= 35 && !academicWritingNoise) {
            isApproved = true;
        } else {
            rejectionReason = `Skor tidak mencukupi (Total: ${totalScore}, Indikator: ${indicatorScore}, Geo: ${geographicScore}).`;
        }

        return {
            geographicScore,
            indicatorScore,
            dataDensityScore,
            authorityScore,
            totalScore,
            isApproved,
            rejectionReason,
        };
    }

    /**
     * Intent-to-Indicator Resolver
     * Memetakan istilah kebijakan makro ke kata kunci statistik resmi BPS Mimika
     */
    private resolveMacroeconomicIndicators(prompt: string): string[] {
        const pLower = prompt.toLowerCase();
        const queries: string[] = [];

        const isMimika = pLower.includes('mimika') || pLower.includes('timika');
        const region = isMimika ? 'Kabupaten Mimika' : 'Mimika Papua';

        // Kasus 1: Elastisitas PDRB terhadap Penduduk / Pertumbuhan Ekonomi
        if ((pLower.includes('elastisitas') && pLower.includes('pdrb')) || (pLower.includes('pdrb') && pLower.includes('penduduk'))) {
            queries.push(`PDRB ${region} BPS 2023 2024`);
            queries.push(`Proyeksi Penduduk ${region} 2030 BPS`);
            return queries;
        }

        // Kasus 2: PDRB / Pertumbuhan Ekonomi Daerah
        if (pLower.includes('pdrb') || pLower.includes('pertumbuhan ekonomi') || pLower.includes('adhk')) {
            queries.push(`Produk Domestik Regional Bruto ${region} BPS`);
            queries.push(`Laju Pertumbuhan Ekonomi ${region} BPS`);
            return queries;
        }

        // Kasus 3: Demografi / Kependudukan / Bonus Demografi
        if (pLower.includes('penduduk') || pLower.includes('demografi') || pLower.includes('sensus')) {
            queries.push(`Jumlah Penduduk ${region} BPS`);
            queries.push(`Proyeksi Penduduk ${region} 2030`);
            return queries;
        }

        // Kasus 4: Kemiskinan / IPM / Kesejahteraan
        if (pLower.includes('kemiskinan') || pLower.includes('ipm') || pLower.includes('indeks pembangunan manusia')) {
            queries.push(`Indeks Pembangunan Manusia ${region} BPS`);
            queries.push(`Tingkat Kemiskinan ${region} BPS`);
            return queries;
        }

        // Kasus 5: Inflasi / Harga Bahan Pokok
        if (pLower.includes('inflasi') || pLower.includes('ihk') || pLower.includes('harga')) {
            queries.push(`Tingkat Inflasi IHK ${region} BPS`);
            return queries;
        }

        return queries;
    }

    /**
     * Membersihkan instruksi pengguna dari kata-kata meta penulisan secara deterministik
     */
    private sanitizeMetaPrompt(rawPrompt: string): string {
        return rawPrompt
            .replace(/https?:\/\/[^\s]+/gi, '')
            .replace(/\b(dengan merujuk|pada dokumen acuan|buatkan|buat|tolong|analisa|analisis|buatlah|tulis|tuliskan|laporan|artikel|dari web search|internet|secara lengkap|tambahkan data acuan yang relevan)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Membersihkan string kueri akhir agar siap dikirim ke Google Serper
     */
    private sanitizeQueryString(query: string): string {
        return query
            .replace(/[^\w\s\u00C0-\u017F]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Memformulasikan kueri pencarian dengan teknik Query Expansion untuk menyaring domain terpercaya
     */
    private formulateEnrichedQuery(userQuery: string): string {
        const sanitizedQuery = this.sanitizeQueryString(userQuery);

        if (sanitizedQuery.length === 0) {
            return 'PDRB Kabupaten Mimika BPS';
        }

        // Bangun ekspresi filter: kueri (site:A OR site:B OR site:C)
        const siteFilters = `(${this.REPUTABLE_SITES_WHITELIST.join(' OR ')})`;
        return `${sanitizedQuery} ${siteFilters}`;
    }

    /**
     * Memeriksa apakah URL termasuk dalam pola yang diblokir (endpoint download, API internal, file biner)
     */
    private isBlockedUrl(url: string): boolean {
        for (const pattern of this.BLOCKED_URL_PATTERNS) {
            if (pattern.test(url)) {
                this.logger.warn(`[WebSearch URL Blocked] URL ditolak karena cocok pola terblokir: ${url}`);
                return true;
            }
        }
        return false;
    }
}