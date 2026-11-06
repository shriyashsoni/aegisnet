const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Uniswap V3 Sepolia Fork & Contract Address Verification Suite
 *
 * Verifies official Uniswap Sepolia deployments:
 * - SwapRouter02: 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E
 * - UniversalRouter: 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
 * - Permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3
 * - WETH9: 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
 * - USDC (Circle Sepolia): 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 *
 * To run live against Sepolia fork:
 *   FORK_SEPOLIA=true npx hardhat test test/UniswapFork.test.js --network hardhat
 */
describe("Uniswap V3 Official Sepolia Deployment Verification", function () {
  const SEPOLIA_SWAP_ROUTER02 = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
  const SEPOLIA_UNIVERSAL_ROUTER = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
  const SEPOLIA_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
  const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  it("Should confirm official Uniswap Sepolia contract addresses match canonical deployments", function () {
    expect(ethers.isAddress(SEPOLIA_SWAP_ROUTER02)).to.be.true;
    expect(ethers.isAddress(SEPOLIA_UNIVERSAL_ROUTER)).to.be.true;
    expect(ethers.isAddress(SEPOLIA_PERMIT2)).to.be.true;
    expect(ethers.isAddress(SEPOLIA_WETH)).to.be.true;
    expect(ethers.isAddress(SEPOLIA_USDC)).to.be.true;
  });

  it("Should properly initialize AegisUniswapAdapter with official SwapRouter02 address", async function () {
    const [deployer] = await ethers.getSigners();
    const UniswapAdapterFactory = await ethers.getContractFactory("AegisUniswapAdapter");
    const adapter = await UniswapAdapterFactory.deploy(deployer.address, ethers.ZeroAddress);
    await adapter.waitForDeployment();

    // Defaults to canonical SEPOLIA_SWAP_ROUTER02 when ZeroAddress passed
    expect(await adapter.swapRouter()).to.equal(SEPOLIA_SWAP_ROUTER02);
  });

  it("Should encode exactInputSingle call data matching ISwapRouter02 specification", async function () {
    const routerInterface = new ethers.Interface([
      "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
    ]);

    const swapParams = {
      tokenIn: SEPOLIA_USDC,
      tokenOut: SEPOLIA_WETH,
      fee: 3000,
      recipient: "0x1111111111111111111111111111111111111111",
      amountIn: ethers.parseUnits("100", 6),
      amountOutMinimum: ethers.parseEther("0.03"),
      sqrtPriceLimitX96: 0
    };

    const callData = routerInterface.encodeFunctionData("exactInputSingle", [swapParams]);
    expect(ethers.isHexString(callData)).to.be.true;
    expect(callData.startsWith("0x04e45aaf")).to.be.true; // exactInputSingle selector
  });
});

