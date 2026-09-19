import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  IsObject,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosterLayoutConfigDto {
  @IsOptional()
  @IsString()
  headerBgColor?: string;

  @IsOptional()
  @IsString()
  headerTextColor?: string;

  @IsOptional()
  @IsString()
  @IsIn(['left_with_logo', 'center'])
  headerAlignment?: 'left_with_logo' | 'center';

  @IsOptional()
  @IsString()
  footerBgColor?: string;

  @IsOptional()
  @IsString()
  footerTextColor?: string;

  @IsOptional()
  @IsString()
  @IsIn(['center', 'left', 'right'])
  footerAlignment?: 'center' | 'left' | 'right';

  @IsOptional()
  @IsString()
  @IsIn(['compact', 'normal', 'large'])
  headerFontSize?: 'compact' | 'normal' | 'large';

  @IsOptional()
  @IsString()
  @IsIn(['compact', 'normal', 'spacious'])
  headerHeight?: 'compact' | 'normal' | 'spacious';

  @IsOptional()
  @IsString()
  @IsIn(['compact', 'normal', 'large'])
  footerFontSize?: 'compact' | 'normal' | 'large';

  @IsOptional()
  @IsString()
  @IsIn(['left', 'right', 'center'])
  logoPosition?: 'left' | 'right' | 'center';

  @IsOptional()
  @IsString()
  @IsIn(['compact', 'normal', 'large'])
  logoSize?: 'compact' | 'normal' | 'large';
}

export class UpsertPosterBrandingDto {
  @IsOptional()
  @IsBoolean()
  headerEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  institution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subInstitution?: string;

  @IsOptional()
  @IsBoolean()
  footerEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerText?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PosterLayoutConfigDto)
  layoutConfig?: PosterLayoutConfigDto;
}
