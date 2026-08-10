import { z } from 'zod';

/**
 * BigInt schema that accepts string representation
 */
export const BigIntFromString = z.string().transform((val) => BigInt(val));

/**
 * Date schema from ISO string
 */
export const DateFromISO = z.string().transform((val) => new Date(val));
