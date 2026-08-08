/**
 * The Solana JSON-RPC call both edge functions verify transactions with.
 *
 * It lives here because `settle` and `candy-mint` carried identical copies, and the two have to
 * agree: each is the step that decides whether something that has *already happened on chain*
 * gets recorded off-chain, so a retry policy fixed in one and not the other still strands users
 * on the other path.
 *
 * Import-free, by the rule for this directory — Deno resolves it by relative path with a `.ts`
 * extension.
 */

const MAX_ATTEMPTS = 5;

// A failed request is not the same as a failed call. An RPC error means the node answered and
// said no; a network error means the request never arrived, so nothing about the chain is known
// yet. Retrying is safe — these are reads — and worth doing, because by this point the caller has
// already signed and landed a transaction, and the only alternative is telling them their mint or
// purchase worked but could not be recorded.
function isTransient(e: unknown): boolean {
  if (e instanceof TypeError) return true; // Deno throws TypeError for DNS and connection failures
  const message = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return /name resolution|dns|network|connect|timed out|timeout|unexpected eof|stream closed/.test(message);
}

const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));

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

  // A gateway that hands back HTML, or nothing at all, is the same kind of blip as a refused
  // connection, so it gets the same treatment rather than surfacing as a JSON parse error.
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
