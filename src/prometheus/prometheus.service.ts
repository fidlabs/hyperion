import { Injectable } from '@nestjs/common';
import { PgPoolMetrics } from './db-metrics';
import { AggregateMetrics } from './aggregate-metrics';

@Injectable()
export class PrometheusMetricService {
  constructor(
    public readonly pgPoolMetrics: PgPoolMetrics,
    public readonly aggregateMetrics: AggregateMetrics,
  ) {}

  updatePgPoolMetrics(
    totalCount: number,
    idleCount: number,
    waitingCount: number,
  ) {
    try {
      this.pgPoolMetrics.setPgPoolExistClientCount(totalCount);
      this.pgPoolMetrics.setPgPoolIdleClientCount(idleCount);
      this.pgPoolMetrics.setPgPoolWaitingClientCount(waitingCount);
    } catch (err) {
      console.error('Error fetching PGPool connections:', err);
    }
  }
}
