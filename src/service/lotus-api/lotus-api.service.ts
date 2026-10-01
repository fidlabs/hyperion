import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Cacheable } from 'src/utils/cacheable';
import { Retryable } from 'src/utils/retryable';
import { EthApiService } from '../eth-api/eth-api.service';
import { LotusStateMinerInfoResponse } from './types.lotus-api';

@Injectable()
export class LotusApiService {
  private readonly logger = new Logger(LotusApiService.name);

  constructor(
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
    private readonly ethApiService: EthApiService,
  ) {}

  @Cacheable({ ttl: 1000 * 60 * 60 * 12 }) // 12 hours
  public async getMinerInfo(
    storageProviderId: string,
  ): Promise<LotusStateMinerInfoResponse> {
    try {
      return await this._getMinerInfo(storageProviderId);
    } catch (err) {
      throw new Error(
        `Error fetching miner info for ${storageProviderId}: ${err.message}`,
        { cause: err },
      );
    }
  }

  @Cacheable({ ttl: 1000 * 60 * 60 * 12 }) // 12 hours
  public async listMiners(): Promise<string[]> {
    try {
      return await this._listMiners();
    } catch (err) {
      throw new Error(`Error listing miners: ${err.message}`, { cause: err });
    }
  }

  @Retryable({ retries: 3, delay: 5000 }) // 5 seconds
  private async _getMinerInfo(
    storageProviderId: string,
  ): Promise<LotusStateMinerInfoResponse> {
    const mappedCurioPeerId =
      await this.ethApiService.checkAndMapCurioStorageProviderPeerId(
        storageProviderId,
      );

    const endpoint = `${this.configService.get<string>('GLIF_API_BASE_URL')}/v1`;

    const { data } = await firstValueFrom(
      this.httpService.post<LotusStateMinerInfoResponse>(endpoint, {
        jsonrpc: '2.0',
        id: 1,
        method: 'Filecoin.StateMinerInfo',
        params: [storageProviderId, null],
      }),
    );

    if (!data?.result) throw new Error(`No data`);

    return {
      ...data,
      result: {
        ...data.result,
        PeerId: mappedCurioPeerId ?? data.result.PeerId,
      },
    };
  }

  @Retryable({ retries: 3, delay: 5000 }) // 5 seconds
  private async _listMiners(): Promise<string[]> {
    const endpoint = `${this.configService.get<string>('GLIF_API_BASE_URL')}/v1`;

    const { data } = await firstValueFrom(
      this.httpService.post<{ result: string[] }>(endpoint, {
        jsonrpc: '2.0',
        id: 1,
        method: 'Filecoin.StateListMiners',
        params: [null],
      }),
    );

    if (!data?.result) throw new Error(`No data`);

    return data.result;
  }
}
