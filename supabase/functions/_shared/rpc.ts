const MAX_ATTEMPTS = 5;

function isTransient(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const message = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return /name resolution|dns|network|connect|timed out|timeout|unexpected eof|stream closed/.test(message);
}

const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));

export async function rpcCallForResult(
  rpcUrl: string,
  method: string,
  params: unknown[],
  attempts = 4
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const result = await rpcCall(rpcUrl, method, params);
    if (result !== null && result !== undefined) return result;
    if (attempt >= attempts) return result;
    await backoff(attempt);
  }
}

export async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
  attempt = 1
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (e) {
    if (attempt < MAX_ATTEMPTS && isTransient(e)) {
      await backoff(attempt);
      return rpcCall(rpcUrl, method, params, attempt + 1);
    }
    throw new Error(
      `${method}: could not reach the Solana RPC — ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let body: { error?: { message?: string }; result?: unknown };
  try {
    body = await response.json();
  } catch {
    if (attempt < MAX_ATTEMPTS) {
      await backoff(attempt);
      return rpcCall(rpcUrl, method, params, attempt + 1);
    }
    throw new Error(`${method}: the Solana RPC returned ${response.status}, which was not JSON.`);
  }

  const isRateLimited =
    response.status === 429 ||
    (typeof body.error?.message === "string" && body.error.message.toLowerCase().includes("rate limit"));
  if ((isRateLimited || response.status >= 500) && attempt < MAX_ATTEMPTS) {
    await backoff(attempt);
    return rpcCall(rpcUrl, method, params, attempt + 1);
  }
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
