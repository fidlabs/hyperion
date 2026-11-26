import { F0Id } from 'src/utils/utils';
import { PoRepDealState } from '../auto-generated/enums';
import { QueryBuilder } from '../query-builder';
import { createGenericStringFilter } from './helpers/create-generic-string-filter.helper';

type F0IdLike = Parameters<typeof F0Id.from>[0];

export interface CreatePoRepProvidersQueryParameters {
  providersIds?: F0IdLike | F0IdLike[] | null;
  active?: boolean | null;
}

function mapF0IdLike(input: F0IdLike): string {
  return F0Id.from(input).toBigInt().toString();
}

export function createPoRepProvidersQuery(
  qb: QueryBuilder,
  { providersIds, active = null }: CreatePoRepProvidersQueryParameters = {},
) {
  return qb
    .selectFrom('po_rep_storage_provider as p')
    .leftJoin('po_rep_deal as d', (join) =>
      join
        .onRef('d.providerId', '=', 'p.providerId')
        .on('d.state', 'in', [PoRepDealState.ACCEPTED, PoRepDealState.ACTIVE]),
    )
    .select((eb) => [
      'p.providerId as provider_id',
      'p.paused',
      'p.blocked',
      'p.availableBytes as available_bytes',
      'p.committedBytes as committed_bytes',
      'p.pendingBytes as pending_bytes',
      'p.registeredAtBlock as registered_at_block',
      eb.fn.count('d.dealId').as('active_deals_count'),
    ])
    .where((eb) =>
      createGenericStringFilter(
        eb.ref('p.providerId'),
        providersIds,
        mapF0IdLike,
      ),
    )
    .$if(active !== null, (query) =>
      query.where((eb) =>
        active
          ? eb.and([eb('p.paused', '=', false), eb('p.blocked', '=', false)])
          : eb.or([eb('p.paused', '=', true), eb('p.blocked', '=', true)]),
      ),
    )
    .groupBy('p.providerId');
}
