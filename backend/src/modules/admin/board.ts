import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "../../adapters/queue.bullmq.js";
import { searchIndexQueue } from "../../queue/search-index.worker.js";
import { notificationQueue } from "../../queue/notification.worker.js";

export const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(searchIndexQueue),
    new BullMQAdapter(notificationQueue)
  ],
  serverAdapter
});
