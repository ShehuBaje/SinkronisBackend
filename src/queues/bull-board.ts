import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Queue } from "bullmq";
import { env } from "../config/env";

export const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath(`${env.API_PREFIX}/bull`);

const { replaceQueues } = createBullBoard({
  queues: [],
  serverAdapter: bullBoardAdapter
});

export const registerBullBoardQueues = (queues: Queue[]) => {
  replaceQueues(queues.map((queue) => new BullMQAdapter(queue)));
};
