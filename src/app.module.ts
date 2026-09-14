import { HttpModule, HttpService } from '@nestjs/axios';
import { CacheInterceptor, CacheModule } from '@nestjs/cache-manager';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import axios from 'axios';
import axiosBetterStacktrace from 'axios-better-stacktrace';
import { AggregationTasksService } from './aggregation/aggregation-tasks.service';
import { AppController } from './controller/app/app.controller';
import { FilecoinPayController } from './controller/filecoin-pay/filecoin-pay.controller';
import { PoRepController } from './controller/po-rep/po-rep.controller';
import { StorageProvidersController } from './controller/storage-providers/storage-providers.controller';
import { PostgresService } from './db/postgres.service';
import { PrismaService } from './db/prisma.service';
import { IpniAdvertisementFetcherJobService } from './jobs/ipni-advertisement-fetcher-job/ipni-advertisement-fetcher-job.service';
import { ErrorHandlerMiddleware } from './middleware/error-handler.middleware';
import { RequestLoggerMiddleware } from './middleware/request-logger.middleware';
import { PoRepIndexerModule } from './po-rep-indexer';
import { PrometheusMetricModule } from './prometheus';
import { StorageProviderService } from './service/storage-provider/storage-provider.service';

import { PoRepPriceOracleService } from './service/po-rep-price-oracle/po-rep-price-oracle.service';
import { PoRepService } from './service/po-rep/po-rep.service';

import { queryBuilderProviders } from './db';

const AGGREGATION_RUNNERS = [];

const AGGREGATION_RUNNERS_RUN_ONLY = [];

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    HttpModule.register({ timeout: 5000 }), // 5 seconds
    CacheModule.register({ ttl: 1000 * 60, max: 100000 }), // 1 minute
    TerminusModule.forRoot(),
    PrometheusMetricModule,
    PoRepIndexerModule,
  ],
  controllers: [
    StorageProvidersController,
    PoRepController,
    FilecoinPayController,
    AppController,
  ],
  providers: [
    ...(AGGREGATION_RUNNERS_RUN_ONLY.length
      ? AGGREGATION_RUNNERS_RUN_ONLY
      : AGGREGATION_RUNNERS),
    AggregationTasksService,
    IpniAdvertisementFetcherJobService,
    PrismaService,
    StorageProviderService,
    PostgresService,
    PoRepPriceOracleService,
    PoRepService,
    { provide: APP_FILTER, useClass: ErrorHandlerMiddleware },
    { provide: APP_INTERCEPTOR, useClass: CacheInterceptor },
    {
      provide: 'AXIOS_INSTANCE',
      useFactory: () => {
        const axiosInstance = axios.create();
        axiosBetterStacktrace(axiosInstance);
        return axiosInstance;
      },
    },
    {
      provide: 'AggregationRunner',
      useFactory: (...runners) => runners,
      inject: AGGREGATION_RUNNERS_RUN_ONLY.length
        ? AGGREGATION_RUNNERS_RUN_ONLY
        : AGGREGATION_RUNNERS,
    },
    ...queryBuilderProviders,
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly httpService: HttpService) {
    axiosBetterStacktrace(this.httpService.axiosRef);
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
