import { RenderPosterOptions } from '../interfaces/poster-renderer.interface';
import { SAFE_AREA_CONFIG } from '../constants/infographic-design-system.constant';

export interface PosterBrandingMetricsOptions {
  headerFontSize?: 'compact' | 'normal' | 'large';
  footerFontSize?: 'compact' | 'normal' | 'large';
  logoSize?: 'compact' | 'normal' | 'large';
  headerHeight?: 'compact' | 'normal' | 'spacious';
  headerHeightPercent?: number;
  footerHeightPercent?: number;
  /** Aspek rasio kanvas, contoh: '9:16', '3:4', '1:1', '4:3', '16:9' */
  aspectRatio?: string;
}

/**
 * Menentukan konfigurasi Safe Area berdasarkan aspek rasio.
 * Sumber kebenaran tunggal — sinkron dengan SAFE_AREA_CONFIG dan prompt AI.
 */
function resolveSafeArea(width: number, height: number, aspectRatio?: string) {
  // Gunakan aspect ratio string jika disediakan
  if (aspectRatio && aspectRatio in SAFE_AREA_CONFIG) {
    return SAFE_AREA_CONFIG[aspectRatio as keyof typeof SAFE_AREA_CONFIG];
  }

  // Fallback: deteksi dari rasio dimensi
  const ratio = width / height;
  if (ratio > 1.5) return SAFE_AREA_CONFIG['16:9'];
  if (ratio > 1.1) return SAFE_AREA_CONFIG['4:3'];
  if (ratio > 0.85) return SAFE_AREA_CONFIG['1:1'];
  if (ratio > 0.65) return SAFE_AREA_CONFIG['3:4'];
  return SAFE_AREA_CONFIG['9:16'];
}

/**
 * Menghitung metrik branding proporsional adaptif berbasis SAFE_AREA_CONFIG.
 * Nilai header/footer % identik dengan yang diinstruksikan ke AI dalam prompt,
 * sehingga overlay tepat menutupi blank space yang disisakan AI — tidak lebih, tidak kurang.
 */
export function getPosterBrandingMetrics(
  width: number,
  height: number,
  options?: PosterBrandingMetricsOptions,
) {
  const safeArea = resolveSafeArea(width, height, options?.aspectRatio);

  // headerBarPercent adalah tinggi fisik bar yang dirender (dalam persen)
  // Ini SINKRON dengan nilai yang AI di-prompt untuk disisakan di bagian atas
  const headerPercent = safeArea.headerBarPercent / 100;
  const footerPercent = safeArea.footerBarPercent / 100;

  let effectiveHeaderPercent: number;
  if (typeof options?.headerHeightPercent === 'number' && options.headerHeightPercent > 0) {
    effectiveHeaderPercent = options.headerHeightPercent / 100;
  } else {
    const headerHeightMultiplier =
      options?.headerHeight === 'compact' ? 0.85 : options?.headerHeight === 'spacious' ? 1.2 : 1.0;
    effectiveHeaderPercent = headerPercent * headerHeightMultiplier;
  }

  let effectiveFooterPercent: number;
  if (typeof options?.footerHeightPercent === 'number' && options.footerHeightPercent > 0) {
    effectiveFooterPercent = options.footerHeightPercent / 100;
  } else {
    effectiveFooterPercent = footerPercent;
  }

  const headerFontMultiplier =
    options?.headerFontSize === 'compact' ? 0.85 : options?.headerFontSize === 'large' ? 1.18 : 1.0;
  const footerFontMultiplier =
    options?.footerFontSize === 'compact' ? 0.85 : options?.footerFontSize === 'large' ? 1.18 : 1.0;
  const logoSizeMultiplier =
    options?.logoSize === 'compact' ? 0.58 : options?.logoSize === 'large' ? 0.88 : 0.74;

  const headerHeightPx = Math.round(height * effectiveHeaderPercent);
  const footerHeightPx = Math.round(height * effectiveFooterPercent);

  return {
    headerPercent: effectiveHeaderPercent,
    footerPercent: effectiveFooterPercent,
    headerHeightPx,
    footerHeightPx,
    safeArea,
    titleFontSizePx: Math.max(12, Math.round(headerHeightPx * 0.28 * headerFontMultiplier)),
    subTitleFontSizePx: Math.max(9, Math.round(headerHeightPx * 0.20 * headerFontMultiplier)),
    footerFontSizePx: Math.max(9, Math.round(footerHeightPx * 0.36 * footerFontMultiplier)),
    logoHeightPx: Math.round(headerHeightPx * logoSizeMultiplier),
  };
}


/**
 * Membentuk markup HTML presisi untuk dikonversi menjadi PNG beresolusi tinggi oleh Puppeteer
 */
export function generatePosterBrandingHtml(options: RenderPosterOptions): string {
  const {
    baseImageDataUri,
    width,
    height,
    headerEnabled,
    logoDataUri,
    institution = 'PEMERINTAH KABUPATEN MIMIKA',
    subInstitution = 'Badan Riset dan Inovasi Daerah',
    footerEnabled,
    footerText = 'Sumber: Dokumen Resmi BRIDA Kabupaten Mimika',
    layoutConfig = {},
  } = options;

  const headerBgColor = layoutConfig.headerBgColor || '#FFFFFF';
  const headerTextColor = layoutConfig.headerTextColor || (isDarkColor(headerBgColor) ? '#FFFFFF' : '#0F1E36');
  const logoPosition = layoutConfig.logoPosition || (layoutConfig.headerAlignment === 'center' ? 'center' : 'left');
  const headerFontSize = layoutConfig.headerFontSize || 'normal';
  const footerFontSize = layoutConfig.footerFontSize || 'normal';
  const logoSize = layoutConfig.logoSize || 'normal';
  const headerHeight = layoutConfig.headerHeight || 'normal';
  const headerHeightPercent = layoutConfig.headerHeightPercent;
  const footerHeightPercent = layoutConfig.footerHeightPercent;

  const footerBgColor = layoutConfig.footerBgColor || '#0F1E36';
  const footerTextColor = layoutConfig.footerTextColor || (isDarkColor(footerBgColor) ? '#F8FAFC' : '#0F1E36');
  const footerAlignment = layoutConfig.footerAlignment || 'center';

  // Perhitungan skala proporsional dinamis berbasis tinggi kanvas, aspek rasio, dan layoutConfig
  const metrics = getPosterBrandingMetrics(width, height, {
    headerFontSize,
    footerFontSize,
    logoSize,
    headerHeight,
    headerHeightPercent,
    footerHeightPercent,
    aspectRatio: options.aspectRatio,
  });
  const {
    headerHeightPx,
    footerHeightPx,
    titleFontSizePx,
    subTitleFontSizePx,
    footerFontSizePx,
    logoHeightPx,
  } = metrics;

  const headerJustify =
    logoPosition === 'center'
      ? 'center'
      : logoPosition === 'right'
      ? 'space-between'
      : 'flex-start';
  const headerTextAlign = logoPosition === 'center' ? 'center' : 'left';
  const logoOrder = logoPosition === 'right' ? 2 : 1;
  const textOrder = logoPosition === 'right' ? 1 : 2;
  const textFlex = logoPosition === 'center' ? '0 1 auto' : '1';
  const textAlignItems = logoPosition === 'center' ? 'center' : 'flex-start';
  const logoMargin =
    logoPosition === 'right'
      ? `margin-left: ${Math.round(width * 0.02)}px; margin-right: 0;`
      : `margin-right: ${Math.round(width * 0.02)}px; margin-left: 0;`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}, height=${height}, initial-scale=1.0" />
  <title>Composed Poster</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      border-radius: 0px !important;
    }

    html, body {
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background-color: #000000;
      font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .poster-container {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }

    /* ── BASE AI IMAGE: Mengisi seluruh kanvas (header/footer menempati blank space AI) ── */
    .base-canvas-image {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: fill;
      z-index: 1;
    }

    /* ── HEADER RESMI (SAFE AREA: 0 - 8%) ── */
    .branding-header {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: ${headerHeightPx}px;
      background-color: ${headerBgColor};
      color: ${headerTextColor};
      z-index: 10;
      display: flex;
      align-items: center;
      padding: 0 ${Math.round(width * 0.04)}px;
      border-bottom: 2px solid ${isDarkColor(headerBgColor) ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'};
      justify-content: ${headerJustify};
      text-align: ${headerTextAlign};
    }

    .header-logo {
      height: ${logoHeightPx}px;
      width: auto;
      max-width: ${Math.round(width * 0.18)}px;
      object-fit: contain;
      order: ${logoOrder};
      ${logoMargin}
      flex-shrink: 0;
    }

    .header-text-block {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: ${textAlignItems};
      line-height: 1.15;
      min-width: 0;
      flex: ${textFlex};
      order: ${textOrder};
      overflow: hidden;
    }

    .header-institution {
      font-size: ${titleFontSizePx}px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .header-sub-institution {
      font-size: ${subTitleFontSizePx}px;
      font-weight: 500;
      opacity: 0.92;
      margin-top: ${Math.round(headerHeightPx * 0.04)}px;
      letter-spacing: 0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── FOOTER RESMI (SAFE AREA: 94% - 100%) ── */
    .branding-footer {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: ${footerHeightPx}px;
      background-color: ${footerBgColor};
      color: ${footerTextColor};
      z-index: 10;
      display: flex;
      align-items: center;
      padding: 0 ${Math.round(width * 0.04)}px;
      border-top: 1px solid ${isDarkColor(footerBgColor) ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'};
      ${footerAlignment === 'center' ? 'justify-content: center; text-align: center;' : footerAlignment === 'right' ? 'justify-content: flex-end; text-align: right;' : 'justify-content: flex-start; text-align: left;'}
    }

    .footer-text {
      font-size: ${footerFontSizePx}px;
      font-weight: 500;
      letter-spacing: 0.03em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
  </style>
</head>
<body>
  <div class="poster-container">
    <!-- Gambar Kanvas AI Asli (100% Canvas, Safe Area 8%-94%) -->
    <img class="base-canvas-image" src="${baseImageDataUri}" alt="Infografis Dasar" />

    <!-- Overlay Header Deterministic (0 - 8%) -->
    ${
      headerEnabled
        ? `<header class="branding-header">
            ${logoDataUri ? `<img class="header-logo" src="${logoDataUri}" alt="Logo Instansi" />` : ''}
            <div class="header-text-block">
              <span class="header-institution">${escapeHtml(institution || '')}</span>
              ${subInstitution ? `<span class="header-sub-institution">${escapeHtml(subInstitution)}</span>` : ''}
            </div>
          </header>`
        : ''
    }

    <!-- Overlay Footer Deterministic (94% - 100%) -->
    ${
      footerEnabled
        ? `<footer class="branding-footer">
            <span class="footer-text">${escapeHtml(footerText || '')}</span>
          </footer>`
        : ''
    }
  </div>
</body>
</html>`;
}

function isDarkColor(hex: string): boolean {
  if (!hex || !hex.startsWith('#')) return false;
  const clean = hex.replace('#', '');
  if (clean.length !== 6 && clean.length !== 3) return false;
  const r = clean.length === 6 ? parseInt(clean.substring(0, 2), 16) : parseInt(clean[0] + clean[0], 16);
  const g = clean.length === 6 ? parseInt(clean.substring(2, 4), 16) : parseInt(clean[1] + clean[1], 16);
  const b = clean.length === 6 ? parseInt(clean.substring(4, 6), 16) : parseInt(clean[2] + clean[2], 16);
  // Hitung relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
