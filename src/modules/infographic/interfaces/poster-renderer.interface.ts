export const POSTER_RENDERER_TOKEN = 'POSTER_RENDERER_TOKEN';

export interface RenderPosterOptions {
  baseImageDataUri: string;
  width: number;
  height: number;
  headerEnabled: boolean;
  logoDataUri?: string | null;
  institution?: string | null;
  subInstitution?: string | null;
  footerEnabled: boolean;
  footerText?: string | null;
  layoutConfig?: {
    headerBgColor?: string;
    headerTextColor?: string;
    headerAlignment?: 'left_with_logo' | 'center';
    footerBgColor?: string;
    footerTextColor?: string;
    footerAlignment?: 'center' | 'left' | 'right';
    headerFontSize?: 'compact' | 'normal' | 'large';
    footerFontSize?: 'compact' | 'normal' | 'large';
    logoPosition?: 'left' | 'right' | 'center';
    logoSize?: 'compact' | 'normal' | 'large';
  };
}

export interface IPosterRenderer {
  render(options: RenderPosterOptions): Promise<Buffer>;
}
