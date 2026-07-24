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
}
