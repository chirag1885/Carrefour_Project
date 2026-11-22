import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { AppError, conflict, unauthorized } from '../common/errors';
import type { Role } from '../common/auth.types';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import type { LoginDto, RegisterDto } from './auth.schemas';

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  locale: 'en' | 'ar';
  home_store_id: number | null;
  password_hash?: string;
}

export interface SessionBody {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; email: string; fullName: string; role: Role; locale: 'en' | 'ar'; homeStoreId: number | null };
}

export interface SessionResult {
  session: SessionBody;
  refreshToken: string;
}

const USER_COLS = 'id, email, full_name, role, locale, home_store_id';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const REUSE_GRACE_MS = 10_000; // two tabs refreshing at once must not look like token theft

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  // Used to equalise timing when the email is unknown (avoids user enumeration by response time).
  private readonly dummyHash = bcrypt.hashSync('not-a-real-password', env.BCRYPT_COST);

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<SessionResult> {
    const passwordHash = await bcrypt.hash(dto.password, env.BCRYPT_COST);
    try {
      const { user, refreshToken } = await this.db.tx(async (c) => {
        const r = await c.query<UserRow>(
          `INSERT INTO users (email, password_hash, full_name, locale) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLS}`,
          [dto.email, passwordHash, dto.fullName, dto.locale],
        );
        const u = r.rows[0];
        await c.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [u.id]);
        await c.query(`INSERT INTO wishlists (user_id, name, is_default) VALUES ($1, 'My Wishlist', true)`, [u.id]);
        const token = await this.createRefreshToken(c, u.id, randomUUID());
        return { user: u, refreshToken: token };
      });
      return { session: await this.buildSession(user), refreshToken };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      throw e;
    }
  }

  async login(dto: LoginDto, ip: string | undefined): Promise<SessionResult> {
    await this.enforceLoginLimit(ip, dto.email);

    const r = await this.db.query<UserRow>(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = $1`, [dto.email]);
    const row = r.rows[0];
    const ok = await bcrypt.compare(dto.password, row?.password_hash ?? this.dummyHash);
    if (!row || !ok) throw unauthorized('INVALID_CREDENTIALS', 'Incorrect email or password');

    const refreshToken = await this.db.tx((c) => this.createRefreshToken(c, row.id, randomUUID()));
    return { session: await this.buildSession(row), refreshToken };
  }

  /** Rotates the refresh token. A reused (already rotated) token revokes the whole family. */
  async refresh(rawToken: string | undefined): Promise<SessionResult> {
    if (!rawToken) throw unauthorized('UNAUTHORIZED', 'Missing refresh token');
    const hash = sha256(rawToken);

    type Outcome = { kind: 'ok'; user: UserRow; token: string } | { kind: 'fail' };
    const outcome = await this.db.tx<Outcome>(async (c) => {
      const t = await c.query<{ id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null }>(
        'SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [hash],
      );
      const tok = t.rows[0];
      if (!tok) return { kind: 'fail' };

      if (tok.revoked_at) {
        if (Date.now() - tok.revoked_at.getTime() > REUSE_GRACE_MS) {
          await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [tok.family_id]);
          this.log.warn(`refresh token reuse detected, family ${tok.family_id} revoked`);
        }
        return { kind: 'fail' };
      }
      if (tok.expires_at.getTime() < Date.now()) return { kind: 'fail' };

      const u = await c.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [tok.user_id]);
      if (!u.rows[0]) return { kind: 'fail' };

      await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [tok.id]);
      const token = await this.createRefreshToken(c, tok.user_id, tok.family_id);
      return { kind: 'ok', user: u.rows[0], token };
    });

    if (outcome.kind === 'fail') throw unauthorized('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    return { session: await this.buildSession(outcome.user), refreshToken: outcome.token };
  }

  /** Revokes the whole token family. Silent if the token is unknown. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
      [sha256(rawToken)],
    );
  }

  private async buildSession(user: UserRow): Promise<SessionBody> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role }, { expiresIn: env.JWT_ACCESS_TTL_SECONDS });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, locale: user.locale, homeStoreId: user.home_store_id },
    };
  }

  private async createRefreshToken(c: PoolClient, userId: string, familyId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await c.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [userId, familyId, sha256(raw), env.JWT_REFRESH_TTL_DAYS],
    );
    return raw; // only the hash is stored
  }

  /** 10 attempts per 15 min per ip+email. Skipped if Redis is down. */
  private async enforceLoginLimit(ip: string | undefined, email: string): Promise<void> {
    try {
      const n = await this.redis.hit(`rl:login:${ip ?? 'unknown'}:${email}`, 900);
      if (n > 10) throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Try again in 15 minutes.');
    } catch (e) {
      if (e instanceof AppError) throw e;
      this.log.warn(`login rate limit skipped: ${(e as Error).message}`);
    }
  }
}