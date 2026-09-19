import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export type InfographicAspectRatio = '1:1' | '9:16' | '16:9' | '3:4' | '4:3';
export type InfographicVisualStyle =
  | 'modern-vector'
  | 'corporate-clean'
  | 'flat-infographic'
  | 'isometric-data';

export class GenerateInfographicDto {
  @IsString()
  @IsNotEmpty({ message: 'Topik atau naskah infografis wajib diisi.' })
  topic!: string;

  @IsString()
  @IsOptional()
  documentId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['1:1', '9:16', '16:9', '3:4', '4:3'], {
    message: 'Rasio aspek harus 1:1, 9:16, 16:9, 3:4, atau 4:3.',
  })
  aspectRatio?: InfographicAspectRatio = '9:16';

  @IsString()
  @IsOptional()
  @IsIn(
    ['modern-vector', 'corporate-clean', 'flat-infographic', 'isometric-data'],
    {
      message: 'Gaya visual tidak valid.',
    },
  )
  visualStyle?: InfographicVisualStyle = 'modern-vector';

  @IsString()
  @IsOptional()
  customInstructions?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// POLIMORFIK BLOK DATA KONTRAK (DYNAMIC GENERATIVE BLOCKS)
// ─────────────────────────────────────────────────────────────────────────────

export type InfographicBlockType =
  | 'METRIC_CARDS'      // Kartu KPI ringkas dengan angka besar dan persentase tren
  | 'BAR_CHART'         // Grafik batang perbandingan (Kategori / Waktu / Antar Sektor)
  | 'LINE_CHART'        // Grafik garis tren berkala / indeks perkembangan
  | 'PROGRESS_ITEMS'    // Item capaian target horizontal progress bar
  | 'ICON_LIST'         // Poin-poin temuan fakta dengan ikon semantik
  | 'DISTRICT_STATUS'   // Matriks kerentanan spasial distrik di Kabupaten Mimika
  | 'ACTION_STEPS';     // Rekomendasi rencana aksi / langkah antisipasi bernomor

export interface MetricCardItem {
  label: string;
  value: string;
  changePercent?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  note?: string;
}

export interface MetricCardsPayload {
  items: MetricCardItem[];
}

export interface BarChartSeries {
  name: string;
  data: number[];
  color?: string;
}

export interface BarChartPayload {
  categories: string[];
  series: BarChartSeries[];
  unit?: string;
}

export interface LineChartPoint {
  label: string;
  value: number;
}

export interface LineChartPayload {
  points: LineChartPoint[];
  unit?: string;
  minThreshold?: number;
  maxThreshold?: number;
  thresholdLabel?: string;
}

export interface ProgressItem {
  name: string;
  current: number;
  max: number;
  currentLabel: string;
  maxLabel?: string;
  changePercent?: number;
  changeLabel?: string;
  unit?: string;
}

export interface ProgressItemsPayload {
  legend?: {
    current: string;
    baseline?: string;
  };
  items: ProgressItem[];
}

export interface IconListItem {
  icon: 'alert' | 'trend-up' | 'trend-down' | 'check' | 'leaf' | 'water' | 'fire' | 'health' | 'info';
  title?: string;
  text: string;
}

export interface IconListPayload {
  items: IconListItem[];
}

export interface DistrictStatusItem {
  name: string;
  level: 'Tinggi' | 'Sedang-Tinggi' | 'Sedang' | 'Rendah';
  note?: string;
}

export interface DistrictStatusPayload {
  districts: DistrictStatusItem[];
  legend?: Array<{ level: string; color: string }>;
}

export interface ActionStepItem {
  stepNumber: number;
  icon?: string;
  title?: string;
  text: string;
  pic?: string;
  priority?: 'TINGGI' | 'SEDANG' | 'RENDAH';
}

export interface ActionStepsPayload {
  steps: ActionStepItem[];
  commitmentBadge?: string;
}

export interface InfographicBlock {
  id: string;
  type: InfographicBlockType;
  title: string;
  subtitle?: string;
  insight?: string;
  payload:
    | MetricCardsPayload
    | BarChartPayload
    | LineChartPayload
    | ProgressItemsPayload
    | IconListPayload
    | DistrictStatusPayload
    | ActionStepsPayload
    | any;
}

export interface InfographicHeader {
  eyebrow: string;
  titlePrefix?: string;
  titleMain: string;
  subtitle: string;
  description: string;
  regionTag: string;
  statusCard?: {
    period: string;
    statusLabel: string;
    statusValue: string;
    category: string;
    sourceNote?: string;
  };
}

export interface InfographicFooter {
  tagline: string;
  sources: string;
}

export interface InfographicContentData {
  title: string;
  subtitle?: string;
  categoryBadge?: string;
  dallePrompt: string;
  themeColors: {
    primary: string;
    secondary: string;
    accent: string;
  };
  header: InfographicHeader;
  blocks: InfographicBlock[];
  footer: InfographicFooter;
}

export interface InfographicResponseDto {
  id: string;
  imageUrl: string;
  aspectRatio: InfographicAspectRatio;
  visualStyle: InfographicVisualStyle;
  content: InfographicContentData;
  createdAt: string;
}
