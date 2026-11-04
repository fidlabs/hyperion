import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Semaphore } from 'async-mutex';
import { DateTime } from 'luxon';
import { lastValueFrom } from 'rxjs';
import { Cacheable } from 'src/utils/cacheable';
import { Retryable } from 'src/utils/retryable';
import {
  UrlFinderDealMeasurement,
  UrlFinderDealSliHistoryResponse,
} from './types.url-finder';

const historyRangeDays = 31;
const historyRangesStart = DateTime.fromMillis(0, { zone: 'UTC' });
const maxConcurrentRequests = 10;

@Injectable()
export class UrlFinderService {
  private readonly requestsSemaphore = new Semaphore(maxConcurrentRequests);

  constructor(
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  public async getDealMeasurements(
    dealId: bigint,
    from: DateTime,
    to: DateTime,
  ): Promise<UrlFinderDealMeasurement[]> {
    const ranges: [string, string][] = [];
    const today = DateTime.utc().startOf('day');
    const firstRangeIndex = Math.floor(
      from.diff(historyRangesStart, 'days').days / historyRangeDays,
    );

    for (
      let rangeStart = historyRangesStart.plus({
        days: firstRangeIndex * historyRangeDays,
      });
      rangeStart <= to;
      rangeStart = rangeStart.plus({ days: historyRangeDays })
    ) {
      const rangeEnd = DateTime.min(
        rangeStart.plus({ days: historyRangeDays - 1 }),
        today,
      );

      ranges.push([rangeStart.toISODate(), rangeEnd.toISODate()]);
    }

    const history = await Promise.all(
      ranges.map(([rangeFrom, rangeTo]) =>
        this.getDealSliHistory(dealId.toString(), rangeFrom, rangeTo),
      ),
    );

    return history.flat().filter((measurement) => {
      if (!measurement.tested_at) {
        return false;
      }

      const testedAt = DateTime.fromISO(measurement.tested_at, { zone: 'UTC' });
      return testedAt >= from && testedAt <= to;
    });
  }

  @Cacheable({ ttl: 1000 * 60 * 60 * 24 }) // 24 hours
  private async getDealSliHistory(
    dealId: string,
    from: string,
    to: string,
  ): Promise<UrlFinderDealMeasurement[]> {
    const measurements: UrlFinderDealMeasurement[] = [];
    let cursor: string | null = null;

    do {
      const page = await this.getDealSliHistoryPage(dealId, from, to, cursor);

      if (page === null) {
        return [];
      }

      measurements.push(...Object.values(page.data).flat());
      cursor = page.next_cursor;
    } while (cursor !== null);

    return measurements;
  }

  @Retryable({ retries: 3, delay: 5000 }) // 5 seconds
  private async getDealSliHistoryPage(
    dealId: string,
    from: string,
    to: string,
    cursor: string | null,
  ): Promise<UrlFinderDealSliHistoryResponse | null> {
    const endpoint = `${this.configService.get<string>('URL_FINDER_API_URL')}/deals/${dealId}/history/sli`;

    try {
      const { data } = await this.requestsSemaphore.runExclusive(() =>
        lastValueFrom(
          this.httpService.get<UrlFinderDealSliHistoryResponse>(endpoint, {
            params: {
              from: from,
              to: to,
              limit: 500,
              cursor: cursor ?? undefined,
            },
          }),
        ),
      );

      return data;
    } catch (err) {
      if (err.response?.status === HttpStatus.NOT_FOUND) {
        return null;
      }

      throw new Error(
        `Error fetching URL Finder SLI history for deal ${dealId}: ${err.message}`,
        { cause: err },
      );
    }
  }
}
