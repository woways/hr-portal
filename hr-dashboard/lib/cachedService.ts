/**
 * SWR-style cached wrappers around the raw Firestore getters.
 *
 * Usage:
 *   useEffect(() => {
 *     cachedEmployees((data, isFresh) => {
 *       setEmployees(data);
 *       if (isFresh) setLoading(false);
 *     });
 *   }, []);
 *
 * The `on` callback fires up to twice:
 *   1. immediately with any cached data (isFresh=false)
 *   2. after the network resolves (isFresh=true)
 *
 * After a mutation, callers should invalidate the relevant key:
 *   invalidateEmployees();  // etc.
 */

import { swr, invalidate } from "./cache";
import {
  getEmployees, getCandidates, getLeaveRequests, getGoals,
  getAttendance, getPayroll, getNotifications, getCompensation, getIncentives,
} from "./firebaseService";

type On<T> = (data: T, isFresh: boolean) => void;

const K = {
  employees:      "svc:employees:v1",
  candidates:     "svc:candidates:v1",
  leaveRequests:  (empId?: string) => `svc:leaves:${empId ?? "all"}:v1`,
  goals:          (empId?: string) => `svc:goals:${empId ?? "all"}:v1`,
  attendance:     (date?: string)  => `svc:att:${date ?? "all"}:v1`,
  payroll:        (month?: string, empId?: string) => `svc:pay:${month ?? "all"}:${empId ?? "all"}:v1`,
  notifications:  (userId: string) => `svc:notif:${userId}:v1`,
  compensation:   (empId?: string) => `svc:comp:${empId ?? "all"}:v1`,
  incentives:     (empId?: string) => `svc:inc:${empId ?? "all"}:v1`,
};

export function cachedEmployees(on: On<Record<string, unknown>[]>) {
  return swr(K.employees, () => getEmployees() as Promise<Record<string, unknown>[]>, on);
}
export function cachedCandidates(on: On<Record<string, unknown>[]>) {
  return swr(K.candidates, () => getCandidates() as Promise<Record<string, unknown>[]>, on);
}
export function cachedLeaveRequests(on: On<Record<string, unknown>[]>, empId?: string) {
  return swr(K.leaveRequests(empId), () => getLeaveRequests(empId) as Promise<Record<string, unknown>[]>, on);
}
export function cachedGoals(on: On<Record<string, unknown>[]>, empId?: string) {
  return swr(K.goals(empId), () => getGoals(empId) as Promise<Record<string, unknown>[]>, on);
}
export function cachedAttendance(on: On<Record<string, unknown>[]>, date?: string) {
  return swr(K.attendance(date), () => getAttendance(date) as Promise<Record<string, unknown>[]>, on);
}
export function cachedPayroll(on: On<Record<string, unknown>[]>, month?: string, empId?: string) {
  return swr(K.payroll(month, empId), () => getPayroll(month, empId) as Promise<Record<string, unknown>[]>, on);
}
export function cachedNotifications(on: On<Record<string, unknown>[]>, userId: string) {
  return swr(K.notifications(userId), () => getNotifications(userId), on);
}
export function cachedCompensation(on: On<Record<string, unknown>[]>, empId?: string) {
  return swr(K.compensation(empId), () => getCompensation(empId) as Promise<Record<string, unknown>[]>, on);
}
export function cachedIncentives(on: On<Record<string, unknown>[]>, empId?: string) {
  return swr(K.incentives(empId), () => getIncentives(empId) as Promise<Record<string, unknown>[]>, on);
}

// ── Invalidation helpers — call after mutations ──────────────────────────────
export const invalidateEmployees     = () => invalidate("svc:employees:");
export const invalidateCandidates    = () => invalidate("svc:candidates:");
export const invalidateLeaveRequests = () => invalidate("svc:leaves:");
export const invalidateGoals         = () => invalidate("svc:goals:");
export const invalidateAttendance    = () => invalidate("svc:att:");
export const invalidatePayroll       = () => invalidate("svc:pay:");
export const invalidateNotifications = () => invalidate("svc:notif:");
export const invalidateCompensation  = () => invalidate("svc:comp:");
export const invalidateIncentives    = () => invalidate("svc:inc:");
export const invalidateAll           = () => invalidate("svc:");
