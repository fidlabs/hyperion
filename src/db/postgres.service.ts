import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrometheusMetricService } from 'src/prometheus';

@Injectable()
export class PostgresService implements OnModuleInit {
  private readonly logger = new Logger(PostgresService.name);
  public pool: Pool;

  constructor(
    public readonly prometheusService: PrometheusMetricService,
    configService: ConfigService,
  ) {
    this.pool = new Pool({
      connectionString: configService.get<string>('DATABASE_URL'),
    });

    // Without a listener, an error on an idle connection (database restart,
    // failover, network reset) is an unhandled 'error' event and kills the
    // process. The pool removes the broken connection by itself.
    this.pool.on('error', (err) => {
      this.logger.error(
        `Idle database connection failed: ${err.message}`,
        err.stack,
      );
    });
  }

  updatePoolStats() {
    const { totalCount, idleCount, waitingCount } = this.pool;

    this.prometheusService.updatePgPoolMetrics(
      totalCount,
      idleCount,
      waitingCount,
    );
  }

  public async onModuleInit() {
    this.pool.on('connect', () => {
      this.updatePoolStats();
    });
    this.pool.on('acquire', () => {
      this.updatePoolStats();
    });
    this.pool.on('remove', () => {
      this.updatePoolStats();
    });
  }
}
