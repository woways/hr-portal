/**
 * SWR-style cached wrappers around the raw Firestore getters for the employee app.
 * The employee portal is per-user, so most keys are scoped by employeeId.
 */

import { swr, invalidate } from "./cache";
import {
  getMyLeaveRequests, getMyAttendance,
} from "./firebaseService";

type On<T> = (data: T, isFresh: boolean) => void;

const K = {
  myLeaves:      (eid: string) => `svc:myleaves:${eid}:v1`,
  myAttendance:  (eid: string) => `svc:myatt:${eid}:v1`,
};

export function cachedMyLeaves(eid: string, on: On<Record<string, unknown>[]>) {
  return swr(K.myLeaves(eid), () => getMyLeaveRequests(eid) as Promise<unknown> as Promise<Record<string, unknown>[]>, on);
}
export function cachedMyAttendance(eid: string, on: On<Record<string, unknown>[]>) {
  return swr(K.myAttendance(eid), () => getMyAttendance(eid) as Promise<unknown> as Promise<Record<string, unknown>[]>, on);
}

export const invalidateMyLeaves     = () => invalidate("svc:myleaves:");
export const invalidateMyAttendance = () => invalidate("svc:myatt:");
export const invalidateAll          = () => invalidate("svc:");
