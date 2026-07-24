import { Controller, Post, Body, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { IntentRouterService } from '../services/intent-router.service';
import { ChatMemoryService } from '../services/chat-memory.service';
import { InteractRequestDto } from '../dtos/interact-request.dto';

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly routerService: IntentRouterService,
    private readonly memoryService: ChatMemoryService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Body('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Body('title') title?: string,
  ) {
    const session = await this.memoryService.createSession(documentId, title);
    return {
      success: true,
      data: session,
    };
  }

  @Post('interact')
  @HttpCode(HttpStatus.OK)
  async interact(
    @Body() dto: InteractRequestDto,
  ) {
    const result = await this.routerService.dispatch(dto.sessionId, dto.query);
    return {
      success: true,
      data: result,
    };
  }
}
