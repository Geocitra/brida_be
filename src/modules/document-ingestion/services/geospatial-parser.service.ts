import { Injectable, Logger } from '@nestjs/common';

export interface ExtractedGeospatialData {
  locationName: string;
  latitude: number;
  longitude: number;
  confidenceScore: number;
}

@Injectable()
export class GeospatialParserService {
  private readonly logger = new Logger(GeospatialParserService.name);

  // Daftar 18 Distrik Kabupaten Mimika resmi untuk pencarian lokal deterministik
  private readonly MIMIKA_DISTRICTS = [
    'Mimika Baru',
    'Kuala Kencana',
    'Tembagapura',
    'Wania',
    'Iwaka',
    'Kwamki Narama',
    'Mimika Timur',
    'Mimika Tengah',
    'Mimika Barat',
    'Agimuga',
    'Jila',
    'Jita',
    'Mimika Timur Jauh',
    'Mimika Barat Jauh',
    'Mimika Barat Tengah',
    'Amar',
    'Hoya',
    'Alama',
  ];

  // Regex pattern matcher untuk deteksi koordinat garis lintang dan bujur
  // Format contoh: (-6.2088, 106.8456) atau Lat: -6.2088, Long: 106.8456
  private readonly coordRegex =
    /(?:lat(?:itude)?|lintang)?\s*[:=]?\s*(-?\d{1,2}\.\d+)\s*,\s*(?:long(?:itude)?|bujur)?\s*[:=]?\s*(-?\d{1,3}\.\d+)/gi;

  extractGeospatialLocations(chunkText: string): ExtractedGeospatialData[] {
    const results: ExtractedGeospatialData[] = [];
    let match: RegExpExecArray | null;

    while ((match = this.coordRegex.exec(chunkText)) !== null) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);

      // Validasi rentang koordinat geografis bumi
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        results.push({
          locationName: `Koordinat terdeteksi (${lat}, ${lng})`,
          latitude: lat,
          longitude: lng,
          confidenceScore: 0.95,
        });
      }
    }

    if (results.length > 0) {
      this.logger.log(`Terdeteksi ${results.length} titik lokasi geospasial pada chunk teks.`);
    }

    return results;
  }

  /**
   * Menghitung kemunculan unik dan kerapatan (frekuensi) penyebutan distrik
   */
  calculateDistrictDensity(text: string): { detected: string[]; density: Record<string, number> } {
    if (!text) {
      return { detected: [], density: {} };
    }

    const detectedSet = new Set<string>();
    const densityMap: Record<string, number> = {};

    for (const district of this.MIMIKA_DISTRICTS) {
      const escapedPattern = district
        .replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
        .replace(/\s+/g, '\\s+');

      // Menggunakan bendera 'g' (global) untuk menghitung seluruh kecocokan
      const regex = new RegExp(`\\b${escapedPattern}\\b`, 'gi');
      const matches = text.match(regex);

      if (matches && matches.length > 0) {
        detectedSet.add(district);
        densityMap[district] = matches.length; // Merekam jumlah seberapa sering distrik disebut
      }
    }

    return {
      detected: Array.from(detectedSet),
      density: densityMap,
    };
  }

  detectDistricts(text: string): string[] {
    return this.calculateDistrictDensity(text).detected;
  }
}
