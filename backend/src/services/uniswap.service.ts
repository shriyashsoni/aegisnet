import { ethers } from 'ethers';
import { config } from '../config';
import { provider } from '../chain';
import { UniswapAdapterABI } from '../abis';

export const UNISWAP_SEPOLIA_CONFIG = {
  swapRouter02: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
  universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  tokens: {
    WETH: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  pools: {
    'USDC-WETH-0.05%': { fee: 500 },
    'USDC-WETH-0.3%': { fee: 3000 },
  },
};

export class UniswapService {
  private adapterAddress = config.contracts.AegisUniswapAdapter;

  /** Accepts a bytes32 pool ID, or any label (e.g. "USDC/WETH-0.3%") which is hashed into one */
  static toPoolId(poolId: string): string {
    return ethers.isHexString(poolId, 32) ? poolId : ethers.keccak256(ethers.toUtf8Bytes(poolId));
  }

  async getRouterAddress(): Promise<string> {
    if (!this.adapterAddress) return UNISWAP_SEPOLIA_CONFIG.swapRouter02;
    try {
      const adapter = new ethers.Contract(this.adapterAddress, UniswapAdapterABI, provider);
      return await adapter.swapRouter();
    } catch {
      return UNISWAP_SEPOLIA_CONFIG.swapRouter02;
    }
  }

  async getInfo() {
    const router = await this.getRouterAddress();
    return {
      version: 'Uniswap V3',
      network: 'Ethereum Sepolia (11155111)',
      adapterAddress: this.adapterAddress,
      swapRouter: router,
      universalRouter: UNISWAP_SEPOLIA_CONFIG.universalRouter,
      permit2: UNISWAP_SEPOLIA_CONFIG.permit2,
      supportedTokens: UNISWAP_SEPOLIA_CONFIG.tokens,
      supportedPools: UNISWAP_SEPOLIA_CONFIG.pools,
      executionManager: config.contracts.AegisExecutionManager,
    };
  }

  async isPoolGated(_poolId: string): Promise<boolean> {
    // V4 mock hook gating removed; real Uniswap execution is routed through Uniswap V3 SwapRouter02
    return false;
  }

  async getHookOwner(): Promise<string> {
    return ethers.ZeroAddress;
  }

  async setPoolGated(_poolId: string, _isGated: boolean): Promise<string> {
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }
}
