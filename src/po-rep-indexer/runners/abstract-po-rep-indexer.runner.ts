import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { PrismaService } from 'src/db/prisma.service';
import { compareNullableNumber, maxBigInt } from 'src/utils/utils';
import { AbiEvent, Address, GetLogsReturnType, Log } from 'viem';
import { Prisma } from '../../generated/prisma/client';
import { DealManifestService } from '../deal-manifest.service';
import {
  ARCHIVE_NODE_CLIENT,
  RECENT_NODE_CLIENT,
} from '../po-rep-indexer.constants';
import { PoRepConfig, PoRepPublicClient } from '../po-rep-indexer.types';

@Injectable()
export abstract class AbstractPoRepIndexerRunner<
  EventType extends AbiEvent = AbiEvent,
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

  // Return DB operations necessary for cleanup when version changes
  protected abstract prepareCleanup(): Prisma.PrismaPromise<unknown>[];

  // Return DB updates based on processed logs
  protected abstract prepareUpdates(
    logs: GetLogsReturnType<undefined, EventType[], undefined, bigint, bigint>,
  ): Prisma.PrismaPromise<unknown>[] | Promise<Prisma.PrismaPromise<unknown>[]>;

  protected logger: Logger;
  private isRunning: boolean = false;

  constructor(
    protected readonly configService: ConfigService<PoRepConfig, true>,
    protected readonly schedulerRegistry: SchedulerRegistry,
    protected readonly prismaService: PrismaService,
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
    const startDate = DateTime.now().toUTC();
    const chainId = BigInt(this.configService.get('PO_REP_CHAIN_ID'));
    const runner = this.getName();
    const version = this.getVersion();
    const [recentHead, lastRun] = await Promise.all([
      this.recentNodeClient.getBlockNumber(),
      this.prismaService.po_rep_indexer_run.findFirst({
        where: {
          chainId: chainId,
          runner: runner,
          version: version,
        },
        orderBy: {
          date: 'desc',
        },
      }),
    ]);

    // Starting epoch selection
    const versionChanged = !lastRun || lastRun.version !== version;
    const fromBlock = versionChanged
      ? this.getOriginBlock()
      : lastRun.blockEnd + 1n;

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
      return;
    }

    // Ending epoch selection
    const blockDifference = maxToBlock - fromBlock;
    const batchBlockSize = this.getBatchBlockSize();
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
    const updates = await this.prepareUpdates(logsSorted);

    const operations: Prisma.PrismaPromise<unknown>[] = [
      ...(versionChanged ? this.prepareCleanup() : []),
      ...updates,
      this.prismaService.po_rep_indexer_run.create({
        data: {
          date: startDate.toJSDate(),
          chainId: chainId,
          runner: runner,
          version: version,
          blockStart: fromBlock,
          blockEnd: toBlock,
          eventsCount: logs.length,
        },
      }),
    ];

    await this.prismaService.$transaction(operations);

    // Sync exhaustion
    const keepRunning = recentHead !== toBlock;

    this.logger.log(
      keepRunning
        ? `Indexed ${logs.length} logs up to block ${toBlock.toString()}. Scheduling another run.`
        : `Finished indexing ${logs.length} logs.`,
    );
    this.isRunning = false;

    if (keepRunning) {
      // keep indexing if we havent synced up
      await this.execute();
    }

    this.logger.log('Starting indexing');

    try {
      this.isRunning = true;
    } catch (error) {
      this.isRunning = false;
      this.logger.error(`Error during indexing: ${String(error)}`);
    }
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
