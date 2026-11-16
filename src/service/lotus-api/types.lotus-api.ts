export interface LotusStateMinerInfoResponse {
  jsonrpc: string;
  result: LotusStateMinerInfoResult;
  id: number;
}

interface LotusStateMinerInfoResult {
  Beneficiary: string;
  BeneficiaryTerm: BeneficiaryTerm;
  ConsensusFaultElapsed: number;
  ControlAddresses: string[];
  Multiaddrs: string[];
  NewWorker: string;
  Owner: string;
  PeerId: string | null;
  PendingBeneficiaryTerm: null;
  PendingOwnerAddress: null;
  SectorSize: number;
  WindowPoStPartitionSectors: number;
  WindowPoStProofType: number;
  Worker: string;
  WorkerChangeEpoch: number;
}

interface BeneficiaryTerm {
  Expiration: number;
  Quota: string;
  UsedQuota: string;
}
