// How many days an open treatment can sit in the queue before it's flagged as overdue.

export const TASK_REMINDER_DAYS = 3

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function daysOpen(createdAt) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / MS_PER_DAY)
}
// Soon to be moved to 4 AM?

export function isOverdue(createdAt) {
  return daysOpen(createdAt) >= TASK_REMINDER_DAYS
}
