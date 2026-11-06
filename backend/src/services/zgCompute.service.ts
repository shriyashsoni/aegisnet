import { z } from 'zod';
import { config } from '../config';
import { HttpError } from '../validate';
import { zgProofService } from './zgProof.service';

export const TOKEN_SYMBOLS = ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC'] as const;

export const ZGPlanSchema = z.object({
  strategyType: z.enum(['swap', 'split_swap', 'aqua_position']),
  tokenIn: z.enum(TOKEN_SYMBOLS),
  tokenOut: z.enum(TOKEN_SYMBOLS),
  useUniswapV4Hop: z.boolean().default(false),
  summary: z.string(),
  rationale: z.array(z.string()),
  riskNotes: z.array(z.string()),
});

export type ZGPlan = z.infer<typeof ZGPlanSchema>;

export interface ZGPlannerContext {
  goalPrompt: string;
  amountUSD: number;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  approvalThresholdUSD: number;
  dailyLimitUSD?: number;
  spentTodayUSD?: number;
}

const SYSTEM_PROMPT = `You are the strategy planner for AegisNet running inside 0G Private Compute (TEE-attested decentralized AI).
AegisNet is a guardrailed execution layer for AI trading agents on Ethereum.

Turn the operator's goal into a plan for the 1inch SwapVM / Uniswap V3 execution layer.
You only choose the high-level plan; deterministic smart contracts and SDK code encode and execute the onchain transactions.

Available strategy types:
- "swap": direct aggregator swap (0x01) with minimum-output slippage check (0x03).
- "split_swap": split order across liquidity sources for large size price efficiency (0x02), then slippage check.
- "aqua_position": 1inch Aqua self-custodial liquidity position (0x05, 0x06). Use for yield, liquidity, or "earn" goals.

Supported tokens: USDC, USDT, DAI, WETH, WBTC. tokenIn and tokenOut must differ. If the operator fixed a token, preserve it.

Respond strictly with valid JSON conforming to this schema (do NOT wrap in markdown or prose outside the JSON):
{
  "strategyType": "swap" | "split_swap" | "aqua_position",
  "tokenIn": "USDC" | "USDT" | "DAI" | "WETH" | "WBTC",
  "tokenOut": "USDC" | "USDT" | "DAI" | "WETH" | "WBTC",
  "useUniswapV4Hop": false,
  "summary": "One clear sentence describing the trade for the operator",
  "rationale": ["Short sentence 1", "Short sentence 2"],
  "riskNotes": ["Mention if trade is >= approval threshold ($X) requiring human World ID verification"]
}`;

export class ZGComputeService {
  get endpoint() {
    return config.zgComputeEndpoint;
  }

  get model() {
    return config.zgComputeModel;
  }

  get hasApiKey() {
    return Boolean(config.zgComputeApiKey);
  }

  /**
   * Plans strategy using 0G Private Compute via OpenAI-compatible API.
   * If 0G is unreachable or fails, FAILS SAFE: throws HttpError so no trade is proposed.
   */
  async plan(ctx: ZGPlannerContext): Promise<{ plan: ZGPlan; requestId: string; model: string }> {
    if (!config.zgComputeApiKey) {
      throw new HttpError(
        503,
        '0G Private Compute API key is not configured (ZG_COMPUTE_API_KEY). Failed safe: no trade proposed without verifiable 0G planner clearance.'
      );
    }

    const remaining =
      ctx.dailyLimitUSD !== undefined ? Math.max(0, ctx.dailyLimitUSD - (ctx.spentTodayUSD || 0)) : undefined;

    const facts = [
      `Goal: ${ctx.goalPrompt}`,
      `Trade size: $${ctx.amountUSD.toLocaleString('en-US')}`,
      `Approval threshold (World ID required at or above): $${ctx.approvalThresholdUSD.toLocaleString('en-US')}`,
      remaining !== undefined
        ? `Remaining daily limit: $${remaining.toLocaleString('en-US')}`
        : 'Daily limit: unknown',
      ctx.tokenInSymbol ? `Operator fixed tokenIn: ${ctx.tokenInSymbol}` : '',
      ctx.tokenOutSymbol ? `Operator fixed tokenOut: ${ctx.tokenOutSymbol}` : '',
    ].filter(Boolean);

    const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;
    let response: globalThis.Response;
    let requestId: string = '';

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.zgComputeApiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: facts.join('\n') },
          ],
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: any) {
      console.error('[0G Compute] Network connection error:', err.message);
      throw new HttpError(
        503,
        `0G Private Compute is unreachable (${err.message}). Failed safe: no trade proposed.`
      );
    }

    requestId =
      response.headers.get('x-request-id') ||
      response.headers.get('request-id') ||
      response.headers.get('x-0g-request-id') ||
      '';

    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (err: any) {
      throw new HttpError(
        503,
        `0G Private Compute response read error: ${err.message}. Failed safe: no trade proposed.`
      );
    }

    let json: any = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      // not JSON
    }

    if (json && json.id && !requestId) {
      requestId = json.id;
    }

    if (!response.ok) {
      const errorMsg =
        (json && (json.error?.message || json.message)) ||
        `HTTP ${response.status} ${response.statusText}`;
      const fullMsg = `0G Private Compute error [${errorMsg}]${requestId ? ` (Request ID: ${requestId})` : ''}. Failed safe: no trade proposed.`;
      console.error('[0G Compute] API error:', fullMsg);
      throw new HttpError(503, fullMsg);
    }

    if (!json || !json.choices || !json.choices.length || !json.choices[0].message?.content) {
      throw new HttpError(
        503,
        `0G Private Compute returned an empty or invalid completion${requestId ? ` (Request ID: ${requestId})` : ''}. Failed safe: no trade proposed.`
      );
    }

    const rawContent = json.choices[0].message.content.trim();
    const cleaned = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsedObj: any;
    try {
      parsedObj = JSON.parse(cleaned);
    } catch (err: any) {
      console.error('[0G Compute] Could not parse model JSON response:', rawContent);
      throw new HttpError(
        503,
        `0G Private Compute produced non-JSON strategy output. Failed safe: no trade proposed.`
      );
    }

    const parseResult = ZGPlanSchema.safeParse(parsedObj);
    if (!parseResult.success) {
      console.error('[0G Compute] Model output failed schema validation:', parseResult.error.format());
      throw new HttpError(
        503,
        `0G Private Compute output did not meet safety schema: ${parseResult.error.issues.map((i) => i.message).join(', ')}. Failed safe: no trade proposed.`
      );
    }

    const plan = parseResult.data;
    if (plan.tokenIn === plan.tokenOut) {
      throw new HttpError(
        503,
        `0G Private Compute proposed identical token pair ${plan.tokenIn}/${plan.tokenOut}. Failed safe: no trade proposed.`
      );
    }

    // Log request ID and record proof
    console.log(`[0G Compute] Planner call completed | Request ID: ${requestId} | Model: ${this.model}`);
    zgProofService.recordCompute(requestId);

    return {
      plan,
      requestId,
      model: this.model,
    };
  }
}

export const zgComputeService = new ZGComputeService();
