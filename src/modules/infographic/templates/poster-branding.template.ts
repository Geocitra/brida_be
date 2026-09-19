import { RenderPosterOptions } from '../interfaces/poster-renderer.interface';

/**
 * Menghitung metrik branding proporsional adaptif berbasis aspek rasio kanvas
 * Menjamin header dan footer tidak memenggal konten AI dan tidak terlalu tebal di landscape.
 */
export function getPosterBrandingMetrics(width: number, height: number) {
  const ratio = width / height;
  let headerPercent: number;
  let footerPercent: number;

  if (ratio > 1.5) {
    // Landscape 16:9
    headerPercent = 0.06;
    footerPercent = 0.035;
  } else if (ratio > 1.1) {
    // Landscape 4:3
    headerPercent = 0.065;
    footerPercent = 0.04;
  } else if (ratio > 0.85) {
    // Square 1:1
    headerPercent = 0.07;
    footerPercent = 0.04;
  } else if (ratio > 0.65) {
    // Portrait 3:4
    headerPercent = 0.07;
    footerPercent = 0.04;
  } else {
    // Tall Portrait 9:16
    headerPercent = 0.075;
    footerPercent = 0.04;
  }

  const headerHeightPx = Math.round(height * headerPercent);
  const footerHeightPx = Math.round(height * footerPercent);

  return {
    headerPercent,
    footerPercent,
    headerHeightPx,
    footerHeightPx,
    titleFontSizePx: Math.max(13, Math.round(headerHeightPx * 0.28)),
    subTitleFontSizePx: Math.max(10, Math.round(headerHeightPx * 0.20)),
    footerFontSizePx: Math.max(10, Math.round(footerHeightPx * 0.36)),
    logoHeightPx: Math.round(headerHeightPx * 0.74),
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
  const headerAlignment = layoutConfig.headerAlignment || 'left_with_logo';

  const footerBgColor = layoutConfig.footerBgColor || '#0F1E36';
  const footerTextColor = layoutConfig.footerTextColor || (isDarkColor(footerBgColor) ? '#F8FAFC' : '#0F1E36');
  const footerAlignment = layoutConfig.footerAlignment || 'center';

  // Perhitungan skala proporsional dinamis berbasis tinggi kanvas dan aspek rasio
  const metrics = getPosterBrandingMetrics(width, height);
  const {
    headerHeightPx,
    footerHeightPx,
    titleFontSizePx,
    subTitleFontSizePx,
    footerFontSizePx,
    logoHeightPx,
  } = metrics;

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
      ${headerAlignment === 'center' ? 'justify-content: center; text-align: center;' : 'justify-content: flex-start;'}
    }

    .header-logo {
      height: ${logoHeightPx}px;
      width: auto;
      max-width: ${Math.round(width * 0.18)}px;
      object-fit: contain;
      margin-right: ${Math.round(width * 0.025)}px;
      flex-shrink: 0;
    }

    .header-text-block {
      display: flex;
      flex-direction: column;
      justify-content: center;
      line-height: 1.15;
      min-width: 0;
      flex: 1;
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
