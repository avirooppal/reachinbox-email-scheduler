import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL || "http://127.0.0.1:9200"
});

export const EMAIL_INDEX_NAME = "emails";

/**
 * Initialize Elasticsearch index with proper keyword/text mappings.
 */
export async function initElasticsearchIndex(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: EMAIL_INDEX_NAME });
    if (!exists) {
      await esClient.indices.create({
        index: EMAIL_INDEX_NAME,
        body: {
          mappings: {
            properties: {
              id: { type: "keyword" },
              campaignId: { type: "keyword" },
              userId: { type: "keyword" },
              senderId: { type: "keyword" },
              toEmail: {
                type: "text",
                fields: {
                  keyword: { type: "keyword" }
                }
              },
              subject: { type: "text" },
              body: { type: "text" },
              status: { type: "keyword" },
              plannedAt: { type: "date" },
              scheduledAt: { type: "date" },
              sentAt: { type: "date" },
              updatedAt: { type: "date" }
            }
          }
        }
      });
      logger.info({ index: EMAIL_INDEX_NAME }, "Created Elasticsearch index mapping");
    }
  } catch (err) {
    logger.warn({ err }, "Could not ensure Elasticsearch index exists (offline or unready)");
  }
}
