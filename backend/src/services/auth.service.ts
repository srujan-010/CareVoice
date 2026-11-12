import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { withOptionalTransaction } from '../config/database';
import { UserRole } from '../constants/statuses';
import { Family } from '../models/Family';
import { User } from '../models/User';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/errors';
import { isValidTimezone } from '../utils/timezone';
import { recordAudit } from './audit.service';

export interface RegisterInput {
  familyName: string;
  name: string;
  email: string;
  password: string;
  phone?: string;
  timezone: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateTeamMemberInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  phone?: string;
}

function signToken(payload: {
  userId: string;
  familyId: string;
  role: UserRole;
  tokenVersion: number;
}): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export async function registerFamilyAccount(input: RegisterInput, ipAddress?: string) {
  if (!isValidTimezone(input.timezone)) {
    throw new ValidationError(`Invalid IANA timezone: ${input.timezone}`);
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const created = await withOptionalTransaction(async (session) => {
    const [family] = await Family.create(
      [
        {
          name: input.familyName.trim(),
          primaryContactName: input.name.trim(),
          primaryContactEmail: normalizedEmail,
          primaryContactPhone: input.phone?.trim(),
          timezone: input.timezone,
        },
      ],
      session ? { session } : undefined
    );

    const [user] = await User.create(
      [
        {
          familyId: family._id,
          name: input.name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'ADMIN',
          phone: input.phone?.trim(),
          lastLoginAt: new Date(),
          tokenVersion: 0,
        },
      ],
      session ? { session } : undefined
    );

    return { family, user };
  });

  await recordAudit({
    familyId: created.family._id,
    actorType: 'USER',
    actorId: String(created.user._id),
    action: 'FAMILY_ACCOUNT_REGISTERED',
    resourceType: 'Family',
    resourceId: String(created.family._id),
    ipAddress,
  });

  const token = signToken({
    userId: String(created.user._id),
    familyId: String(created.family._id),
    role: created.user.role,
    tokenVersion: created.user.tokenVersion,
  });

  return {
    token,
    user: {
      id: String(created.user._id),
      familyId: String(created.family._id),
      name: created.user.name,
      email: created.user.email,
      role: created.user.role,
      phone: created.user.phone,
    },
    family: {
      id: String(created.family._id),
      name: created.family.name,
      timezone: created.family.timezone,
      settings: created.family.settings,
    },
  };
}

export async function loginUser(input: LoginInput, ipAddress?: string) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!user.isActive) {
    throw new UnauthorizedError('This user account has been deactivated');
  }

  const matches = await bcrypt.compare(input.password, user.passwordHash);
  if (!matches) {
    throw new UnauthorizedError('Invalid email or password');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const family = await Family.findById(user.familyId).lean();
  if (!family || !family.isActive) {
    throw new UnauthorizedError('Family account is inactive');
  }

  await recordAudit({
    familyId: user.familyId,
    actorType: 'USER',
    actorId: String(user._id),
    action: 'USER_LOGIN',
    resourceType: 'User',
    resourceId: String(user._id),
    ipAddress,
  });

  const token = signToken({
    userId: String(user._id),
    familyId: String(user.familyId),
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  return {
    token,
    user: {
      id: String(user._id),
      familyId: String(user.familyId),
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    },
    family: {
      id: String(family._id),
      name: family.name,
      timezone: family.timezone,
      settings: family.settings,
    },
  };
}

export async function logoutUser(userId: string, familyId: string, ipAddress?: string) {
  await User.findOneAndUpdate(
    { _id: new Types.ObjectId(userId), familyId: new Types.ObjectId(familyId) },
    { $inc: { tokenVersion: 1 } }
  );

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: userId,
    action: 'USER_LOGOUT',
    resourceType: 'User',
    resourceId: userId,
    ipAddress,
  });
}

export async function getCurrentSession(userId: string, familyId: string) {
  const user = await User.findOne({
    _id: new Types.ObjectId(userId),
    familyId: new Types.ObjectId(familyId),
  }).lean();
  if (!user) throw new NotFoundError('User');

  const family = await Family.findById(familyId).lean();
  if (!family) throw new NotFoundError('Family');

  return {
    user: {
      id: String(user._id),
      familyId: String(user.familyId),
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      lastLoginAt: user.lastLoginAt,
    },
    family: {
      id: String(family._id),
      name: family.name,
      primaryContactName: family.primaryContactName,
      primaryContactEmail: family.primaryContactEmail,
      primaryContactPhone: family.primaryContactPhone,
      timezone: family.timezone,
      settings: family.settings,
    },
  };
}

export async function listFamilyCaregivers(familyId: string) {
  const users = await User.find({ familyId: new Types.ObjectId(familyId) })
    .sort({ createdAt: 1 })
    .lean();

  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  }));
}

export async function createFamilyCaregiver(
  familyId: string,
  actorUserId: string,
  input: CreateTeamMemberInput,
  ipAddress?: string
) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({
    familyId: new Types.ObjectId(familyId),
    name: input.name.trim(),
    email: normalizedEmail,
    passwordHash,
    role: input.role,
    phone: input.phone?.trim(),
  });

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'CAREGIVER_USER_CREATED',
    resourceType: 'User',
    resourceId: String(user._id),
    ipAddress,
    metadata: { role: input.role },
  });

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export async function updateFamilyProfile(
  familyId: string,
  actorUserId: string,
  updates: {
    name?: string;
    primaryContactPhone?: string;
    timezone?: string;
    settings?: {
      autoEscalationMinutes?: number;
      maxCallbackRetries?: number;
    };
  }
) {
  if (updates.timezone && !isValidTimezone(updates.timezone)) {
    throw new ValidationError(`Invalid IANA timezone: ${updates.timezone}`);
  }

  const family = await Family.findById(familyId);
  if (!family) throw new NotFoundError('Family');

  if (updates.name) family.name = updates.name.trim();
  if (updates.primaryContactPhone !== undefined) {
    family.primaryContactPhone = updates.primaryContactPhone.trim();
  }
  if (updates.timezone) family.timezone = updates.timezone;
  if (updates.settings) {
    if (updates.settings.autoEscalationMinutes !== undefined) {
      family.settings.autoEscalationMinutes = updates.settings.autoEscalationMinutes;
    }
    if (updates.settings.maxCallbackRetries !== undefined) {
      family.settings.maxCallbackRetries = updates.settings.maxCallbackRetries;
    }
  }

  await family.save();

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'FAMILY_SETTINGS_UPDATED',
    resourceType: 'Family',
    resourceId: familyId,
  });

  return {
    id: String(family._id),
    name: family.name,
    primaryContactName: family.primaryContactName,
    primaryContactEmail: family.primaryContactEmail,
    primaryContactPhone: family.primaryContactPhone,
    timezone: family.timezone,
    settings: family.settings,
  };
}

