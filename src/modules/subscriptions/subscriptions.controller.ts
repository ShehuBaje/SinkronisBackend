import { getCurrentSubscription } from "./subscriptions.service";
import { sendSuccess } from "../../core/api-response";

export const getCurrentSubscriptionController = async (req: any, res: any) => {
  const data = await getCurrentSubscription(req);
  sendSuccess(res, "Current subscription retrieved.", data);
};
