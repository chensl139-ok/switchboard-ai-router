import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ChatRequest, ChatResponse, GatewayModels } from '@shared/api.interface';
import { RouterService } from './router.service';
@Controller('openapi/v1')
export class RouterOpenapiController {
  constructor(private readonly service: RouterService) {}
  @Get('models') models(): Promise<GatewayModels> {return this.service.gatewayModels();}
  @Post('chat/completions')
  async chat(@Body() body: ChatRequest, @Res({passthrough: true}) res: Response): Promise<ChatResponse> {
    const abort: AbortController = new AbortController();
    const close = (): void => {if (!res.writableEnded) abort.abort();};
    res.on('close', close);
    try {return await this.service.chat(body, abort.signal);} finally {res.off('close', close);}
  }
}
