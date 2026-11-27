import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import {
  InjectQueryBuilder,
  type QueryBuilder,
  type TransactionContext,
} from 'src/db';
import { compareNullableNumber, maxBigInt } from 'src/utils/utils';
import { AbiEvent, Address, GetLogsReturnType, Log, TimeoutError } from 'viem';
import { DealManifestService } from '../deal-manifest.service';
import {
  ARCHIVE_NODE_CLIENT,
  RECENT_NODE_CLIENT,
} from '../po-rep-indexer.constants';
import { PoRepConfig, PoRepPublicClient } from '../po-rep-indexer.types';

export type LogsForEvents<EventType extends AbiEvent> = GetLogsReturnType<
  undefined,
  EventType[],
  undefined,
  bigint,
  bigint
>;

@Injectable()
export abstract class AbstractPoRepIndexerRunner<
  EventType extends AbiEvent = AbiEvent,
  Changes = LogsForEvents<EventType>,
> implements OnApplicationBootstrap {
  // Returns runner name used for storing information about indexing
  public abstract getName(): string;

  // Increase returned value to trigger cleanup on next run and index from the beginning
  protected abstract getVersion(): number;

  // Return block height from which indexing should start initially and
  // after every cleanup
  protected abstract getOriginBlock(): bigint;

  // Returns maximum number of blocks to be processed every iteration
  protected abstract getBatchBlockSize(): bigint;

  // Returns events that should be processed
  protected abstract getEventTypes(): EventType[];

  // Returns address or list of addresses from which indexed logs should originate
  protected abstract getOriginAddresses(): Address | Address[] | undefined;

  // Remove indexed data when version changes
  protected abstract cleanup(tx: TransactionContext): Promise<void>;

  // Return changes based on processed logs, along with all the data needed to
  // save them
  protected abstract getChanges(
    logs: LogsForEvents<EventType>,
  ): Changes | Promise<Changes>;

  // Save changes to the DB
  protected abstract updateDb(
    tx: TransactionContext,
    changes: Changes,
  ): Promise<void>;

  protected logger: Logger;
  private isRunning: boolean = false;

  constructor(
    protected readonly configService: ConfigService<PoRepConfig, true>,
    protected readonly schedulerRegistry: SchedulerRegistry,
    @InjectQueryBuilder() protected readonly queryBuilder: QueryBuilder,
    @Inject(RECENT_NODE_CLIENT)
    protected readonly recentNodeClient: PoRepPublicClient,
    @Inject(ARCHIVE_NODE_CLIENT)
    protected readonly archiveNodeClient: PoRepPublicClient,
    protected readonly dealManifestService: DealManifestService,
  ) {
    this.logger = new Logger(this.getName());
  }

  public onApplicationBootstrap() {
    // Start indexing right after application is up instead of waiting for the
    // first cron tick.
    void this.index();
  }

  @Cron(CronExpression.EVERY_HOUR)
  public async index() {
    if (this.isRunning) {
      this.logger.log('Indexing already in progress, skipping execution');
      return;
    }

    const retryTimeoutName = this.getName() + '_retry_timeout';

    if (this.schedulerRegistry.doesExist('timeout', retryTimeoutName)) {
      this.logger.log('Clearing retry timeout.');
      this.schedulerRegistry.deleteTimeout(retryTimeoutName);
    }

    this.logger.log('Starting indexing');

    try {
      this.isRunning = true;
      await this.execute();
    } catch (error) {
      const retryTimeoutMs = this.getRetryTimeoutMs();
      const retryTimeoutString =
        retryTimeoutMs % 1000 === 0
          ? retryTimeoutMs / 1000 + ' seconds'
          : retryTimeoutMs + 'ms';

      this.logger.error(error);
      this.logger.log(
        `Error occured during indexing. Retrying in ${retryTimeoutString}.`,
      );

      const timeout = setTimeout(this.index.bind(this), retryTimeoutMs);

      this.schedulerRegistry.addTimeout(retryTimeoutName, timeout);
    } finally {
      this.isRunning = false;
    }
  }

  public async execute() {
    let keepRunning = true;

    while (keepRunning) {
      keepRunning = await this.executeBatchWithTimeoutRetries(
        this.getBatchBlockSize(),
      );
    }
  }

  private async executeBatchWithTimeoutRetries(
    batchBlockSize: bigint,
  ): Promise<boolean> {
    try {
      return await this.executeBatch(batchBlockSize);
    } catch (error) {
      if (!(error instanceof TimeoutError)) {
        throw error;
      }

      const nextBatchBlockSize = batchBlockSize / 2n;

      if (nextBatchBlockSize < 1n) {
        throw error;
      }

      this.logger.warn(
        `Request timed out. Retrying with batch size of ${nextBatchBlockSize.toString()} blocks.`,
      );

      return this.executeBatchWithTimeoutRetries(nextBatchBlockSize);
    }
  }

  private async executeBatch(batchBlockSize: bigint): Promise<boolean> {
    const startDate = DateTime.now().toUTC();
    const chainId = BigInt(this.configService.get('PO_REP_CHAIN_ID'));
    const runner = this.getName();
    const version = this.getVersion();
    const [recentHead, lastRun] = await Promise.all([
      this.recentNodeClient.getBlockNumber(),
      this.queryBuilder
        .selectFrom('po_rep_indexer_run')
        .selectAll()
        .where('chainId', '=', chainId.toString())
        .where('runner', '=', runner)
        .where('version', '=', version)
        .orderBy('date', 'desc')
        .executeTakeFirst(),
    ]);

    // Starting epoch selection
    const versionChanged = !lastRun || lastRun.version !== version;
    const fromBlock = versionChanged
      ? this.getOriginBlock()
      : BigInt(lastRun.blockEnd) + 1n;

    // Node selection
    const shouldUseArchiveNode =
      recentHead - fromBlock >= this.getArchiveNodeThreshold();
    const selectedNode = shouldUseArchiveNode
      ? this.archiveNodeClient
      : this.recentNodeClient;

    // Block finality check
    const finalizedHeightMaxDifference = this.configService.get(
      'FINALIZED_HEIGHT_MAX_DIFFERENCE',
      { infer: true },
    );
    const [currentHeight, finalizedHeight] = await Promise.all([
      selectedNode.getBlockNumber(),
      selectedNode.filecoin
        .chainGetFinalizedTipSet()
        .then((r) => BigInt(r.Height)),
    ]);

    const maxToBlock =
      typeof finalizedHeightMaxDifference === 'bigint'
        ? maxBigInt(
            finalizedHeight,
            currentHeight - finalizedHeightMaxDifference,
          )
        : finalizedHeight;

    if (fromBlock > maxToBlock) {
      // Return if already indexed to finalized tipset
      this.logger.log('Nothing to index.');
      return false;
    }

    // Ending epoch selection
    const blockDifference = maxToBlock - fromBlock;
    const toBlock =
      blockDifference >= batchBlockSize
        ? fromBlock + batchBlockSize - 1n
        : maxToBlock;

    // Logs retrieval
    this.logger.log(
      `Fetching logs in block range [${fromBlock.toString()}-${toBlock.toString()}] using ${shouldUseArchiveNode ? '"Archive Node"' : '"Recent Node"'}`,
    );

    const logs = await selectedNode.getLogs({
      address: this.getOriginAddresses(),
      events: this.getEventTypes(),
      fromBlock: fromBlock,
      toBlock: toBlock,
    });

    this.logger.log(`Found ${logs.length} matching logs`);

    const logsSorted = this.sortLogs(logs);

    // DB Updates
    const changes = await this.getChanges(logsSorted);

    await this.queryBuilder.transaction().execute(async (tx) => {
      if (versionChanged) {
        await this.cleanup(tx);
      }

      await this.updateDb(tx, changes);

      await tx
        .insertInto('po_rep_indexer_run')
        .values({
          date: startDate.toISO(),
          chainId: chainId.toString(),
          runner: runner,
          version: version,
          blockStart: fromBlock.toString(),
          blockEnd: toBlock.toString(),
          eventsCount: logs.length,
        })
        .execute();
    });

    // Sync exhaustion
    const keepRunning = recentHead !== toBlock;

    this.logger.log(
      keepRunning
        ? `Indexed ${logs.length} logs up to block ${toBlock.toString()}. Scheduling another run.`
        : `Finished indexing ${logs.length} logs.`,
    );

    return keepRunning;
  }

  protected getArchiveNodeThreshold(): bigint {
    return 1920n;
  }

  protected getRetryTimeoutMs(): number {
    return 60000; // 60 seconds
  }

  private sortLogs<T extends Log>(logs: T[]): T[] {
    return [...logs].sort((a, b) => {
      const blockOrder = compareNullableNumber(
        a.blockNumber,
        b.blockNumber,
        'asc',
      );
      if (blockOrder !== 0) return blockOrder;

      const transactionOrder = compareNullableNumber(
        a.transactionIndex,
        b.transactionIndex,
        'asc',
      );
      if (transactionOrder !== 0) return transactionOrder;

      return compareNullableNumber(a.logIndex, b.logIndex, 'asc');
    });
  }
}
