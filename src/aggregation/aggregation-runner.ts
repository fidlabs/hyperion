import { PostgresService } from 'src/db/postgres.service';

import { PrismaService } from 'src/db/prisma.service';
import { PrometheusMetricService } from 'src/prometheus';
import { StorageProviderService } from '../service/storage-provider/storage-provider.service';
import { AggregationTable } from './aggregation-table';
import { PoRepService } from '../service/po-rep/po-rep.service';
import { IpniMisreportingCheckerService } from 'src/service/ipni-misreporting-checker/ipni-misreporting-checker.service';

export type AggregationRunnerRunServices = {
  prismaService: PrismaService;
  postgresService?: PostgresService;
  prometheusMetricService?: PrometheusMetricService;
  storageProviderService: StorageProviderService;
  ipniMisreportingCheckerService: IpniMisreportingCheckerService;
  porepService: PoRepService;
};

export interface AggregationRunner {
  run(services: AggregationRunnerRunServices): Promise<void>;

  getFilledTables(): AggregationTable[];

  getDependingTables(): AggregationTable[];
}
