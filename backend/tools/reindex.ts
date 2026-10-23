import { prisma } from "../src/infra/prisma.js";
import { esClient, EMAIL_INDEX_NAME, initElasticsearchIndex } from "../src/infra/elasticsearch.js";

async function main() {
  console.log("===============================================================================");
  console.log("REINDEX TOOL: Rebuilding Elasticsearch Email Index from PostgreSQL");
  console.log("===============================================================================");

  // Ensure index exists
  await initElasticsearchIndex();

  const count = await prisma.email.count();
  console.log(`Found ${count} emails in PostgreSQL database.`);

  const BATCH_SIZE = 1000;
  let processed = 0;

  for (let offset = 0; offset < count; offset += BATCH_SIZE) {
    const batch = await prisma.email.findMany({
      skip: offset,
      take: BATCH_SIZE,
      orderBy: { id: "asc" }
    });

    if (batch.length === 0) break;

    const operations = batch.flatMap((e) => [
      {
        index: {
          _index: EMAIL_INDEX_NAME,
          _id: e.id,
          version: e.updatedAt.getTime(),
          version_type: "external_gte"
        }
      },
      {
        id: e.id,
        campaignId: e.campaignId,
        userId: e.userId,
        senderId: e.senderId,
        toEmail: e.toEmail,
        subject: e.subject,
        body: e.body,
        status: e.status,
        plannedAt: e.plannedAt,
        scheduledAt: e.scheduledAt,
        sentAt: e.sentAt,
        updatedAt: e.updatedAt
      }
    ]);

    const bulkResponse = await esClient.bulk({ refresh: true, operations });

    if (bulkResponse.errors) {
      const errored = bulkResponse.items.filter((item: any) => item.index && item.index.error);
      console.warn(`Encountered ${errored.length} errors during batch reindexing`);
    }

    processed += batch.length;
    console.log(`Indexed ${processed}/${count} emails...`);
  }

  // Refresh index
  await esClient.indices.refresh({ index: EMAIL_INDEX_NAME });
  const stats = await esClient.count({ index: EMAIL_INDEX_NAME });
  console.log(`Reindex complete! Total documents in index: ${stats.count}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Reindexing failed:", err);
  process.exit(1);
});
