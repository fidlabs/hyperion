import { Cache, CACHE_MANAGER, CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { PostgresService } from 'src/db/postgres.service';
import { IpniAdvertisementFetcherJobService } from 'src/jobs/ipni-advertisement-fetcher-job/ipni-advertisement-fetcher-job.service';
import { Cacheable } from 'src/utils/cacheable';
import { IpniReportingDailyRunnerService } from 'src/jobs/ipni-reporting-daily-runner/ipni-reporting-daily-runner.service.ts';

@Controller()
export class AppController extends HealthIndicator {
  private readonly logger = new Logger(AppController.name);
  private readonly appStartTime = new Date();
  private lastHealthcheckFailedTime: Date | null = null;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly healthCheckService: HealthCheckService,
    private readonly httpHealthIndicator: HttpHealthIndicator,
    private readonly typeOrmHealthIndicator: TypeOrmHealthIndicator,
    private readonly postgresService: PostgresService,
    private readonly configService: ConfigService,
    private readonly ipniAdvertisementFetcherJobService: IpniAdvertisementFetcherJobService,
    private readonly ipniReportingDailyRunnerService: IpniReportingDailyRunnerService,
  ) {
    super();
  }

  @Get()
  @ApiExcludeEndpoint()
  public getRoot(): string {
    return 'Hyperion API';
  }

  @Get('/health')
  @HealthCheck({ noCache: true })
  @CacheTTL(1) // disable cache
  public async getHealth(): Promise<HealthCheckResult> {
    try {
      return {
        ...(await this._getHealth()),
        details: undefined,
      };
    } catch (err) {
      this.lastHealthcheckFailedTime = new Date();
      throw err;
    }
  }

  private async _getHealthMetadata(): Promise<HealthIndicatorResult> {
    return this.getStatus('app', true, {
      appStartTime: this.appStartTime,
      lastHealthcheckFailedTime: this.lastHealthcheckFailedTime,
    });
  }

  // cache http ping checks for better performance
  @Cacheable({ ttl: 1000 * 60 * 10 }) // 10 minutes
  private async _httpPingCheck(
    name: string,
    url: string,
  ): Promise<HealthIndicatorResult> {
    return this.httpHealthIndicator.pingCheck(name, url);
  }

  // dedicated cache for ipinfo.io because of token limits
  @Cacheable({ ttl: 1000 * 60 * 60 }) // 1 hour
  private async _httpPingCheckIpInfo(): Promise<HealthIndicatorResult> {
    return await this.httpHealthIndicator.pingCheck(
      'ipinfo.io',
      `https://ipinfo.io/8.8.8.8?token=${this.configService.get<string>('IP_INFO_TOKEN')}`,
    );
  }

  private async _httpPingCheckGlifApi(): Promise<HealthIndicatorResult> {
    const url = `${this.configService.get<string>('GLIF_API_BASE_URL')}/v1`;

    return await this.httpHealthIndicator.pingCheck('glif-api', url, {
      method: 'POST',
      headers: {
        ['Content-Type']: 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      },
    });
  }

  @Cacheable({ ttl: 1000 * 10 }) // 10 seconds
  private async _getHealth(): Promise<HealthCheckResult> {
    // prettier-ignore
    return this.healthCheckService.check([
      () => this._getHealthMetadata(),
      () => this._httpPingCheck('cid.contact', 'https://cid.contact/health'),
      () => this._httpPingCheckGlifApi(),
      () => this.typeOrmHealthIndicator.pingCheck('database', {
        connection: this.postgresService.pool,
        timeout: 5000,
      }),
      () => this.ipniAdvertisementFetcherJobService.getHealth(),
      () => this.ipniReportingDailyRunnerService.getHealth(),
    ]);
  }
}
