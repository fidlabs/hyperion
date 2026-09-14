import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Logger } from '@nestjs/common';

import { ControllerBase } from '../base/controller-base';

@Controller('storage-providers')
@CacheTTL(1000 * 60 * 30) // 30 minutes
export class StorageProvidersController extends ControllerBase {
  private readonly logger = new Logger(StorageProvidersController.name);

  constructor() {
    super();
  }
}
