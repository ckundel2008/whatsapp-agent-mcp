import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_TOKEN_AGE_SECONDS = 600;
const MAX_ISSUER_LENGTH = 2048;
const MAX_AUDIENCE_LENGTH = 2048;
const MAX_TOKEN_LENGTH = 32 * 1024;
const MAX_SUBJECT_LENGTH = 256;
const MAX_SCOPE_LENGTH = 2048;

/** A deliberately generic error for all bearer-token authentication failures. */
export class AuthenticationError extends Error {
  constructor() {
    super('invalid token');
    this.name = 'AuthenticationError';
    this.code = 'invalid_token';
  }
}

function configurationError(message) {
  return new TypeError(`Invalid token verifier configuration: ${message}`);
}

function boundedString(value, name, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw configurationError(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function validateIssuer(value) {
  boundedString(value, 'issuer', MAX_ISSUER_LENGTH);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError('issuer must be an HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw configurationError('issuer must be an HTTPS URL without credentials or fragments');
  }
  return value;
}

function audienceConfig(value) {
  if (typeof value === 'string') return [boundedString(value, 'audience', MAX_AUDIENCE_LENGTH)];
  if (Array.isArray(value) && value.length > 0 && value.length <= 16) {
    return value.map((item) => boundedString(item, 'audience', MAX_AUDIENCE_LENGTH));
  }
  throw configurationError('audience must be a string or a non-empty string array');
}

function validateJwks(jwks) {
  if (!jwks || typeof jwks !== 'object' || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw configurationError('jwks must be a non-empty JSON Web Key Set');
  }
  try {
    return createLocalJWKSet(jwks);
  } catch {
    throw configurationError('jwks is not a valid JSON Web Key Set');
  }
}

function validateJwksUrl(jwksUrl) {
  if (typeof jwksUrl !== 'string' || jwksUrl.length > MAX_ISSUER_LENGTH) {
    throw configurationError('jwksUrl must be an HTTPS URL');
  }
  let parsed;
  try {
    parsed = new URL(jwksUrl);
  } catch {
    throw configurationError('jwksUrl must be an HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw configurationError('jwksUrl must be an HTTPS URL without credentials or fragments');
  }
  return createRemoteJWKSet(parsed);
}

function validateDateClaim(payload, claim) {
  return typeof payload[claim] === 'number' && Number.isFinite(payload[claim]);
}

function readScopes(payload) {
  if (payload.scope === undefined) return [];
  if (typeof payload.scope !== 'string' || payload.scope.length > MAX_SCOPE_LENGTH) {
    throw new AuthenticationError();
  }
  if (payload.scope === '') return [];
  // OAuth scope values are separated by literal spaces. Reject controls and
  // alternate whitespace so callers never receive ambiguous scope strings.
  if (!/^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/.test(payload.scope)) {
    throw new AuthenticationError();
  }
  return payload.scope.split(' ');
}

/**
 * Create a verifier for access tokens accepted by this resource server.
 * `jwks` is intended for tests/local injection; production configuration must
 * provide a fixed HTTPS `jwksUrl`.
 */
export function createTokenVerifier({
  issuer,
  audience,
  jwksUrl,
  jwks,
  clockTolerance = 5,
  maxTokenAgeSeconds = MAX_TOKEN_AGE_SECONDS,
} = {}) {
  validateIssuer(issuer);
  const audiences = audienceConfig(audience);

  if (typeof clockTolerance !== 'number' || !Number.isFinite(clockTolerance) || clockTolerance < 0 || clockTolerance > 300) {
    throw configurationError('clockTolerance must be a number between 0 and 300 seconds');
  }
  if (!Number.isInteger(maxTokenAgeSeconds) || maxTokenAgeSeconds < 1 || maxTokenAgeSeconds > MAX_TOKEN_AGE_SECONDS) {
    throw configurationError(`maxTokenAgeSeconds must be an integer between 1 and ${MAX_TOKEN_AGE_SECONDS}`);
  }
  if (jwks !== undefined && jwksUrl !== undefined) {
    throw configurationError('provide either jwks or jwksUrl, not both');
  }
  const keyResolver = jwks !== undefined
    ? validateJwks(jwks)
    : jwksUrl !== undefined
      ? validateJwksUrl(jwksUrl)
      : (() => { throw configurationError('jwksUrl is required outside test configuration'); })();

  const verifyOptions = {
    algorithms: ['RS256', 'ES256'],
    issuer,
    audience: audiences,
    clockTolerance,
    maxTokenAge: `${maxTokenAgeSeconds}s`,
    requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
  };

  return async function verifyToken(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw new AuthenticationError();
    }
    try {
      const { payload } = await jwtVerify(token, keyResolver, verifyOptions);
      if (typeof payload.iss !== 'string' || payload.iss !== issuer ||
          typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > MAX_SUBJECT_LENGTH ||
          /[\u0000-\u001f\u007f]/.test(payload.sub) ||
          !validateDateClaim(payload, 'exp') || !validateDateClaim(payload, 'iat') ||
          payload.exp < payload.iat || payload.exp - payload.iat > maxTokenAgeSeconds) {
        throw new AuthenticationError();
      }
      const scopes = readScopes(payload);
      return Object.freeze({
        issuer: payload.iss,
        subject: payload.sub,
        scopes: Object.freeze(scopes),
      });
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError();
    }
  };
}

export function principalKey(identity) {
  if (!identity || typeof identity.issuer !== 'string' || typeof identity.subject !== 'string') {
    throw new TypeError('identity must contain issuer and subject strings');
  }
  return JSON.stringify([identity.issuer, identity.subject]);
}
