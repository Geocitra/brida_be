// ============================================================================
// BRIDA INFOGRAPHIC DESIGN SYSTEM — Visual Grammar Engine & Canvas Composition
// ============================================================================

export enum InfographicArchetype {
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  POVERTY_SOCIAL = 'POVERTY_SOCIAL',
  HEALTH = 'HEALTH',
  EDUCATION = 'EDUCATION',
  REGIONAL_ECONOMY = 'REGIONAL_ECONOMY',
  CLIMATE_ENVIRONMENT = 'CLIMATE_ENVIRONMENT',
  GENERAL_GOVERNANCE = 'GENERAL_GOVERNANCE',
}

export type VisualDensity = 'balanced' | 'dense' | 'data_dense';

export interface VisualZone {
  zoneId: string;
  title: string;
  heightPercent: number;
  purpose: string;
  visualType: string;
  compositionNote: string;
}

export interface VisualGrammar {
  preferredVisuals: string[];
  avoidVisuals: string[];
  heroStyle: string;
  mapPriority: 'high' | 'medium' | 'low';
  chartPriority: 'high' | 'medium' | 'low';
  photographyPriority: 'high' | 'medium' | 'low';
}

export interface ArchetypeDefinition {
  archetype: InfographicArchetype;
  keywords: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  density: VisualDensity;
  visualGrammar: VisualGrammar;
  visualZones: VisualZone[];
}

// ============================================================================
// MASTER DESIGN SYSTEM — Identitas Visual Pemkab Mimika (Canvas-Dense Edition)
// ============================================================================

export const MASTER_DESIGN_SYSTEM = `
[MASTER VISUAL IDENTITY - PEMERINTAH KABUPATEN MIMIKA]

AESTHETICS & LAYOUT:
- This is a DATA-DENSE GOVERNMENT INFORMATION INFOGRAPHIC, not a minimalist poster.
- Layout: Tall vertical modular infographic poster using a dense editorial grid with strong visual hierarchy.
- Use controlled whitespace only between information groups. The composition must be visually rich and fill the entire vertical canvas.
- Avoid large empty margins and unused vertical areas.

CANVAS OCCUPANCY REQUIREMENT:
- The infographic must visually occupy at least 92-97% of the available canvas height.
- Do NOT leave large unused blank areas above, between, or below visual zones.
- The composition must feel information-rich, editorially dense, and intentionally filled.
- Whitespace should only be used as micro-spacing between content elements, not as large empty regions.
- Every major vertical area of the canvas must contain meaningful visual information.
- Never place the entire infographic content only in the middle of the canvas.
- Never create excessive empty margins or make the infographic look like a sparse presentation slide.

COLOR PALETTE:
- Primary: Deep Navy Blue (#0F1E36 or #1E3A8A) representing governmental authority.
- Secondary: Blue-Green / Slate Teal (#0D9488 / #0284C7) representing development & public welfare.
- Accent: Warm Amber / Gold (#F59E0B) strictly for key numerical highlights and warnings.
- Background: Clean light neutral or pure white with subtle, high-contrast containers.

VISUAL ELEMENTS:
- Layout Components: Rectangular information cards, thin structural dividers, flat geometric iconography, balanced negative space, Swiss typographic hierarchy.
- Graphic Constraints: Avoid cartoonish/childish illustrations, 3D floating clutter, or generic stock art. Focus on clarity, data density, and authentic regional context (Papua Tengah / Mimika).
- Visual Variety: Do NOT render every zone as a rectangular card. Mix full-width photography, metric strips, charts, maps, timelines, diagrams, icons, callout numbers, photographic panels, and compact cards. Avoid repetitive card grids.
- Absolute Language Rule: All titles, labels, legends, headers, and text printed on the graphic MUST BE 100% IN FORMAL BAHASA INDONESIA. Zero English words on the final graphic.
- NO LOGO DIRECTIVE: Strictly DO NOT generate any government logos, emblems, seals, or watermarks in either the header or the footer.

DATA INTEGRITY & PROVENANCE:
- Only visualize numerical values explicitly supplied by the grounded data.
- Never invent statistics. Never fabricate percentages.
- Never transform unrelated percentages into a pie chart.
- Use a pie/donut chart ONLY when the data explicitly represents components of one complete whole totaling 100%.
- Every numerical visualization must correspond to a verified source fact.
`;

// ============================================================================
// CANVAS SAFE AREA & COMPOSITION ENGINE — Vertical Zone Allocation
// ============================================================================

/**
 * Alokasi kanvas yang DIKOSONGKAN oleh AI agar dapat diisi
 * secara deterministik oleh PosterCompositionService (Fase 4).
 *
 * PENTING: Angka ini adalah kontrak antara prompt generatif dan
 * renderer. Mengubahnya WAJIB diikuti perubahan pada
 * poster-branding.template.ts, atau header/footer akan
 * menimpa konten infografis.
 */
// ============================================================================
// CANVAS SAFE AREA & COMPOSITION ENGINE — Vertical Zone Allocation
// ============================================================================

/**
 * Konfigurasi Safe Area & Alokasi Kanvas Adaptif per Aspek Rasio.
 * Menerapkan prinsip 3-Tier Sizing:
 * 1. Bar Overlay: tinggi fisik bar header/footer resmi yang ditempel.
 * 2. Tolerance Buffer: ruang napas kosong ekstra antara bar dan konten agar AI tidak ter-clip.
 * 3. Reserved Area: total area kosong yang wajib dipatuhi oleh model AI dalam prompt.
 */
export const SAFE_AREA_CONFIG = {
  '9:16': {
    headerBarPercent: 7.5,
    headerTolerancePercent: 4.5,
    topReservedPercent: 12.0,
    footerBarPercent: 4.0,
    footerTolerancePercent: 2.0,
    bottomReservedPercent: 6.0,
    contentStart: 12.0,
    contentEnd: 94.0,
  },
  '3:4': {
    headerBarPercent: 7.0,
    headerTolerancePercent: 4.5,
    topReservedPercent: 11.5,
    footerBarPercent: 4.0,
    footerTolerancePercent: 2.0,
    bottomReservedPercent: 6.0,
    contentStart: 11.5,
    contentEnd: 94.0,
  },
  '1:1': {
    headerBarPercent: 7.0,
    headerTolerancePercent: 4.5,
    topReservedPercent: 11.5,
    footerBarPercent: 4.0,
    footerTolerancePercent: 2.0,
    bottomReservedPercent: 6.0,
    contentStart: 11.5,
    contentEnd: 94.0,
  },
  '16:9': {
    headerBarPercent: 6.0,
    headerTolerancePercent: 4.0,
    topReservedPercent: 10.0,
    footerBarPercent: 3.5,
    footerTolerancePercent: 1.5,
    bottomReservedPercent: 5.0,
    contentStart: 10.0,
    contentEnd: 95.0,
  },
  '4:3': {
    headerBarPercent: 6.5,
    headerTolerancePercent: 4.0,
    topReservedPercent: 10.5,
    footerBarPercent: 4.0,
    footerTolerancePercent: 1.5,
    bottomReservedPercent: 5.5,
    contentStart: 10.5,
    contentEnd: 94.5,
  },
} as const;

export const SAFE_AREA = {
  headerPercent: 7.5,
  headerTolerancePercent: 4.5,
  topReservedPercent: 12.0,
  footerPercent: 4.0,
  footerTolerancePercent: 2.0,
  bottomReservedPercent: 6.0,
} as const;

export const CONTENT_START = SAFE_AREA.topReservedPercent; // 12%
export const CONTENT_END = 100 - SAFE_AREA.bottomReservedPercent; // 94%

export const SAFE_AREA_DIRECTIVE = `
RESERVED SAFE AREAS — MANDATORY:
- Top 12% of the canvas MUST be a clean solid color band (pure white #FFFFFF or theme solid color). Absolutely NO text, NO headlines, NO imagery, NO icons, NO graphic elements inside this band. Leave it completely empty as a buffer for the official institutional header.
- Bottom 6% of the canvas (94% to 100%) MUST likewise be a clean solid color band, completely empty without any text, cards, borders, or chart legends.
- These reserved bands are intentional. They are NOT a violation of the canvas occupancy requirement. The 92-97% occupancy target applies ONLY to the content area between 12% and 94%.
- NEVER render any title bar, institution name, organization label, source attribution, tagline, date stamp, page number, or footer line anywhere on the canvas. That information is applied afterwards by a separate system.
`;

export const CANVAS_COMPOSITION_9x16 = `
=== FULL CANVAS COMPOSITION (9:16 PORTRAIT) ===

${SAFE_AREA_DIRECTIVE}

CONTENT AREA: 12% to 94% of canvas height.
Target visual occupancy WITHIN the content area: 92-97%.

VERTICAL VISUAL RHYTHM — absolute canvas positions:

0-12%:   RESERVED SAFE AREA — leave completely empty (solid color band).
         (Header bar occupies 0-7.5%; 7.5-12% is generous tolerance cushion to prevent clipping).

12-28%:  ZONE 1 — FULL-WIDTH HERO VISUAL
         Large documentary/environmental photograph or detailed topic-specific visual extending edge-to-edge horizontally, starting safely at 12%. Overlay the title and subtitle over the hero area using strong contrast. Do NOT extend any text or elements above 12%.

26-38%:  ZONE 2 — KEY STATISTICS STRIP
         4-6 verified statistics displayed as a strong horizontal visual strip or modular statistic blocks. Each statistic must include: large number, unit, short label, and optional directional indicator.

38-54%:  ZONE 3 — PRIMARY DATA STORY
         Large chart, comparison visualization, trend line, or diagram. Not just a card. Add one concise insight statement below the chart.

54-72%:  ZONE 4 — GEOGRAPHIC / SPATIAL STORY
         Large map occupying substantial visual area (not a tiny map inside a card). The map itself is a major visual element. Include district labels, legend, and 2-4 callout annotations with key geographic insight.

72-84%:  ZONE 5 — PROGRAM / RESPONSE / FIELD EVIDENCE
         Use a combination of timeline, feature cards, photographic documentation, or process visualization. Mix visual types.

84-94%:  ZONE 6 — IMPACT / COMMUNITY OUTCOMES
         4-6 icons, metrics, or visual impact indicators. All cards and graphics must conclude cleanly at or before 94%.

94-100%: RESERVED SAFE AREA — leave completely empty (solid color band).
         (Footer bar occupies 96-100%; 94-96% is tolerance cushion).

There is no ZONE 7. Do not render a footer.
VISUAL DENSITY TARGET: HIGH within the 10-94% content area.
`;

export const CANVAS_COMPOSITION_1x1 = `
=== FULL CANVAS COMPOSITION (1:1 SQUARE) ===

${SAFE_AREA_DIRECTIVE}

CONTENT AREA: 11.5% to 94% of canvas height.
Target visual occupancy WITHIN the content area: 90-95%.

LAYOUT — absolute vertical allocation:

0-11.5%: RESERVED SAFE AREA — leave completely empty (solid color band). Header occupies 0-7.0%; 7.0-11.5% is generous tolerance buffer.
11.5-28%: ZONE 1 — HERO (compact title + subtitle + background visual starting safely at 11.5%)
28-44%:  ZONE 2 — KEY STATISTICS (3-4 metric blocks in a row)
44-68%:  ZONE 3+4 — DATA STORY + GEOGRAPHIC (side-by-side chart and map)
68-94%:  ZONE 5+6 — PROGRAM + IMPACT (compact grid concluding cleanly at 94%)
94-100%: RESERVED SAFE AREA — leave completely empty (solid color band). Footer occupies 96-100%; 94-96% is tolerance buffer.

There is no ZONE 7. Do not render a footer.
Prioritize data density. Fewer decorative elements, more numbers and charts.
`;

export const CANVAS_COMPOSITION_16x9 = `
=== FULL CANVAS COMPOSITION (16:9 LANDSCAPE) ===

RESERVED SAFE AREAS — MANDATORY (16:9 LANDSCAPE):
- Top 10.0% of the canvas MUST be completely empty (Header bar occupies 0-6.0%; 6.0-10.0% is generous tolerance buffer).
- Bottom 5.0% of the canvas MUST be completely empty (Footer bar occupies 96.5-100%; 95.0-96.5% is tolerance buffer).
- NEVER render any government header, logo, or footer text on the canvas.

CONTENT AREA: 10.0% to 95.0% of canvas height.
Target visual occupancy WITHIN the content area: 90-95%.
Use a multi-column layout to maximize horizontal space.

All three columns must begin safely at 10.0% and conclude at 95.0% of canvas height.
0-10.0%:     RESERVED SAFE AREA — leave completely empty (solid color band across full width).

Left 35%:   ZONE 1+2 — HERO COLUMN (hero visual + key statistics stacked vertically)
Center 35%: ZONE 3+4 — DATA COLUMN (chart on top, map below)
Right 30%:  ZONE 5+6 — INSIGHT COLUMN (program cards, impact icons)

95.0-100%:  RESERVED SAFE AREA — leave completely empty (solid color band across full width).
Do not render a footer.
`;

export const CANVAS_COMPOSITION_3x4 = `
=== FULL CANVAS COMPOSITION (3:4 PORTRAIT / EDITORIAL POSTER) ===

${SAFE_AREA_DIRECTIVE}

CONTENT AREA: 11.5% to 94% of canvas height.
Target visual occupancy WITHIN the content area: 92-96%.
Slightly wider than 9:16, allowing richer multi-column blocks, prominent maps, and balanced editorial spacing.

VERTICAL VISUAL RHYTHM — absolute canvas positions:

0-11.5%: RESERVED SAFE AREA — leave completely empty (solid color band). Header occupies 0-7.0%; 7.0-11.5% is generous tolerance buffer.

11.5-28%: ZONE 1 — FULL-WIDTH HERO VISUAL
         Large documentary/environmental photograph or topic-specific visual extending edge-to-edge horizontally, starting safely at 11.5%. Overlay the title and subtitle over the hero area using strong contrast.

28-40%:  ZONE 2 — KEY STATISTICS STRIP
         4-6 verified statistics displayed in a clean 2x2 or 3-column modular statistic block. Each statistic must include: large bold number, unit, and short Indonesian label.

40-58%:  ZONE 3 — PRIMARY DATA STORY
         Substantial chart, multi-metric comparison, or trend visualization with an insight statement below.

58-76%:  ZONE 4 — GEOGRAPHIC / SPATIAL STORY
         Large thematic map occupying substantial visual area with district callouts, legend, and regional annotations.

76-94%:  ZONE 5 & 6 — STRATEGIC PROGRAM & IMPACT
         Balanced combination of initiative cards, field evidence photos, and measurable socio-economic impact metrics concluding cleanly at 94%.

94-100%: RESERVED SAFE AREA — leave completely empty (solid color band). Footer occupies 96-100%; 94-96% is tolerance buffer.

There is no ZONE 7. Do not render a footer.
VISUAL DENSITY TARGET: HIGH within the 11.5-94% content area.
`;

export const CANVAS_COMPOSITION_4x3 = `
=== FULL CANVAS COMPOSITION (4:3 LANDSCAPE / PRESENTATION & TABLET) ===

RESERVED SAFE AREAS — MANDATORY (4:3 LANDSCAPE):
- Top 10.5% of the canvas MUST be completely empty (Header bar occupies 0-6.5%; 6.5-10.5% is generous tolerance buffer).
- Bottom 5.5% of the canvas MUST be completely empty (Footer bar occupies 96.0-100%; 94.5-96.0% is tolerance buffer).
- NEVER render any government header, logo, or footer text on the canvas.

CONTENT AREA: 10.5% to 94.5% of canvas height.
Target visual occupancy WITHIN the content area: 90-95%.
Use a balanced 2-column or 3-column editorial grid to optimize horizontal and vertical real estate.

All columns must begin safely at 8.5% and end at 94.5% of canvas height.
0-8.5%:     RESERVED SAFE AREA — leave completely empty (solid color band across full width).

Left 40%:   ZONE 1+2 — HERO & STATS (Dominant hero visual with overlaid Indonesian title, accompanied by 3-4 key indicator cards)
Center 35%: ZONE 3+4 — DATA & SPATIAL STORY (Prominent comparison chart on top, thematic district map or spatial distribution below)
Right 25%:  ZONE 5+6 — INTERVENTIONS & IMPACT (Compact program cards and measurable community outcome icons)

94.5-100%:  RESERVED SAFE AREA — leave completely empty (solid color band across full width).
Do not render a footer.
VISUAL DENSITY TARGET: HIGH within the 8.5-94.5% content area.
`;

// ============================================================================
// ARCHETYPE REGISTRY — Visual Grammar Engine per Domain Sektoral
// ============================================================================

export const ARCHETYPE_REGISTRY: Record<InfographicArchetype, ArchetypeDefinition> = {
  [InfographicArchetype.INFRASTRUCTURE]: {
    archetype: InfographicArchetype.INFRASTRUCTURE,
    keywords: ['jalan', 'jembatan', 'infrastruktur', 'konstruksi', 'pelabuhan', 'bandara', 'listrik', 'air bersih', 'pupr', 'transportasi', 'konektivitas'],
    primaryColor: '#1e3a8a',
    secondaryColor: '#0284c7',
    accentColor: '#f59e0b',
    density: 'dense',
    visualGrammar: {
      preferredVisuals: ['project_hero_photo', 'progress_bar', 'route_map', 'before_after_comparison', 'project_feature_cards', 'construction_field_photos', 'impact_metric_icons'],
      avoidVisuals: ['generic_pie_chart', 'excessive_empty_cards', '3d_floating_objects', 'decorative_illustrations'],
      heroStyle: 'documentary_construction_aerial',
      mapPriority: 'high',
      chartPriority: 'medium',
      photographyPriority: 'high',
    },
    visualZones: [
      { zoneId: 'hero', title: 'Hero Proyek Infrastruktur', heightPercent: 20, purpose: 'Judul proyek & visualisasi lanskap pembangunan konektivitas Mimika', visualType: 'full_width_photo_overlay', compositionNote: 'Aerial/documentary photo of road/bridge construction extending edge-to-edge with bold title overlay' },
      { zoneId: 'key_indicators', title: 'Indikator Capaian Utama', heightPercent: 12, purpose: 'Panjang jalan terbangun (km), pagu APBD (Rp), kemantapan jalan (%)', visualType: 'metric_strip', compositionNote: '4-5 large bold numbers in a horizontal strip with directional indicators' },
      { zoneId: 'data_story', title: 'Progres Realisasi Fisik', heightPercent: 16, purpose: 'Persentase realisasi vs target tahun berjalan per paket pekerjaan', visualType: 'horizontal_progress_bars', compositionNote: 'Multiple progress bars comparing target vs realization, not a single gauge' },
      { zoneId: 'geography', title: 'Koridor Logistik & Sebaran Proyek', heightPercent: 18, purpose: 'Peta rute koridor pesisir (Pomako) dan pegunungan (Agimuga, Tembagapura)', visualType: 'large_route_map', compositionNote: 'Large stylized map with route lines, district labels, and project callouts' },
      { zoneId: 'program', title: 'Daftar Proyek Strategis', heightPercent: 14, purpose: 'Status pekerjaan paket jalan dan jembatan dengan foto dokumentasi', visualType: 'photo_feature_cards', compositionNote: 'Mix of small field photographs with project status cards' },
      { zoneId: 'impact', title: 'Dampak Sosio-Ekonomi', heightPercent: 12, purpose: 'Waktu tempuh, penurunan biaya logistik, konektivitas warga terhubung', visualType: 'icon_metrics', compositionNote: '4-6 impact indicators with flat icons and verified numbers' },
    ],
  },

  [InfographicArchetype.POVERTY_SOCIAL]: {
    archetype: InfographicArchetype.POVERTY_SOCIAL,
    keywords: ['kemiskinan', 'sosial', 'bansos', 'pkh', 'kesejahteraan', 'keluarga rentan', 'kemiskinan ekstrem', 'oap'],
    primaryColor: '#0f172a',
    secondaryColor: '#0d9488',
    accentColor: '#ef4444',
    density: 'dense',
    visualGrammar: {
      preferredVisuals: ['humanistic_portrait', 'trend_line_chart', 'district_comparison_bar', 'factor_breakdown_diagram', 'program_cards_with_icons', 'impact_callout_numbers'],
      avoidVisuals: ['generic_pie_chart', 'celebratory_imagery', '3d_floating_objects', 'corporate_stock_visuals'],
      heroStyle: 'documentary_humanistic_editorial',
      mapPriority: 'medium',
      chartPriority: 'high',
      photographyPriority: 'high',
    },
    visualZones: [
      { zoneId: 'hero', title: 'Hero Perlindungan Sosial', heightPercent: 20, purpose: 'Penegasan komitmen pengentasan kemiskinan dan perlindungan sosial', visualType: 'full_width_photo_overlay', compositionNote: 'Humanistic editorial portrait of Mimika community with title overlay' },
      { zoneId: 'key_indicators', title: 'Angka Kemiskinan Makro', heightPercent: 12, purpose: 'Persentase penduduk miskin, garis kemiskinan per kapita, jumlah keluarga rentan', visualType: 'metric_strip', compositionNote: '4-5 large alert-colored numbers with trend arrows' },
      { zoneId: 'data_story', title: 'Tren Penurunan Kemiskinan', heightPercent: 16, purpose: 'Pergerakan angka kemiskinan 3-5 tahun terakhir', visualType: 'trend_line_chart', compositionNote: 'Multi-year line chart with baseline and target lines' },
      { zoneId: 'geography', title: 'Sebaran Wilayah Rawan', heightPercent: 18, purpose: 'Komparasi distrik pesisir vs pegunungan', visualType: 'district_bar_chart_or_map', compositionNote: 'Horizontal bar chart comparing districts OR thematic map with risk zones' },
      { zoneId: 'program', title: 'Faktor & Intervensi', heightPercent: 14, purpose: 'Akar masalah dan paket intervensi bansos/PKH/pemberdayaan OAP', visualType: 'split_panel', compositionNote: 'Left: factor breakdown diagram. Right: program intervention cards with icons' },
      { zoneId: 'impact', title: 'Target & Dampak Terukur', heightPercent: 12, purpose: 'Target zero poverty, keluarga terangkat, realisasi anggaran sosial', visualType: 'impact_callouts', compositionNote: 'Bold callout numbers with source labels' },
    ],
  },

  [InfographicArchetype.HEALTH]: {
    archetype: InfographicArchetype.HEALTH,
    keywords: ['stunting', 'gizi', 'kesehatan', 'posyandu', 'puskesmas', 'malaria', 'imunisasi', 'balita', 'dinkes', 'sanitasi'],
    primaryColor: '#065f46',
    secondaryColor: '#0d9488',
    accentColor: '#f97316',
    density: 'dense',
    visualGrammar: {
      preferredVisuals: ['health_field_photography', 'prevalence_gauge', 'trend_comparison_bar', 'vulnerability_risk_map', 'intervention_checklist', 'timeline_roadmap'],
      avoidVisuals: ['generic_pie_chart', 'cartoonish_medical_icons', '3d_floating_objects', 'stock_hospital_imagery'],
      heroStyle: 'documentary_healthcare_field',
      mapPriority: 'high',
      chartPriority: 'high',
      photographyPriority: 'high',
    },
    visualZones: [
      { zoneId: 'hero', title: 'Hero Kesehatan Masyarakat', heightPercent: 20, purpose: 'Penyuluhan gizi dan pengentasan stunting terpadu', visualType: 'full_width_photo_overlay', compositionNote: 'Documentary photo of Posyandu activity, mother-child nutrition, or field healthcare' },
      { zoneId: 'key_indicators', title: 'Indikator Kesehatan Kunci', heightPercent: 12, purpose: 'Prevalensi stunting (%), balita terlayani, puskesmas aktif', visualType: 'metric_strip', compositionNote: 'Color-coded health metric cards (red for critical, green for improving)' },
      { zoneId: 'data_story', title: 'Tren Capaian Intervensi', heightPercent: 16, purpose: 'Penurunan angka kasus pasca intervensi per triwulan', visualType: 'comparison_bar_chart', compositionNote: 'Grouped bar chart comparing quarters or years' },
      { zoneId: 'geography', title: 'Peta Kerentanan Distrik', heightPercent: 18, purpose: 'Zona prioritas stunting di distrik pedalaman dan pesisir', visualType: 'risk_zone_map', compositionNote: 'Large thematic map with red/orange/green district zones and callout labels' },
      { zoneId: 'program', title: 'Intervensi Spesifik & Sensitif', heightPercent: 14, purpose: 'PMT, tablet tambah darah, sanitasi air, dan program konvergensi', visualType: 'intervention_cards', compositionNote: 'Checklist-style cards with icons and field photos' },
      { zoneId: 'impact', title: 'Roadmap Pencapaian', heightPercent: 12, purpose: 'Target nasional (<14%), timeline intervensi, dan dampak terukur', visualType: 'timeline_roadmap', compositionNote: 'Horizontal timeline with milestone markers' },
    ],
  },

  [InfographicArchetype.EDUCATION]: {
    archetype: InfographicArchetype.EDUCATION,
    keywords: ['pendidikan', 'sekolah', 'guru', 'siswa', 'beasiswa', 'literasi', 'gedung sekolah', 'disdik', 'apm', 'apk'],
    primaryColor: '#1e3a8a',
    secondaryColor: '#3b82f6',
    accentColor: '#10b981',
    density: 'dense',
    visualGrammar: {
      preferredVisuals: ['classroom_photography', 'education_stat_cards', 'participation_bar_chart', 'facility_distribution_map', 'scholarship_program_cards', 'ipm_progress_indicators'],
      avoidVisuals: ['cartoonish_school_icons', 'generic_pie_chart', '3d_floating_objects'],
      heroStyle: 'documentary_classroom_activity',
      mapPriority: 'medium',
      chartPriority: 'high',
      photographyPriority: 'medium',
    },
    visualZones: [
      { zoneId: 'hero', title: 'Hero Pendidikan Mimika', heightPercent: 20, purpose: 'Akselerasi mutu SDM dan pendidikan anak Mimika', visualType: 'full_width_photo_overlay', compositionNote: 'Students in classroom or learning environment' },
      { zoneId: 'key_indicators', title: 'Statistik Pendidikan Pokok', heightPercent: 12, purpose: 'Jumlah sekolah, rasio guru:siswa, APM/APK', visualType: 'metric_strip', compositionNote: 'Large education numbers with jenjang breakdowns' },
      { zoneId: 'data_story', title: 'Angka Partisipasi Sekolah', heightPercent: 16, purpose: 'Tingkat keikutsertaan per jenjang (SD/SMP/SMA)', visualType: 'grouped_bar_chart', compositionNote: 'Grouped bars comparing SD, SMP, SMA participation rates' },
      { zoneId: 'geography', title: 'Sebaran Fasilitas Belajar', heightPercent: 18, purpose: 'Ketersediaan sarana di 18 distrik Mimika', visualType: 'facility_map', compositionNote: 'District map with school density indicators and teacher distribution' },
      { zoneId: 'program', title: 'Program Afirmasi Daerah', heightPercent: 14, purpose: 'Beasiswa OAP dan distribusi guru ke wilayah perintis', visualType: 'program_feature_cards', compositionNote: 'Feature cards with beneficiary numbers and photos' },
      { zoneId: 'impact', title: 'Dampak Peningkatan IPM', heightPercent: 12, purpose: 'Kontribusi terhadap Indeks Pembangunan Manusia Mimika', visualType: 'progress_indicators', compositionNote: 'Circular or bar progress indicators with year-over-year comparison' },
    ],
  },

  [InfographicArchetype.REGIONAL_ECONOMY]: {
    archetype: InfographicArchetype.REGIONAL_ECONOMY,
    keywords: ['pdrb', 'ekonomi', 'pad', 'apbd', 'anggaran', 'inflasi', 'investasi', 'fiskal', 'pertumbuhan', 'umkm'],
    primaryColor: '#0f172a',
    secondaryColor: '#1e3a8a',
    accentColor: '#10b981',
    density: 'data_dense',
    visualGrammar: {
      preferredVisuals: ['pdrb_trend_line', 'sector_horizontal_bar', 'growth_comparison', 'economic_structure_diagram', 'investment_callout', 'employment_indicator'],
      avoidVisuals: ['generic_pie_chart_without_denominator', 'decorative_illustrations', '3d_floating_objects', 'stock_financial_imagery'],
      heroStyle: 'economic_commercial_editorial',
      mapPriority: 'medium',
      chartPriority: 'high',
      photographyPriority: 'low',
    },
    visualZones: [
      { zoneId: 'hero', title: 'Hero Ekonomi Daerah', heightPercent: 18, purpose: 'Laporan kinerja makroekonomi & fiskal daerah', visualType: 'gradient_hero_with_title', compositionNote: 'Dark gradient hero with large economic headline and key figure callout' },
      { zoneId: 'key_indicators', title: 'Angka Kunci Ekonomi', heightPercent: 14, purpose: 'Pertumbuhan PDRB (%), realisasi PAD (Rp), laju inflasi (%)', visualType: 'metric_strip', compositionNote: '5-6 financial metric blocks with green/red trend indicators' },
      { zoneId: 'data_story', title: 'Pertumbuhan Tahunan', heightPercent: 16, purpose: 'Laju pertumbuhan ekonomi non-tambang vs total PDRB', visualType: 'multi_series_line_chart', compositionNote: 'Dual-line chart comparing mining vs non-mining growth trajectories' },
      { zoneId: 'geography', title: 'Dekomposisi Sektoral', heightPercent: 16, purpose: 'Kontribusi pertambangan, pertanian, perdagangan, dan jasa', visualType: 'horizontal_stacked_bar', compositionNote: 'Horizontal stacked bar chart showing sector contributions' },
      { zoneId: 'program', title: 'Realisasi Investasi & UMKM', heightPercent: 14, purpose: 'Serapan modal dan penciptaan lapangan kerja lokal', visualType: 'data_table_with_callouts', compositionNote: 'Compact data table with highlighted key investments' },
      { zoneId: 'impact', title: 'Rekomendasi Kebijakan', heightPercent: 14, purpose: 'Diversifikasi pendapatan daerah masa depan', visualType: 'numbered_action_steps', compositionNote: 'Numbered strategic recommendations with priority labels' },
    ],
  },

  [InfographicArchetype.CLIMATE_ENVIRONMENT]: {
    archetype: InfographicArchetype.CLIMATE_ENVIRONMENT,
    keywords: ['el nino', 'iklim', 'cuaca', 'hujan', 'kekeringan', 'lingkungan', 'hutan', 'banjir', 'bencana', 'bpbd', 'bmkg'],
    primaryColor: '#0c4a6e',
    secondaryColor: '#0284c7',
    accentColor: '#ea580c',
    density: 'dense',
    visualGrammar: {
      preferredVisuals: ['climate_trend_chart', 'rainfall_comparison_bar', 'vulnerability_map', 'impact_icons_grid', 'environmental_field_photography', 'response_timeline'],
      avoidVisuals: ['generic_pie_chart', 'excessive_metric_cards_only', 'decorative_3d_objects', 'cartoon_weather_icons'],
      heroStyle: 'documentary_environmental_atmospheric',
      mapPriority: 'high',
      chartPriority: 'high',
      photographyPriority: 'high',
    },
    visualZones: [
      { zoneId: 'hero', title: 'Hero Iklim & Kebencanaan', heightPercent: 20, purpose: 'Kesiapsiagaan dampak anomali iklim & cuaca ekstrem', visualType: 'full_width_photo_overlay', compositionNote: 'Atmospheric documentary photo of Mimika landscape affected by climate — drought, low rivers, or storm conditions' },
      { zoneId: 'key_indicators', title: 'Parameter Iklim Ekstrem', heightPercent: 12, purpose: 'Anomali suhu rata-rata, hari tanpa hujan (HTH), indeks curah hujan', visualType: 'metric_strip', compositionNote: 'Orange/red alert-colored metric blocks with warning indicators' },
      { zoneId: 'data_story', title: 'Tren Curah Hujan', heightPercent: 16, purpose: 'Fluktuasi bulanan baseline vs kondisi riil El Niño', visualType: 'comparison_bar_chart', compositionNote: 'Side-by-side bar chart: Normal rainfall vs El Niño rainfall by month, with insight statement' },
      { zoneId: 'geography', title: 'Peta Wilayah Kerentanan', heightPercent: 18, purpose: 'Distrik pesisir dan dataran tinggi rawan pangan/air', visualType: 'vulnerability_zone_map', compositionNote: 'Large thematic map with red/orange/yellow vulnerability zones, district labels, and affected-area callouts' },
      { zoneId: 'program', title: 'Dampak Riil Lapangan', heightPercent: 14, purpose: 'Ketahanan pangan lokal (sagu/umbi), pasokan air bersih, dan distribusi logistik', visualType: 'impact_grid_with_photos', compositionNote: 'Grid of impact categories with small field photos and verified statistics' },
      { zoneId: 'impact', title: 'Protokol Respons & Mitigasi', heightPercent: 12, purpose: 'Langkah tanggap darurat Pemda dan penyaluran logistik', visualType: 'response_timeline', compositionNote: 'Horizontal timeline: MONITORING → MITIGASI → INTERVENSI → PEMULIHAN' },
    ],
  },

  [InfographicArchetype.GENERAL_GOVERNANCE]: {
    archetype: InfographicArchetype.GENERAL_GOVERNANCE,
    keywords: [],
    primaryColor: '#0f172a',
    secondaryColor: '#0284c7',
    accentColor: '#f59e0b',
    density: 'dense',
    visualGrammar: {
      preferredVisuals: ['governance_editorial_photo', 'performance_stat_cards', 'target_vs_actual_bar', 'district_coverage_map', 'initiative_cards', 'strategic_roadmap'],
      avoidVisuals: ['generic_pie_chart', '3d_floating_objects', 'decorative_illustrations', 'corporate_stock_imagery'],
      heroStyle: 'editorial_governance_architectural',
      mapPriority: 'medium',
      chartPriority: 'high',
      photographyPriority: 'medium',
    },
    visualZones: [
      { zoneId: 'hero', title: 'Hero Kebijakan Daerah', heightPercent: 20, purpose: 'Fokus isu kebijakan dan pembaruan tata kelola', visualType: 'full_width_photo_overlay', compositionNote: 'Editorial photography of government activities or development outcomes' },
      { zoneId: 'key_indicators', title: 'Capaian Kinerja Pokok', heightPercent: 12, purpose: 'Indikator keberhasilan regulasi dan kepatuhan', visualType: 'metric_strip', compositionNote: '4-5 governance performance metrics with status indicators' },
      { zoneId: 'data_story', title: 'Target vs Capaian', heightPercent: 16, purpose: 'Evaluasi kesenjangan performa antar-unit kerja', visualType: 'comparison_bar_chart', compositionNote: 'Horizontal bar chart comparing target vs actual per OPD or program' },
      { zoneId: 'geography', title: 'Konteks Wilayah Implementasi', heightPercent: 18, purpose: 'Sebaran cakupan kebijakan di tingkat distrik/kampung', visualType: 'coverage_map', compositionNote: 'District map showing policy implementation coverage' },
      { zoneId: 'program', title: 'Inisiatif Pembaruan', heightPercent: 14, purpose: 'Penyederhanaan birokrasi dan transformasi digital', visualType: 'initiative_feature_cards', compositionNote: 'Feature cards with initiative descriptions and progress indicators' },
      { zoneId: 'impact', title: 'Arah Kebijakan Strategis', heightPercent: 12, purpose: 'Rencana aksi akselerasi pembangunan Mimika', visualType: 'strategic_roadmap', compositionNote: 'Numbered strategic steps with priority labels and PIC assignments' },
    ],
  },
};

// ============================================================================
// TOPIC RESOLVER — Menentukan Arketipe + Merakit Visual Zone Prompt
// ============================================================================

export function resolveCanvasComposition(aspectRatio: string): string {
  switch (aspectRatio) {
    case '1:1':
      return CANVAS_COMPOSITION_1x1;
    case '16:9':
      return CANVAS_COMPOSITION_16x9;
    case '3:4':
      return CANVAS_COMPOSITION_3x4;
    case '4:3':
      return CANVAS_COMPOSITION_4x3;
    case '9:16':
    default:
      return CANVAS_COMPOSITION_9x16;
  }
}

export function resolveTopicInformationArchitecture(topic: string): {
  archetype: ArchetypeDefinition;
  formattedZones: string;
  visualGrammarPrompt: string;
} {
  const cleanTopic = topic.toLowerCase();
  let selected = ARCHETYPE_REGISTRY[InfographicArchetype.GENERAL_GOVERNANCE];

  for (const key of Object.keys(ARCHETYPE_REGISTRY) as InfographicArchetype[]) {
    const def = ARCHETYPE_REGISTRY[key];
    if (def.keywords.some((kw) => cleanTopic.includes(kw))) {
      selected = def;
      break;
    }
  }

  const formattedZones = selected.visualZones
    .map(
      (z) =>
        `ZONE ${z.zoneId.toUpperCase()} (~${z.heightPercent}% of canvas) — ${z.title}:
  * Purpose: ${z.purpose}
  * Visual Type: ${z.visualType}
  * Composition: ${z.compositionNote}`,
    )
    .join('\n\n');

  const vg = selected.visualGrammar;
  const visualGrammarPrompt = `VISUAL GRAMMAR FOR ${selected.archetype}:
- Preferred Visual Elements: ${vg.preferredVisuals.join(', ')}
- AVOID These Visuals: ${vg.avoidVisuals.join(', ')}
- Hero Style: ${vg.heroStyle}
- Map Priority: ${vg.mapPriority} | Chart Priority: ${vg.chartPriority} | Photography Priority: ${vg.photographyPriority}
- Visual Density Target: ${selected.density.toUpperCase()}`;

  return {
    archetype: selected,
    formattedZones,
    visualGrammarPrompt,
  };
}
