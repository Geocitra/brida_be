import { IsArray, IsString, IsOptional, IsBoolean } from 'class-validator';

export class GenerateReportDto {
  @IsArray()
  @IsString({ each: true })
  documentIds!: string[];

  @IsOptional()
  @IsString()
  reportType?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsBoolean()
  forceRegenerate?: boolean;
}

export class CheckCacheDto {
  @IsArray()
  @IsString({ each: true })
  documentIds!: string[];

  @IsOptional()
  @IsString()
  reportType?: string;
}
