export class CachedManifestLocationMismatchError extends Error {
  constructor(
    dealId: bigint,
    expectedLocation: string,
    cachedLocation: string,
  ) {
    super(
      `Cached manifest for deal "${dealId}" has a location mismatch. Given "${expectedLocation}" but cached manifest says "${cachedLocation}".`,
    );
  }
}

export class UnknownDealTypeError extends Error {
  constructor(contractValue: number) {
    super(
      `Unknown deal type "${contractValue}" returned by PoRep Market contract.`,
    );
  }
}

export class CachedManifestInvalidError extends Error {
  constructor(dealId: bigint) {
    super(`Invalid cached manifest for deal "${dealId}" found.`);
  }
}
