export const SWA_EXTERNAL_TOKEN_HEADER = "x-swallowkit-external-token";

export function generateSafeBackendError(): string {
  return `async function safeBackendError(response: Response): Promise<{ error: string; code?: string }> {
  const failures: Record<string, [number, string]> = {
    unauthenticated: [401, 'Authentication required'],
    invalid_token: [401, 'Invalid token'],
    expired_token: [401, 'Token expired'],
    identity_provider_unavailable: [503, 'Identity provider unavailable'],
    verifier_not_configured: [500, 'External token verifier is not configured'],
    verifier_unavailable: [503, 'External token verifier unavailable'],
  };
  if ([401, 500, 503].includes(response.status)) {
    const body: unknown = await response.json().catch(() => null);
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' &&
        Object.prototype.hasOwnProperty.call(failures, body.code)) {
      const [status, error] = failures[body.code];
      if (status === response.status) return { code: body.code, error };
    }
  }
  return { error: 'Backend request failed' };
}
`;
}
