import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/db/prisma.service';
import { stringToNumber } from 'src/utils/utils';
import z from 'zod';
import {
  DEAL_MANIFEST_NESTED_SCHEMA,
  DEAL_MANIFEST_PIECES_LIST_SCHEMA,
  DEAL_MANIFEST_SCHEMA,
} from './po-rep-indexer.constants';
import {
  CachedManifestInvalidError,
  CachedManifestLocationMismatchError,
} from './po-rep-indexer.errors';
import {
  DealManifest,
  DealManifestPiece,
  DealManifestResult,
} from './po-rep-indexer.types';

// Manifest locations are chosen by whoever proposes the deal, so the fetch must
// not be able to hang the indexer or exhaust memory.
const MANIFEST_FETCH_TIMEOUT_MS = 30_000;
const MANIFEST_MAX_BYTES = 10 * 1024 * 1024;

@Injectable()
export class DealManifestService {
  constructor(private readonly prismaService: PrismaService) {}

  // Returns deal manifest from cache if present, otherwise fetches it from
  // `manifestLocation`. Never throws - errors are returned as a failed result
  // so a single unreachable manifest does not break the whole indexing run.
  public async readDealManifest(
    dealId: bigint,
    manifestLocation: string,
  ): Promise<DealManifestResult> {
    try {
      const cachedResult =
        await this.prismaService.po_rep_deal_manifest_cache.findFirst({
          where: { deal_id: dealId },
        });

      if (!cachedResult) {
        const manifestContent =
          await this.readDealManifestFromUrl(manifestLocation);

        return {
          success: true,
          dealId: dealId,
          manifestLocation: manifestLocation,
          data: {
            cached: false,
            manifestContent: manifestContent,
          },
        };
      }

      if (cachedResult.manifest_location !== manifestLocation) {
        throw new CachedManifestLocationMismatchError(
          dealId,
          manifestLocation,
          cachedResult.manifest_location,
        );
      }

      const parsedResult = DEAL_MANIFEST_SCHEMA.safeParse(
        cachedResult.manifest_content,
      );

      if (!parsedResult.success) {
        throw new CachedManifestInvalidError(dealId);
      }

      return {
        success: true,
        dealId: dealId,
        manifestLocation: manifestLocation,
        data: {
          cached: true,
          manifestContent: parsedResult.data,
        },
      };
    } catch (error) {
      return {
        success: false,
        dealId: dealId,
        manifestLocation: manifestLocation,
        error: error,
      };
    }
  }

  public async readDealManifestFromUrl(
    manifestLocation: string,
  ): Promise<DealManifest> {
    const urlResult = z
      .url({
        protocol: /^https?$/,
      })
      .safeParse(manifestLocation);

    if (urlResult.error) {
      throw new TypeError(
        `Manifest location "${manifestLocation}" is not a valid URL.`,
      );
    }

    const response = await fetch(manifestLocation, {
      headers: [['Accept', 'application/json']],
      // Covers the whole exchange, including reading the body.
      signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Could not fetch manifest contents at "${manifestLocation}". Got HTTP status ${response.status}.`,
      );
    }

    const json = JSON.parse(await this.readBodyWithLimit(response));
    const manifestResult = DEAL_MANIFEST_SCHEMA.safeParse(json);

    if (!manifestResult.success) {
      throw new TypeError(
        `Content of "${manifestLocation}" is not a valid manifest JSON.`,
      );
    }

    return manifestResult.data;
  }

  private async readBodyWithLimit(response: Response): Promise<string> {
    const tooLargeError = () =>
      new Error(
        `Manifest at "${response.url}" is larger than ${MANIFEST_MAX_BYTES} bytes.`,
      );

    if (
      stringToNumber(response.headers.get('content-length')) >
      MANIFEST_MAX_BYTES
    ) {
      throw tooLargeError();
    }

    const chunks: Uint8Array[] = [];
    let size = 0;

    // Leaving the loop early cancels the download.
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MANIFEST_MAX_BYTES) throw tooLargeError();
      chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString('utf8');
  }

  public extractDealManifestPieces(
    dealManifest: DealManifest,
  ): DealManifestPiece[] {
    const nestedParseResult =
      DEAL_MANIFEST_NESTED_SCHEMA.safeParse(dealManifest);

    if (nestedParseResult.success) {
      return nestedParseResult.data[0].pieces;
    }

    const piecesListParseResult =
      DEAL_MANIFEST_PIECES_LIST_SCHEMA.safeParse(dealManifest);

    if (piecesListParseResult.success) {
      return piecesListParseResult.data;
    }

    return [];
  }
}
