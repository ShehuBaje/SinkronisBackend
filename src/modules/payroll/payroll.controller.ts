import { enqueuePayslipGeneration } from "./payroll.service";

export const generatePayslipsController = async (req: any, res: any) => {
  const result = await enqueuePayslipGeneration(req.organizationId!, String(req.params.id), req.user?.id);
  res.status(result.queued ? 202 : 200).json(result);
};
