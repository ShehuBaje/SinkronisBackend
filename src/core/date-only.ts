import { z } from "zod";

export const isValidDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

export const dateOnlyString = z.string().refine(isValidDateOnly, "Expected a valid calendar date in YYYY-MM-DD format");
export const dateOnlyUtc = dateOnlyString.transform((value) => new Date(`${value}T00:00:00.000Z`));
