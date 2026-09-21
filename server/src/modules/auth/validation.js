const { z } = require('zod');
const { validate } = require('../../lib/validate');

const loginSchema = z.object({
  email: z.string().email('Invalid email').trim().toLowerCase(),
  // bcrypt silently truncates past 72 bytes: longer input would hash a prefix
  // of the password (two distinct long passwords could verify identically),
  // so the boundary rejects it instead. Cap is in characters (ASCII worst
  // case); multibyte edge margin is accepted, truncation is not.
  password: z.string().min(1, 'Password required').max(72, 'Password too long'),
});

const signupSchema = z.object({
  organizationName: z.string().trim().min(2, 'Organization name too short').max(100, 'Organization name too long'),
  name: z.string().trim().min(2, 'Name too short').max(100, 'Name too long'),
  email: z.string().email('Invalid email').trim().toLowerCase().max(100, 'Email too long'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password too long'),
  confirmPassword: z.string().min(8).max(72),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

const refreshSchema = z.object({
  // Raw tokens are 96 hex chars; the cap only blocks pathological input.
  refreshToken: z.string().min(10).max(200).optional(),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(10).max(200).optional(),
});


module.exports = { loginSchema, signupSchema, refreshSchema, logoutSchema, validate };
