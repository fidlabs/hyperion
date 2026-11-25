import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { InjectQueryBuilder, QueryBuilder } from 'src/db';
import {
  createClientsCountQuery,
  createClientsListQuery,
} from 'src/db/queries/clients.query';
import { PoRepPublicClient, RECENT_NODE_CLIENT } from 'src/po-rep-indexer';
import { dateToFilecoinBlockHeight, stringToNumber } from 'src/utils/utils';
import { filecoinCalibration } from 'viem/chains';
import {
  ClientsServiceList,
  ClientsServiceListParameters,
} from './types.clients';

const walletLowBalanceDays = 30;

@Injectable()
export class ClientsService {
  constructor(
    @Inject(RECENT_NODE_CLIENT)
    private readonly recentNodeClient: PoRepPublicClient,
    @InjectQueryBuilder() private readonly queryBuilder: QueryBuilder,
  ) {}

  public async getClients({
    service = 'all',
    limit = 0,
    page = 1,
  }: ClientsServiceListParameters): Promise<ClientsServiceList> {
    const now = DateTime.utc();
    const baseQuery = createClientsListQuery(this.queryBuilder, {
      service: service,
      currentEpoch: dateToFilecoinBlockHeight(now.toJSDate(), {
        testnet: this.isTestnet(),
      }),
      lowBalanceEpoch: dateToFilecoinBlockHeight(
        now.plus({ days: walletLowBalanceDays }).toJSDate(),
        { testnet: this.isTestnet() },
      ),
    });
    let resultsQuery = baseQuery
      .orderBy('datasets_count', 'desc')
      .orderBy('client_address', 'asc');

    if (limit) {
      resultsQuery = resultsQuery.limit(limit).offset((page - 1) * limit);
    }

    const [results, countResult] = await Promise.all([
      resultsQuery.execute(),
      createClientsCountQuery(this.queryBuilder, {
        service: service,
      }).executeTakeFirstOrThrow(),
    ]);

    const totalCount = stringToNumber(countResult.count.toString()) ?? 0;

    return {
      data: results.map((result) => {
        return {
          clientAddress: result.client_address,
          datasetsCount: {
            total: stringToNumber(result.datasets_count),
            fcss: stringToNumber(result.fcss_datasets_count),
            fwss: null,
          },
          walletStatus: result.wallet_status,
        };
      }),
      pagination: {
        page: page,
        pagesCount: limit ? Math.ceil(totalCount / limit) : 1,
        totalCount: totalCount,
      },
    };
  }

  private isTestnet(): boolean {
    return this.recentNodeClient.chain.id === filecoinCalibration.id;
  }
}
