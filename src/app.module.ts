import { HttpModule, HttpService } from '@nestjs/axios';
import { CacheInterceptor, CacheModule } from '@nestjs/cache-manager';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import axios from 'axios';
import axiosBetterStacktrace from 'axios-better-stacktrace';
import { AppController } from './controller/app/app.controller';
import { FilecoinPayController } from './controller/filecoin-pay/filecoin-pay.controller';
import { PoRepController } from './controller/po-rep/po-rep.controller';
import { PostgresService } from './db/postgres.service';
import { PrismaService } from './db/prisma.service';
import { IpniAdvertisementFetcherJobService } from './jobs/ipni-advertisement-fetcher-job/ipni-advertisement-fetcher-job.service';
import { ErrorHandlerMiddleware } from './middleware/error-handler.middleware';
import { RequestLoggerMiddleware } from './middleware/request-logger.middleware';
import { PoRepIndexerModule } from './po-rep-indexer';
import { PrometheusMetricModule } from './prometheus';
import { StorageProviderService } from './service/storage-provider/storage-provider.service';
import { CidContactService } from './service/cid-contact/cid-contact.service';
import { ERC20TokenInfoService } from './service/erc20-token-info/erc20-token-info.service';
import { EthApiService } from './service/eth-api/eth-api.service';
import { IpniMisreportingCheckerService } from './service/ipni-misreporting-checker/ipni-misreporting-checker.service';
import { LocationService } from './service/location/location.service';
import { LotusApiService } from './service/lotus-api/lotus-api.service';
import { PoRepPriceOracleService } from './service/po-rep-price-oracle/po-rep-price-oracle.service';
import { PoRepService } from './service/po-rep/po-rep.service';
import { queryBuilderProviders } from './db';
import { IpniReportingDailyRunnerService } from 'src/jobs/ipni-reporting-daily-runner/ipni-reporting-daily-runner.service.ts';

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
  controllers: [PoRepController, FilecoinPayController, AppController],
  providers: [
    IpniAdvertisementFetcherJobService,
    IpniReportingDailyRunnerService,
    PrismaService,
    StorageProviderService,
    CidContactService,
    LocationService,
    ERC20TokenInfoService,
    EthApiService,
    LotusApiService,
    IpniMisreportingCheckerService,
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
