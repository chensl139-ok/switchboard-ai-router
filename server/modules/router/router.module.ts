import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RouterController } from './router.controller';
import { RouterOpenapiController } from './router.openapi.controller';
import { RouterService } from './router.service';
import { RouterStore } from './router.store';
import { RouterCrypto } from './router.crypto';
import { RouterUpstream } from './router.upstream';
@Module({imports: [HttpModule], controllers: [RouterController, RouterOpenapiController],
  providers: [RouterService, RouterStore, RouterCrypto, RouterUpstream]})
export class RouterModule {}
