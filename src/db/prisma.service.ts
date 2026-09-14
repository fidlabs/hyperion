import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Gauge, Registry } from 'prom-client';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly metrics = new Registry();

  constructor(configService: ConfigService) {
    const pool = new Pool({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      connectionTimeoutMillis: 5000,
    });
    super({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
    this.metrics.setDefaultLabels({
      env: configService.get<string>('PROMETHEUS_METRICS_ENV') ?? 'unknown',
    });
    for (const [name, help, value] of [
      [
        'prisma_pool_connections_open',
        'Open Prisma PostgreSQL connections',
        () => pool.totalCount,
      ],
      [
        'prisma_pool_connections_idle',
        'Idle Prisma PostgreSQL connections',
        () => pool.idleCount,
      ],
      [
        'prisma_pool_connections_busy',
        'Busy Prisma PostgreSQL connections',
        () => pool.totalCount - pool.idleCount,
      ],
      [
        'prisma_pool_connections_waiting',
        'Requests waiting for a Prisma PostgreSQL connection',
        () => pool.waitingCount,
      ],
    ] as const) {
      new Gauge({
        name: name,
        help: help,
        registers: [this.metrics],
        collect: function () {
          this.set(value());
        },
      });
    }
  }

  public async onModuleInit() {
    await this.$connect();
  }

  public async onModuleDestroy() {
    await this.$disconnect();
  }

  async getMetrics() {
    return this.metrics.metrics();
  }
}
