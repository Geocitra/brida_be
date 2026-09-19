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
