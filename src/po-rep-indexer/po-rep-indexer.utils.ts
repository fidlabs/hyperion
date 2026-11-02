import { createPublicClient, extractChain, http, rpcSchema } from 'viem';
import z from 'zod';
import {
  PO_REP_CONFIG_SCHEMA,
  PO_REP_SUPPORTED_CHAINS,
} from './po-rep-indexer.constants';
import {
  FilecoinRpcSchema,
  PoRepConfig,
  PoRepPublicClient,
} from './po-rep-indexer.types';

type SupportedChainId = (typeof PO_REP_SUPPORTED_CHAINS)[number]['id'];

export interface GetClientForChainOptions {
  chainId: number;
  rpcUrl?: string | null;
  authToken?: string | null;
}

const filecoinRpcSchema = rpcSchema<FilecoinRpcSchema>();

function assertIsSupportedChainId(
  chainId: number,
): asserts chainId is SupportedChainId {
  const isSupported = PO_REP_SUPPORTED_CHAINS.map(
    (chain) => chain.id as number,
  ).includes(chainId);

  if (!isSupported) {
    throw new TypeError(`Unsupported PoRep Market chain id: "${chainId}"`);
  }
}

export function createClientForChainOrThrow({
  chainId,
  rpcUrl,
  authToken,
}: GetClientForChainOptions): PoRepPublicClient {
  assertIsSupportedChainId(chainId);

  const chain = extractChain({ chains: PO_REP_SUPPORTED_CHAINS, id: chainId });
  const transport = http(rpcUrl ?? undefined, {
    fetchOptions:
      typeof authToken === 'string' && authToken !== ''
        ? {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          }
        : undefined,
    timeout: 60_000,
  });

  const client = createPublicClient({
    chain: chain,
    transport,
    rpcSchema: filecoinRpcSchema,
  }).extend((client) => ({
    filecoin: {
      chainGetFinalizedTipSet() {
        return client.request({
          method: 'Filecoin.ChainGetFinalizedTipSet',
          params: [],
        });
      },
    },
  })) as unknown as PoRepPublicClient;

  return client;
}

export function validatePoRepConfig(
  config: Record<string, unknown>,
): PoRepConfig {
  const result = PO_REP_CONFIG_SCHEMA.safeParse(config);

  if (!result.success) {
    throw new TypeError(
      `Invalid PoRep config provided:\n\n${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
}
