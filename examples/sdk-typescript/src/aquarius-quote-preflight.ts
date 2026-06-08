import {
  preflightAquariusSwap,
  quoteAquariusSwap,
  type AquariusSwapPreflight,
  type AquariusSwapQuote
} from "@stellar-agent/defi";

export interface AquariusQuoteAndPreflightResult {
  quote: AquariusSwapQuote;
  preflight: AquariusSwapPreflight;
}

export async function buildAquariusQuoteAndPreflight(fetchImpl: typeof fetch = fetch): Promise<AquariusQuoteAndPreflightResult> {
  const request = {
    network: "testnet" as const,
    inputAsset: "XLM",
    outputAsset: "AQUA",
    amount: "0.01",
    mode: "strict_send" as const
  };

  const quote = await quoteAquariusSwap({
    ...request,
    fetchImpl
  });

  const preflight = await preflightAquariusSwap({
    ...request,
    slippageBps: 100,
    fetchImpl
  });

  return { quote, preflight };
}
