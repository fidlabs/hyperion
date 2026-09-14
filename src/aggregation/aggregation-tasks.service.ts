import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrometheusMetricService } from 'src/prometheus';
import { sleep } from 'src/utils/utils';
import { PostgresService } from '../db/postgres.service';
import { PrismaService } from '../db/prisma.service';
import { IpniMisreportingCheckerService } from '../service/ipni-misreporting-checker/ipni-misreporting-checker.service';
import { PoRepService } from '../service/po-rep/po-rep.service';
import { StorageProviderService } from '../service/storage-provider/storage-provider.service';
import { AggregationRunner } from './aggregation-runner';
import { AggregationTable } from './aggregation-table';

@Injectable()
export class AggregationTasksService extends HealthIndicator {
  private readonly logger = new Logger(AggregationTasksService.name);
  private jobInProgress = false;
  private healthy = true;
  private unhealthyReason: string = null;
  private lastSuccess: Date = null;
  private lastRun: Date = null;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly postgresService: PostgresService,

    @Inject('AggregationRunner')
    private readonly aggregationRunners: AggregationRunner[],
    private readonly prometheusMetricService: PrometheusMetricService,
    private readonly ipniMisreportingCheckerService: IpniMisreportingCheckerService,
    private readonly storageProviderService: StorageProviderService,
    private readonly porepService: PoRepService,
  ) {
    super();
  }

  public async getHealth(): Promise<HealthIndicatorResult> {
    const result = this.getStatus(AggregationTasksService.name, this.healthy, {
      lastSuccess: this.lastSuccess,
      lastRun: this.lastRun,
      unhealthyReason: this.healthy ? null : this.unhealthyReason,
    });

    if (this.healthy) return result;
    throw new HealthCheckError('Healthcheck failed', result);
  }

  @Cron(CronExpression.EVERY_HOUR)
  public async runAggregationJob() {
    if (!this.jobInProgress) {
      this.jobInProgress = true;
      const endAllAggregationsTimer =
        this.prometheusMetricService.aggregateMetrics.startAggregateTimer();

      try {
        this.logger.log('Starting aggregations');
        this.lastRun = new Date();
        this.healthy = true;

        await this.runAggregations();

        this.lastSuccess = new Date();
        this.logger.log('Finished aggregations');
      } catch (err) {
        this.healthy = false;
        this.unhealthyReason = err.message || 'Unknown error';

        this.logger.error(
          `Error during aggregation job: ${err.message}`,
          // err.cause?.stack || err.stack,
        );
      } finally {
        endAllAggregationsTimer();
        this.jobInProgress = false;
      }
    } else {
      this.logger.warn(
        'Aggregations job still in progress - skipping next execution',
      );
    }
  }

  public async runAggregations() {
    const filledTables: AggregationTable[] = [];
    const pendingAggregationRunners = Object.assign(
      [],
      this.aggregationRunners,
    );

    while (pendingAggregationRunners.length > 0) {
      let executedRunners = 0;

      for (const aggregationRunner of this.aggregationRunners) {
        if (
          pendingAggregationRunners.indexOf(aggregationRunner) > -1 &&
          aggregationRunner
            .getDependingTables()
            .every((p) => filledTables.includes(p))
        ) {
          // execute runner
          const aggregationRunnerName = aggregationRunner.constructor.name;
          this.logger.debug(`Starting aggregation: ${aggregationRunnerName}`);

          // start transaction timer
          const endSingleAggregationTransactionTimer =
            this.prometheusMetricService.aggregateMetrics.startTimerByRunnerNameMetric(
              aggregationRunnerName,
            );

          try {
            await this.executeWithRetries(
              3,
              () =>
                // prettier-ignore
                aggregationRunner.run({
                  prismaService: this.prismaService,
                  postgresService: this.postgresService,
                  prometheusMetricService: this.prometheusMetricService,
                  ipniMisreportingCheckerService: this.ipniMisreportingCheckerService,
                  storageProviderService: this.storageProviderService,
                  porepService: this.porepService,
                }),
              aggregationRunnerName,
            );
          } catch (err) {
            throw new Error(
              `Error running ${aggregationRunnerName}: ${err.message || err.code || err}`,
              { cause: err },
            );
          } finally {
            endSingleAggregationTransactionTimer();
          }

          this.logger.debug(`Finished aggregation: ${aggregationRunnerName}`);

          executedRunners++;

          // store filled tables
          filledTables.push(...aggregationRunner.getFilledTables());

          // remove from pending runners
          pendingAggregationRunners.splice(
            pendingAggregationRunners.indexOf(aggregationRunner),
            1,
          );
        }
      }

      if (executedRunners === 0) {
        this.logger.error(
          'Cannot execute runners - impossible dependencies defined',
        );

        break;
      }
    }
  }

  private async executeWithRetries(
    maxTries: number,
    fn: () => Promise<void>,
    aggregationRunnerName: string,
  ) {
    let success = false;
    let executionNumber = 0;
    let lastErr: Error = null;

    while (!success && executionNumber < maxTries) {
      try {
        await fn();
        success = true;
      } catch (err) {
        lastErr = err;
        executionNumber++;

        this.logger.warn(
          `Error during aggregation job: ${aggregationRunnerName}, execution ${executionNumber}/${maxTries}: ${err.message || err.code || err}`,
        );

        if (executionNumber !== maxTries) await sleep(90000); // 90 seconds
      }
    }

    if (!success) throw lastErr;
  }
}
