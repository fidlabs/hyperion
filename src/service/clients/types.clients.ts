import { CreateClientsListQueryParameters } from 'src/db/queries/clients.query';
import {
  PaginationMetadata,
  PaginationParameters,
  PoRepClientWalletStatus,
} from '../po-rep/types.po-rep';

export interface ClientsServiceListParameters extends PaginationParameters {
  service?: CreateClientsListQueryParameters['service'];
}

export interface ClientsServiceListEntry {
  clientAddress: string;
  datasetsCount: {
    total: number;
    fcss: number | null;
    fwss: number | null;
  };
  walletStatus: PoRepClientWalletStatus;
}

export interface ClientsServiceList {
  data: ClientsServiceListEntry[];
  pagination: PaginationMetadata;
}
