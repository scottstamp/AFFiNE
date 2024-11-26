import { remove } from 'lodash-es';
import { nanoid } from 'nanoid';
import { Subject } from 'rxjs';
import { diffUpdate, encodeStateVectorFromUpdate, mergeUpdates } from 'yjs';

import type { DocStorage, SyncStorage } from '../../storage';
import { AsyncPriorityQueue } from '../../utils/async-priority-queue';
import { ClockMap } from '../../utils/clock';
import { isEmptyUpdate } from '../../utils/is-empty-update';
import { throwIfAborted } from '../../utils/throw-if-aborted';

type Job =
  | {
      type: 'connect';
      docId: string;
    }
  | {
      type: 'push';
      docId: string;
      update: Uint8Array;
      clock: Date;
    }
  | {
      type: 'pull';
      docId: string;
    }
  | {
      type: 'pullAndPush';
      docId: string;
    }
  | {
      type: 'save';
      docId: string;
      update?: Uint8Array;
      serverClock: Date;
    };

interface Status {
  docs: Set<string>;
  connectedDocs: Set<string>;
  jobDocQueue: AsyncPriorityQueue;
  jobMap: Map<string, Job[]>;
  remoteClocks: ClockMap;
  pulledRemoteClocks: ClockMap;
  pushedClocks: ClockMap;
  syncing: boolean;
  retrying: boolean;
  errorMessage: string | null;
}

interface DocSyncPeerOptions {
  mergeUpdates?: (updates: Uint8Array[]) => Promise<Uint8Array> | Uint8Array;
}

function createJobErrorCatcher<
  Jobs extends Record<string, (docId: string, ...args: any[]) => Promise<void>>,
>(jobs: Jobs): Jobs {
  return Object.fromEntries(
    Object.entries(jobs).map(([k, fn]) => {
      return [
        k,
        async (docId, ...args) => {
          try {
            await fn(docId, ...args);
          } catch (err) {
            if (err instanceof Error) {
              throw new Error(
                `Error in job "${k}": ${err.stack || err.message}`
              );
            } else {
              throw err;
            }
          }
        },
      ];
    })
  ) as Jobs;
}

export class DocSyncPeer {
  /**
   * random unique id for recognize self in "update" event
   */
  private readonly uniqueId = nanoid();
  private readonly prioritySettings = new Map<string, number>();

  constructor(
    readonly local: DocStorage,
    readonly syncMetadata: SyncStorage,
    readonly remote: DocStorage,
    readonly options: DocSyncPeerOptions = {}
  ) {}

  private status: Status = {
    docs: new Set<string>(),
    connectedDocs: new Set<string>(),
    jobDocQueue: new AsyncPriorityQueue(),
    jobMap: new Map(),
    remoteClocks: new ClockMap(new Map()),
    pulledRemoteClocks: new ClockMap(new Map()),
    pushedClocks: new ClockMap(new Map()),
    syncing: false,
    retrying: false,
    errorMessage: null,
  };
  private readonly statusUpdatedSubject$ = new Subject<string | true>();

  private readonly jobs = createJobErrorCatcher({
    connect: async (docId: string, signal?: AbortSignal) => {
      const pushedClock = this.status.pushedClocks.get(docId);
      const clock = await this.local.getDocTimestamp(docId);

      throwIfAborted(signal);
      if (pushedClock === null || pushedClock !== clock?.timestamp) {
        await this.jobs.pullAndPush(docId, signal);
      } else {
        const pulled = this.status.pulledRemoteClocks.get(docId);
        if (pulled === null || pulled !== this.status.remoteClocks.get(docId)) {
          await this.jobs.pull(docId, signal);
        }
      }

      this.status.connectedDocs.add(docId);
      this.statusUpdatedSubject$.next(docId);
    },
    push: async (
      docId: string,
      jobs: (Job & { type: 'push' })[],
      signal?: AbortSignal
    ) => {
      if (this.status.connectedDocs.has(docId)) {
        const maxClock = jobs.reduce(
          (a, b) => (a.getTime() > b.clock.getTime() ? a : b.clock),
          new Date(0)
        );
        const merged = await this.mergeUpdates(
          jobs.map(j => j.update).filter(update => !isEmptyUpdate(update))
        );
        if (!isEmptyUpdate(merged)) {
          const { timestamp } = await this.remote.pushDocUpdate(
            {
              docId,
              bin: merged,
            },
            this.uniqueId
          );
          this.schedule({
            type: 'save',
            docId,
            serverClock: timestamp,
          });
        }
        throwIfAborted(signal);
        await this.actions.updatePushedClock(docId, maxClock);
      }
    },
    pullAndPush: async (docId: string, signal?: AbortSignal) => {
      const docRecord = await this.local.getDoc(docId);

      const stateVector =
        docRecord && !isEmptyUpdate(docRecord.bin)
          ? encodeStateVectorFromUpdate(docRecord.bin)
          : new Uint8Array();
      const remoteDocRecord = await this.remote.getDocDiff(docId, stateVector);

      if (remoteDocRecord) {
        const {
          missing: newData,
          state: serverStateVector,
          timestamp: serverClock,
        } = remoteDocRecord;
        this.schedule({
          type: 'save',
          docId,
          serverClock,
        });
        throwIfAborted(signal);
        const { timestamp: localClock } = await this.local.pushDocUpdate(
          {
            bin: newData,
            docId,
          },
          this.uniqueId
        );
        throwIfAborted(signal);
        await this.actions.updatePulledRemoteClock(docId, serverClock);
        const diff =
          docRecord && serverStateVector && serverStateVector.length > 0
            ? diffUpdate(docRecord.bin, serverStateVector)
            : docRecord?.bin;
        if (diff && !isEmptyUpdate(diff)) {
          throwIfAborted(signal);
          const { timestamp: serverClock } = await this.remote.pushDocUpdate(
            {
              bin: diff,
              docId,
            },
            this.uniqueId
          );
          this.schedule({
            type: 'save',
            docId,
            serverClock,
          });
        }
        throwIfAborted(signal);
        await this.actions.updatePushedClock(docId, localClock);
      } else {
        if (docRecord) {
          if (!isEmptyUpdate(docRecord.bin)) {
            throwIfAborted(signal);
            const { timestamp: serverClock } = await this.remote.pushDocUpdate(
              {
                bin: docRecord.bin,
                docId,
              },
              this.uniqueId
            );
            this.schedule({
              type: 'save',
              docId,
              serverClock,
            });
          }
          await this.actions.updatePushedClock(docId, docRecord.timestamp);
        }
      }
    },
    pull: async (docId: string, signal?: AbortSignal) => {
      const docRecord = await this.local.getDoc(docId);

      const stateVector =
        docRecord && !isEmptyUpdate(docRecord.bin)
          ? encodeStateVectorFromUpdate(docRecord.bin)
          : new Uint8Array();
      const serverDoc = await this.remote.getDocDiff(docId, stateVector);
      if (!serverDoc) {
        return;
      }
      const { missing: newData, timestamp: serverClock } = serverDoc;
      throwIfAborted(signal);
      await this.local.pushDocUpdate(
        {
          docId,
          bin: newData,
        },
        this.uniqueId
      );
      throwIfAborted(signal);
      await this.actions.updatePulledRemoteClock(docId, serverClock);
      this.schedule({
        type: 'save',
        docId,
        serverClock,
      });
    },
    save: async (
      docId: string,
      jobs: (Job & { type: 'save' })[],
      signal?: AbortSignal
    ) => {
      const serverClock = jobs.reduce(
        (a, b) => (a.getTime() > b.serverClock.getTime() ? a : b.serverClock),
        new Date(0)
      );
      if (this.status.connectedDocs.has(docId)) {
        const data = jobs
          .map(j => j.update)
          .filter((update): update is Uint8Array =>
            update ? !isEmptyUpdate(update) : false
          );
        const update =
          data.length > 0 ? await this.mergeUpdates(data) : new Uint8Array();

        throwIfAborted(signal);
        await this.local.pushDocUpdate(
          {
            docId,
            bin: update,
          },
          this.uniqueId
        );
        throwIfAborted(signal);

        await this.actions.updatePulledRemoteClock(docId, serverClock);
      }
    },
  });

  private readonly actions = {
    updateRemoteClock: async (docId: string, remoteClock: Date) => {
      const updated = this.status.remoteClocks.setIfBigger(docId, remoteClock);
      if (updated) {
        await this.syncMetadata.setPeerRemoteClock(this.remote.peer, {
          docId,
          timestamp: remoteClock,
        });
        this.statusUpdatedSubject$.next(docId);
      }
    },
    updatePushedClock: async (docId: string, pushedClock: Date) => {
      const updated = this.status.pushedClocks.setIfBigger(docId, pushedClock);
      if (updated) {
        await this.syncMetadata.setPeerPushedClock(this.remote.peer, {
          docId,
          timestamp: pushedClock,
        });
        this.statusUpdatedSubject$.next(docId);
      }
    },
    updatePulledRemoteClock: async (docId: string, pulledClock: Date) => {
      const updated = this.status.pulledRemoteClocks.setIfBigger(
        docId,
        pulledClock
      );
      if (updated) {
        await this.syncMetadata.setPeerPulledRemoteClock(this.remote.peer, {
          docId,
          timestamp: pulledClock,
        });
        this.statusUpdatedSubject$.next(docId);
      }
    },
    addDoc: (docId: string) => {
      if (!this.status.docs.has(docId)) {
        this.status.docs.add(docId);
        this.statusUpdatedSubject$.next(docId);
        this.schedule({
          type: 'connect',
          docId,
        });
      }
    },
  };

  readonly events = {
    localUpdated: ({
      docId,
      update,
      clock,
    }: {
      docId: string;
      update: Uint8Array;
      clock: Date;
    }) => {
      // try add doc for new doc
      this.actions.addDoc(docId);

      // schedule push job
      this.schedule({
        type: 'push',
        docId,
        clock,
        update,
      });
    },
    remoteUpdated: ({
      docId,
      update,
      remoteClock,
    }: {
      docId: string;
      update: Uint8Array;
      remoteClock: Date;
    }) => {
      // try add doc for new doc
      this.actions.addDoc(docId);

      // schedule push job
      this.schedule({
        type: 'save',
        docId,
        serverClock: remoteClock,
        update,
      });
    },
  };

  async mainLoop(signal?: AbortSignal) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await this.retryLoop(signal);
      } catch (err) {
        if (signal?.aborted) {
          return;
        }
        console.warn('Sync error, retry in 5s', err);
        this.status.errorMessage =
          err instanceof Error ? err.message : `${err}`;
        this.statusUpdatedSubject$.next(true);
      } finally {
        // reset all status
        this.status = {
          docs: new Set(),
          connectedDocs: new Set(),
          jobDocQueue: new AsyncPriorityQueue(),
          jobMap: new Map(),
          pulledRemoteClocks: new ClockMap(new Map()),
          pushedClocks: new ClockMap(new Map()),
          remoteClocks: new ClockMap(new Map()),
          syncing: false,
          // tell ui to show retrying status
          retrying: true,
          // error message from last retry
          errorMessage: this.status.errorMessage,
        };
        this.statusUpdatedSubject$.next(true);
      }
      // wait for 1s before next retry
      await Promise.race([
        new Promise<void>(resolve => {
          setTimeout(resolve, 1000);
        }),
        new Promise((_, reject) => {
          // exit if manually stopped
          if (signal?.aborted) {
            reject(signal.reason);
          }
          signal?.addEventListener('abort', () => {
            reject(signal.reason);
          });
        }),
      ]);
    }
  }

  private async retryLoop(signal?: AbortSignal) {
    throwIfAborted(signal);
    const abort = new AbortController();

    signal?.addEventListener('abort', reason => {
      abort.abort(reason);
    });

    signal = abort.signal;

    const disposes: (() => void)[] = [];

    try {
      console.info('Remote sync started');
      this.status.syncing = true;
      this.statusUpdatedSubject$.next(true);

      // wait for all storages to connect, timeout after 30s
      await Promise.race([
        Promise.all([
          this.local.connection.waitForConnected(signal),
          this.remote.connection.waitForConnected(signal),
          this.syncMetadata.connection.waitForConnected(signal),
        ]),
        new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Connect to remote timeout'));
          }, 1000 * 30);
        }),
        new Promise((_, reject) => {
          signal?.addEventListener('abort', reason => {
            reject(reason);
          });
        }),
      ]);

      // throw error if failed to connect
      for (const storage of [this.remote, this.local, this.syncMetadata]) {
        // abort if disconnected
        disposes.push(
          storage.connection.onStatusChanged((_status, error) => {
            abort.abort('Storage disconnected:' + error);
          })
        );
      }

      // reset retrying flag after connected with server
      this.status.retrying = false;
      this.statusUpdatedSubject$.next(true);

      // subscribe local doc updates
      disposes.push(
        this.local.subscribeDocUpdate((update, origin) => {
          if (origin === this.uniqueId) {
            return;
          }
          this.events.localUpdated({
            docId: update.docId,
            clock: update.timestamp,
            update: update.bin,
          });
        })
      );
      // subscribe remote doc updates
      disposes.push(
        this.remote.subscribeDocUpdate(({ bin, docId, timestamp }, origin) => {
          if (origin === this.uniqueId) {
            return;
          }
          this.events.remoteUpdated({
            docId,
            update: bin,
            remoteClock: timestamp,
          });
        })
      );

      // add all docs from local
      const localDocs = Object.keys(await this.local.getDocTimestamps());
      throwIfAborted(signal);
      for (const docId of localDocs) {
        this.actions.addDoc(docId);
      }

      // get cached clocks from metadata
      const cachedClocks = await this.syncMetadata.getPeerRemoteClocks(
        this.remote.peer
      );
      throwIfAborted(signal);
      for (const [id, v] of Object.entries(cachedClocks)) {
        this.status.remoteClocks.set(id, v);
      }
      const pulledClocks = await this.syncMetadata.getPeerPulledRemoteClocks(
        this.remote.peer
      );
      for (const [id, v] of Object.entries(pulledClocks)) {
        this.status.pulledRemoteClocks.set(id, v);
      }
      const pushedClocks = await this.syncMetadata.getPeerPushedClocks(
        this.remote.peer
      );
      throwIfAborted(signal);
      for (const [id, v] of Object.entries(pushedClocks)) {
        this.status.pushedClocks.set(id, v);
      }
      this.statusUpdatedSubject$.next(true);

      // get new clocks from server
      const maxClockValue = this.status.remoteClocks.max;
      const newClocks = await this.remote.getDocTimestamps(maxClockValue);
      for (const [id, v] of Object.entries(newClocks)) {
        await this.actions.updateRemoteClock(id, v);
      }

      // add all docs from remote
      for (const docId of this.status.remoteClocks.keys()) {
        this.actions.addDoc(docId);
      }

      // begin to process jobs
      // eslint-disable-next-line no-constant-condition
      while (true) {
        throwIfAborted(signal);

        const docId = await this.status.jobDocQueue.asyncPop(signal);
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // batch process jobs for the same doc
          const jobs = this.status.jobMap.get(docId);
          if (!jobs || jobs.length === 0) {
            this.status.jobMap.delete(docId);
            this.statusUpdatedSubject$.next(docId);
            break;
          }

          const connect = remove(jobs, j => j.type === 'connect');
          if (connect && connect.length > 0) {
            await this.jobs.connect(docId, signal);
            continue;
          }

          const pullAndPush = remove(jobs, j => j.type === 'pullAndPush');
          if (pullAndPush && pullAndPush.length > 0) {
            await this.jobs.pullAndPush(docId, signal);
            continue;
          }

          const pull = remove(jobs, j => j.type === 'pull');
          if (pull && pull.length > 0) {
            await this.jobs.pull(docId, signal);
            continue;
          }

          const push = remove(jobs, j => j.type === 'push');
          if (push && push.length > 0) {
            await this.jobs.push(
              docId,
              push as (Job & { type: 'push' })[],
              signal
            );
            continue;
          }

          const save = remove(jobs, j => j.type === 'save');
          if (save && save.length > 0) {
            await this.jobs.save(
              docId,
              save as (Job & { type: 'save' })[],
              signal
            );
            continue;
          }
        }
      }
    } finally {
      for (const dispose of disposes) {
        dispose();
      }
      this.status.syncing = false;
      console.info('Remote sync ended');
    }
  }

  private schedule(job: Job) {
    const priority = this.prioritySettings.get(job.docId) ?? 0;
    this.status.jobDocQueue.push(job.docId, priority);

    const existingJobs = this.status.jobMap.get(job.docId) ?? [];
    existingJobs.push(job);
    this.status.jobMap.set(job.docId, existingJobs);
    this.statusUpdatedSubject$.next(job.docId);
  }

  setPriority(docId: string, priority: number) {
    this.prioritySettings.set(docId, priority);
    this.status.jobDocQueue.updatePriority(docId, priority);
  }

  protected mergeUpdates(updates: Uint8Array[]) {
    const merge = this.options?.mergeUpdates ?? mergeUpdates;

    return merge(updates.filter(bin => !isEmptyUpdate(bin)));
  }
}
