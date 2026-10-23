import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env.js";

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 5000
});
