import { RenderPosterOptions } from '../interfaces/poster-renderer.interface';

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

  // Perhitungan skala proporsional dinamis berbasis tinggi kanvas
  const headerHeightPx = Math.round(height * 0.08);
  const footerHeightPx = Math.round(height * 0.06);

  const titleFontSizePx = Math.max(14, Math.round(headerHeightPx * 0.28));
  const subTitleFontSizePx = Math.max(11, Math.round(headerHeightPx * 0.20));
  const footerFontSizePx = Math.max(11, Math.round(footerHeightPx * 0.32));
  const logoHeightPx = Math.round(headerHeightPx * 0.72);

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
    }

    .header-institution {
      font-size: ${titleFontSizePx}px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .header-sub-institution {
      font-size: ${subTitleFontSizePx}px;
      font-weight: 500;
      opacity: 0.92;
      margin-top: ${Math.round(headerHeightPx * 0.04)}px;
      letter-spacing: 0.02em;
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
