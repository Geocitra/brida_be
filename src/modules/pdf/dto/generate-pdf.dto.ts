import { IsString, IsNotEmpty, IsIn, IsNumber, Min, Max, IsOptional } from 'class-validator';

export class GeneratePdfDto {
  @IsString()
  @IsNotEmpty()
  htmlContent!: string;

  @IsIn(['Calibri', 'Times New Roman', 'Verdana', 'Arial'])
  fontFamily!: string;

  @IsNumber()
  @Min(8)
  @Max(36)
  fontSize!: number;

  @IsNumber()
  @Min(1)
  @Max(3)
  lineSpacing!: number;

  @IsNumber()
  @Min(1.5)
  @Max(5)
  marginCm!: number;

  @IsString()
  @IsOptional()
  filename?: string;
}
