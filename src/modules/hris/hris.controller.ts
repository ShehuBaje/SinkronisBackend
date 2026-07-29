import { clockIn, clockOut } from "./hris.service";

export const clockInController = async (req: any, res: any) => {
  const attendance = await clockIn(req.organizationId!, req.body);
  res.status(201).json(attendance);
};

export const clockOutController = async (req: any, res: any) => {
  const attendance = await clockOut(req.organizationId!, String(req.params.id));
  res.json(attendance);
};
