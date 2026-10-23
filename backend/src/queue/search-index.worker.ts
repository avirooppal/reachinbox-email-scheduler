import { Queue, Worker, Job } from "bullmq";
import { redis } from "../infra/redis.js";
import { prisma } from "../infra/prisma.js";
import { esClient, EMAIL_INDEX_NAME } from "../infra/elasticsearch.js";
import { logger } from "../config/logger.js";

export const SEARCH_INDEX_QUEUE_NAME = "search-index";

export interface SearchIndexJobData {
  emailId: string;
}

export const searchIndexQueue = new Queue<SearchIndexJobData>(SEARCH_INDEX_QUEUE_NAME, {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1000
    },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});

/**
 * BullMQ Worker for asynchronous email indexing into Elasticsearch.
 * Uses external versioning (updatedAt epoch ms) so out-of-order updates cannot regress state.
 */
export function createSearchIndexWorker(workerId = `es-worker-${process.pid}`): Worker<SearchIndexJobData> {
  const worker = new Worker<SearchIndexJobData>(
    SEARCH_INDEX_QUEUE_NAME,
    async (job: Job<SearchIndexJobData>) => {
      const emailId = job.data.emailId;
      const jobLogger = logger.child({ jobId: job.id, emailId, workerId });

      const email = await prisma.email.findUnique({
        where: { id: emailId }
      });

      if (!email) {
        jobLogger.debug("Email not found in database; skipping search indexing");
        return;
      }

      const versionEpoch = email.updatedAt.getTime();

      try {
        await esClient.index({
          index: EMAIL_INDEX_NAME,
          id: email.id,
          version: versionEpoch,
          version_type: "external_gte",
          document: {
            id: email.id,
            campaignId: email.campaignId,
            userId: email.userId,
            senderId: email.senderId,
            toEmail: email.toEmail,
            subject: email.subject,
            body: email.body,
            status: email.status,
            plannedAt: email.plannedAt,
            scheduledAt: email.scheduledAt,
            sentAt: email.sentAt,
            updatedAt: email.updatedAt
          }
        });

        jobLogger.debug({ version: versionEpoch }, "Indexed email into Elasticsearch");
      } catch (err: any) {
        if (err.meta?.statusCode === 409 || err.message?.includes("version_conflict_engine_exception")) {
          jobLogger.debug("Elasticsearch version conflict (newer version already indexed); skipping");
          return;
        }
        throw err;
      }
    },
    {
      connection: redis as any,
      concurrency: 10
    }
  );

  return worker;
}
