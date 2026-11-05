export interface UrlFinderDealPorepSlis {
  retrievability_bps: number | null;
  bandwidth_mbps: number | null;
  latency_ms: number | null;
  indexing_pct: number | null;
}

export interface UrlFinderDealMeasurement {
  deal_id: string;
  measurement_state: string;
  tested_at: string | null;
  porep_slis: UrlFinderDealPorepSlis;
}

export interface UrlFinderDealSliHistoryResponse {
  deal_id: string;
  from: string;
  to: string;
  data: Record<string, UrlFinderDealMeasurement[]>;
  next_cursor: string | null;
}
