import { getCurrentSubscription, updateSubscriptionSeats } from "./subscriptions.service";
import { sendSuccess } from "../../core/api-response";

export const getCurrentSubscriptionController = async (req: any, res: any) => {
  const data = await getCurrentSubscription(req);
  sendSuccess(res, "Current subscription retrieved.", data);
};

export const updateSubscriptionSeatsController = async (req: any, res: any) => {
  const data = await updateSubscriptionSeats(req);
  sendSuccess(res, data.message, data);
};
