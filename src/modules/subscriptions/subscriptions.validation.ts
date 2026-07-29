import { z } from "zod";

export const subscriptionSeatsUpdateSchema = z.object({
  totalSeats: z.coerce.number().int().positive()
});
