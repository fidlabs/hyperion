import { F0Id } from 'src/utils/utils';
import { PoRepDealState } from '../auto-generated/enums';
import { QueryBuilder } from '../query-builder';
import { createGenericStringFilter } from './helpers/create-generic-string-filter.helper';

type F0IdLike = Parameters<typeof F0Id.from>[0];

export interface CreatePoRepOnboardedDealsQueryParameters {
  providersIds?: F0IdLike | F0IdLike[] | null;
  dealsIds?: string | string[] | null;
  clientsAddresses?: string | string[] | null;
}

const endedDealStates = [
  PoRepDealState.FINALIZED,
  PoRepDealState.EXPIRED,
  PoRepDealState.EARLY_TERMINATED,
];

function mapF0IdLike(input: F0IdLike): string {
  return F0Id.from(input).toBigInt().toString();
}

export function createPoRepOnboardedDealsQuery(
  qb: QueryBuilder,
  {
    providersIds,
    dealsIds,
    clientsAddresses,
  }: CreatePoRepOnboardedDealsQueryParameters = {},
) {
  return qb
    .selectFrom('po_rep_deal as d')
    .innerJoin('po_rep_deal_requirements as dr', 'dr.dealId', 'd.dealId')
    .innerJoin('filecoin_pay_rail as r', 'r.railId', 'd.railId')
    .leftJoin('po_rep_deal_state_change as sc', (join) =>
      join
        .onRef('sc.deal_id', '=', 'd.dealId')
        .on('sc.state', 'in', endedDealStates),
    )
    .select((eb) => [
      'd.dealId as deal_id',
      'd.providerId as provider_id',
      'd.totalDealSize as deal_size_bytes',
      'dr.retrievabilityBps as required_retrievability_bps',
      'dr.bandwidthBytesPerSecond as required_bandwidth_bytes_per_second',
      'dr.latencyMs as required_latency_ms',
      'r.activatedAtBlock as onboarded_at_epoch',
      eb.fn.min('sc.changed_at_block').as('ended_at_epoch'),
    ])
    .where('r.activatedAtBlock', '>', '0')
    .where((eb) =>
      createGenericStringFilter(
        eb.ref('d.providerId'),
        providersIds,
        mapF0IdLike,
      ),
    )
    .where((eb) => createGenericStringFilter(eb.ref('d.dealId'), dealsIds))
    .where((eb) =>
      createGenericStringFilter(eb.ref('d.client'), clientsAddresses),
    )
    .groupBy(['d.dealId', 'dr.dealId', 'r.railId']);
}
