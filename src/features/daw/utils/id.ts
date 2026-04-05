import { nanoid } from 'nanoid';

export function generateId(): string {
  return nanoid(10);
}

export function generateShortId(): string {
  return nanoid(6);
}
