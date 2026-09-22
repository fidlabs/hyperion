import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from 'src/db/prisma.service';
import { IpniMisreportingCheckerService } from 'src/service/ipni-misreporting-checker/ipni-misreporting-checker.service';

@Injectable()
export class IpniReportingDailyRunnerService extends HealthIndicator {
  private readonly logger = new Logger(IpniReportingDailyRunnerService.name);
  private healthy = true;
  private jobInProgress = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly ipniMisreportingCheckerService: IpniMisreportingCheckerService,
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

  @Cron(CronExpression.EVERY_DAY_AT_10PM)
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
    const result =
      await this.ipniMisreportingCheckerService.getAggregatedProvidersReportingStatus();

    const data = {
      not_reporting: result.notReporting,
      misreporting: result.misreporting,
      ok: result.ok,
      total: result.total,
    };

    await this.prismaService.ipni_reporting_daily.create({ data: data });
  }
}
