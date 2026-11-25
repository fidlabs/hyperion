import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrometheusMetricModule } from 'src/prometheus';
import { PostgresService } from './postgres.service';
import { queryBuilderProviders } from './query-builder';

@Module({
  imports: [ConfigModule, PrometheusMetricModule],
  providers: [PostgresService, ...queryBuilderProviders],
  exports: [PostgresService, ...queryBuilderProviders],
})
export class DbModule {}
