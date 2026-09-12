import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import { CanRole, NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { RouterService } from './router.service';
@Controller('api/router')
@NeedLogin()
export class RouterController {
  constructor(private readonly service: RouterService) {}
  @CanRole(['router_admin'])
  @Get('state') state() { return this.service.state(); }
  @CanRole(['router_admin'])
  @Post('providers') @NeedLogin()
  provider(@Body() body: unknown, @Req() req: Request) {return this.service.saveProvider(body, req.userContext.userId);}
  @CanRole(['router_admin'])
  @Patch('settings') @NeedLogin()
  settings(@Body() body: unknown, @Req() req: Request) {return this.service.saveSettings(body, req.userContext.userId);}
  @CanRole(['router_admin'])
  @Patch('model') @NeedLogin()
  model(@Body() body: unknown, @Req() req: Request) {return this.service.switchModel(body, req.userContext.userId);}
  @CanRole(['router_admin'])
  @Post('models') @NeedLogin()
  models(@Body() body: unknown) {return this.service.models(body);}
  @CanRole(['router_admin'])
  @Post('chat') @NeedLogin()
  async chat(@Body() body: unknown, @Res({passthrough: true}) res: Response) {
    const abort: AbortController = new AbortController();
    const close = (): void => {if (!res.writableEnded) abort.abort();};
    res.on('close', close);
    try {return await this.service.chat(body, abort.signal);} finally {res.off('close', close);}
  }
}
