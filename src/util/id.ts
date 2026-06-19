import { nanoid } from "nanoid";

const id = (prefix: string): string => `${prefix}_${nanoid(12)}`;

export const newSessionId = (): string => id("sess");
export const newTaskGroupId = (): string => id("grp");
export const newTaskId = (): string => id("task");
export const newAttemptId = (): string => id("att");
export const newArtifactId = (): string => id("art");
export const newEventId = (): string => id("evt");
export const newMetricId = (): string => id("met");
