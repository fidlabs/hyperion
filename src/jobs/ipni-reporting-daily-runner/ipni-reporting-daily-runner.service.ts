import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from 'src/db/prisma.service';
import { LotusApiService } from 'src/service/lotus-api/lotus-api.service';
import { PoRepService } from 'src/service/po-rep/po-rep.service';
import { bigIntToNumber, F0Id } from 'src/utils/utils';
import {
  AggregatedProvidersIPNIReportingStatus,
  ProviderIPNIReportingStatus,
  StorageProviderIpniReportingStatus,
} from './types.ipni-reporting-daily-runner';
import { LotusStateMinerInfoResponse } from 'src/service/lotus-api/types.lotus-api';

@Injectable()
export class IpniReportingDailyRunnerService extends HealthIndicator {
  private readonly logger = new Logger(IpniReportingDailyRunnerService.name);
  private healthy = true;
  private jobInProgress = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly lotusApiService: LotusApiService,
    private readonly poRepService: PoRepService,
  ) {
    super();
  }

  public async getHealth(): Promise<HealthIndicatorResult> {
    const result = this.getStatus(
      IpniReportingDailyRunnerService.name,
      this.healthy,
      {},
    );

    if (this.healthy) return result;
    throw new HealthCheckError('Healthcheck failed', result);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  public async runIPNIReportingDailyRunnerJob() {
    if (!this.jobInProgress) {
      this.jobInProgress = true;

      try {
        this.logger.log('Starting IPNI Reporting Daily Runner job');
        this.healthy = true;

        await this._runIPNIReportingDailyRunnerJob();

        this.logger.log(`Finished IPNI Reporting Daily Runner job`);
      } catch (err) {
        this.healthy = false;
        this.logger.error(
          `Error while running IPNI Reporting Daily Runner job: ${err.message}`,
          err.cause?.stack || err.stack,
        );
      } finally {
        this.jobInProgress = false;
      }
    } else {
      this.logger.warn(
        'IPNI Reporting Daily Runner job is already in progress - skipping next execution',
      );
    }
  }

  public async _runIPNIReportingDailyRunnerJob() {
    const result = await this.getAggregatedProvidersReportingStatus();

    const data = {
      not_reporting: result.notReporting,
      misreporting: result.misreporting,
      ok: result.ok,
      total: result.total,
    };

    await this.prismaService.ipni_reporting_daily.create({ data: data });
  }

  // because of lotus api rate limiting, this function first tries to get all providers status in parallel
  // and then retries sequentially for failed requests
  // throws error if sequential retry fails for any provider
  public async getAggregatedProvidersReportingStatus(): Promise<AggregatedProvidersIPNIReportingStatus> {
    const storageProviders = await this.poRepService.getProviders();
    const result: ProviderIPNIReportingStatus[] = [];

    // try to execute all in parallel
    const promiseResults = await Promise.allSettled(
      storageProviders.map((storageProvider) =>
        this.getProviderReportingStatus(storageProvider),
      ),
    );

    for (let i = 0; i < promiseResults.length; i++) {
      if (promiseResults[i].status === 'fulfilled') {
        // prettier-ignore
        result.push((promiseResults[i] as PromiseFulfilledResult<ProviderIPNIReportingStatus>).value);
      } else {
        // retry sequentially for failed requests
        result.push(await this.getProviderReportingStatus(storageProviders[i]));
      }
    }

    return {
      misreporting: result.filter(
        (x) => x.status === StorageProviderIpniReportingStatus.MISREPORTING,
      ).length,
      notReporting: result.filter(
        (x) => x.status === StorageProviderIpniReportingStatus.NOT_REPORTING,
      ).length,
      ok: result.filter(
        (x) => x.status === StorageProviderIpniReportingStatus.OK,
      ).length,
      total: result.length,
    };
  }

  public async getProviderReportingStatus(
    storageProviderId: F0Id,
    minerInfo?: LotusStateMinerInfoResponse,
  ): Promise<ProviderIPNIReportingStatus> {
    minerInfo ??= await this.lotusApiService.getMinerInfo(
      storageProviderId.toString(),
    );

    const actualClaimsCount =
      await this.getProviderActualClaimsCount(storageProviderId);

    const ipniReportedClaimsCount =
      await this.getProviderIPNIReportedClaimsCountByPeerId(
        minerInfo.result.PeerId,
      );

    const status = !ipniReportedClaimsCount
      ? StorageProviderIpniReportingStatus.NOT_REPORTING
      : ipniReportedClaimsCount < actualClaimsCount * 0.5
        ? StorageProviderIpniReportingStatus.MISREPORTING
        : StorageProviderIpniReportingStatus.OK;

    return {
      status: status,
      actualClaimsCount: actualClaimsCount,
      ipniReportedClaimsCount: ipniReportedClaimsCount,
    };
  }

  private async getProviderActualClaimsCount(
    storageProviderId: F0Id,
  ): Promise<number> {
    return bigIntToNumber(
      (
        await this.prismaService.$queryRaw<{
          count: bigint;
        }>`
      SELECT count("po_rep_deal_pieces"."piece_cid")
      FROM "po_rep_deal_pieces"
               JOIN "po_rep_deal" ON "po_rep_deal"."dealId" = "po_rep_deal_pieces"."deal_id"
      WHERE "po_rep_deal"."providerId" = ${storageProviderId.toBigInt()};
    `
      )?.[0]?.count ?? 0n,
    );
  }

  private async getProviderIPNIReportedClaimsCountByPeerId(
    peerId?: string,
  ): Promise<number | null> {
    if (!peerId) return null;

    const dbEmpty =
      !(await this.prismaService.ipni_publisher_advertisement.findFirst({
        where: {
          publisher_id: peerId,
        },
      }));

    if (dbEmpty) return null;

    return bigIntToNumber(
      (
        await this.prismaService.ipni_publisher_advertisement.aggregate({
          _sum: {
            entries_number: true,
          },
          where: {
            publisher_id: peerId,
            is_rm: false,
          },
        })
      )._sum.entries_number,
    );
  }
}
