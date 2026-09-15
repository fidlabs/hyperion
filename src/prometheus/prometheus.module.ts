import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrometheusModule as PrometheusModuleSource } from '@willsoto/nestjs-prometheus';
import { PrismaService } from 'src/db/prisma.service';
import { PgPoolMetrics } from './db-metrics';
import { pgPoolPrometheusMetrics } from './db-metrics/metrics';
import { PrometheusCustomMetricController } from './prometheus-custom.controller';
import { PrometheusMetricController } from './prometheus.controller';
import { PrometheusMetricService } from './prometheus.service';
import { AggregateMetrics } from './aggregate-metrics';
import { aggregatePrometheusMetrics } from './aggregate-metrics/metrics';

@Module({
  imports: [
    PrometheusModuleSource.register({
      customMetricPrefix: 'hyperion',
      controller: PrometheusCustomMetricController,
      defaultMetrics: {
        enabled: false,
      },
    }),
  ],
  controllers: [PrometheusMetricController],
  providers: [
    ...aggregatePrometheusMetrics,
    ...pgPoolPrometheusMetrics,
    PrometheusMetricService,
    PrismaService,
    PgPoolMetrics,
    ConfigService,
    AggregateMetrics,
  ],
  exports: [PrometheusMetricService],
})
export class PrometheusMetricModule {}
