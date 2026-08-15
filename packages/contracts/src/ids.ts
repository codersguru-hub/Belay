import { z } from "zod";

const boundedIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "must be a stable identifier");

export const ProjectIdSchema = boundedIdentifier.brand<"ProjectId">();
export const StageIdSchema = boundedIdentifier.brand<"StageId">();
export const TaskIdSchema = boundedIdentifier.brand<"TaskId">();

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type StageId = z.infer<typeof StageIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;

