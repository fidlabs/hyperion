import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { lastValueFrom } from 'rxjs';
import { Cacheable } from 'src/utils/cacheable';
import {
  UrlFinderDealMeasurement,
  UrlFinderDealSliHistoryResponse,
} from './types.url-finder';

const maxHistoryRangeDays = 30;

@Injectable()
export class UrlFinderService {
  private readonly logger = new Logger(UrlFinderService.name);

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

    for (
      let rangeStart = from.startOf('day');
      rangeStart <= to;
      rangeStart = rangeStart.plus({ days: maxHistoryRangeDays + 1 })
    ) {
      const rangeEnd = DateTime.min(
        rangeStart.plus({ days: maxHistoryRangeDays }),
        to,
      );

      ranges.push([rangeStart.toISODate(), rangeEnd.toISODate()]);
    }

    const history = await Promise.all(
      ranges.map(([rangeFrom, rangeTo]) =>
        this.getDealSliHistory(dealId.toString(), rangeFrom, rangeTo),
      ),
    );

    const measurements = history.every((item) => item !== null)
      ? history.flat()
      : [await this.getDealLatestMeasurement(dealId.toString())];

    return measurements.filter((measurement) => {
      if (!measurement?.tested_at) {
        return false;
      }

      const testedAt = DateTime.fromISO(measurement.tested_at, { zone: 'UTC' });
      return testedAt >= from && testedAt <= to;
    });
  }

  @Cacheable({ ttl: 1000 * 60 * 60 }) // 1 hour
  private async getDealSliHistory(
    dealId: string,
    from: string,
    to: string,
  ): Promise<UrlFinderDealMeasurement[] | null> {
    const endpoint = `${this.configService.get<string>('URL_FINDER_API_URL')}/deals/${dealId}/history/sli`;
    const measurements: UrlFinderDealMeasurement[] = [];
    let cursor: string | null = null;

    try {
      do {
        const { data } = await lastValueFrom(
          this.httpService.get<UrlFinderDealSliHistoryResponse>(endpoint, {
            params: {
              from: from,
              to: to,
              limit: 500,
              cursor: cursor ?? undefined,
            },
          }),
        );

        measurements.push(...Object.values(data.data).flat());
        cursor = data.next_cursor;
      } while (cursor !== null);

      return measurements;
    } catch (err) {
      this.logger.warn(
        `Error fetching URL Finder SLI history for deal ${dealId}: ${err.message}`,
      );

      return null;
    }
  }

  @Cacheable({ ttl: 1000 * 60 * 60 }) // 1 hour
  private async getDealLatestMeasurement(
    dealId: string,
  ): Promise<UrlFinderDealMeasurement | null> {
    const endpoint = `${this.configService.get<string>('URL_FINDER_API_URL')}/deals/${dealId}/latest`;

    try {
      const { data } = await lastValueFrom(
        this.httpService.get<UrlFinderDealMeasurement>(endpoint),
      );

      return data;
    } catch (err) {
      this.logger.warn(
        `Error fetching URL Finder latest measurement for deal ${dealId}: ${err.message}`,
      );

      return null;
    }
  }
}
