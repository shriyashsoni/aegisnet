const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const WETH_ADDR = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const USDC_ADDR = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const WETH_ABI = [
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  console.log("=========================================================");
  console.log("🚀 Executing AegisNet Full Live Flow on Ethereum Sepolia");
  console.log("=========================================================");

  const [deployer] = await ethers.getSigners();
  const configPath = path.join(__dirname, "../deployment-config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("deployment-config.json not found. Deploy contracts first.");
  }

  const deployConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const contracts = deployConfig.contracts;
  const network = await ethers.provider.getNetwork();

  console.log(`Network    : Sepolia (Chain ID: ${network.chainId})`);
  console.log(`Operator   : ${deployer.address}`);
  console.log(`Registry   : ${contracts.AegisSubnameRegistry}`);
  console.log(`Manager    : ${contracts.AegisExecutionManager}`);
  console.log(`Uniswap    : ${contracts.AegisUniswapAdapter}`);

  // Determine relayer wallet
  let relayerWallet = deployer;
  if (process.env.RELAYER_PRIVATE_KEY && !process.env.RELAYER_PRIVATE_KEY.includes("YOUR_")) {
    relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, ethers.provider);
  }
  console.log(`Relayer    : ${relayerWallet.address}\n`);

  const registry = await ethers.getContractAt("AegisSubnameRegistry", contracts.AegisSubnameRegistry);
  const manager = await ethers.getContractAt("AegisExecutionManager", contracts.AegisExecutionManager);
  const uniswapAdapter = await ethers.getContractAt("AegisUniswapAdapter", contracts.AegisUniswapAdapter);
  const weth = await ethers.getContractAt(WETH_ABI, WETH_ADDR);
  const usdc = await ethers.getContractAt(ERC20_ABI, USDC_ADDR);

  const SUBNAME_LABEL = "agent1";
  const agentWallet = deployer.address;
  const BIOMETRIC_THRESHOLD = ethers.parseEther("1000"); // $1,000 threshold
  const DAILY_LIMIT = ethers.parseEther("50000"); // $50,000 daily limit

  // 1. ENS Subname Setup & EAC Whitelisting
  console.log("1. Setting up ENS Subname and EAC Whitelist...");
  let subnameNode = await registry.agentToNode(agentWallet);
  if (subnameNode === ethers.ZeroHash) {
    console.log(`   Registering subname "${SUBNAME_LABEL}.${deployConfig.rootName}"...`);
    const regTx = await registry.registerSubname(SUBNAME_LABEL, agentWallet, BIOMETRIC_THRESHOLD, DAILY_LIMIT);
    await regTx.wait();
    subnameNode = await registry.agentToNode(agentWallet);
    console.log(`   ✅ Registered subname node: ${subnameNode}`);
  } else {
    console.log(`   ℹ️ Subname node already registered: ${subnameNode}`);
  }

  const isWhitelisted = await registry.whitelistedTargets(subnameNode, contracts.AegisUniswapAdapter);
  if (!isWhitelisted) {
    console.log("   Whitelisting AegisUniswapAdapter on EAC...");
    const wlTx = await registry.setTargetContractWhitelist(subnameNode, contracts.AegisUniswapAdapter, true);
    await wlTx.wait();
    console.log("   ✅ AegisUniswapAdapter whitelisted!");
  } else {
    console.log("   ℹ️ AegisUniswapAdapter already whitelisted on EAC.");
  }

  // 2. Wrap Sepolia ETH into WETH & Approve Adapter
  console.log("\n2. Preparing WETH Liquidity for Swaps...");
  const initialWethBal = await weth.balanceOf(deployer.address);
  console.log(`   Current WETH Balance: ${ethers.formatEther(initialWethBal)} WETH`);

  if (initialWethBal < ethers.parseEther("0.002")) {
    console.log("   Wrapping 0.005 Sepolia ETH into WETH...");
    const wrapTx = await weth.deposit({ value: ethers.parseEther("0.005") });
    await wrapTx.wait();
    console.log(`   ✅ Wrapped ETH into WETH (Tx: ${wrapTx.hash})`);
  }

  console.log("   Approving AegisUniswapAdapter to transfer WETH...");
  const appTx = await weth.approve(contracts.AegisUniswapAdapter, ethers.MaxUint256);
  await appTx.wait();
  console.log("   ✅ WETH approval set!");

  // 3. FLOW 1: Low-Value Auto-Executed Swap ($200 USD < $1,000 Threshold)
  console.log("\n---------------------------------------------------------");
  console.log("3. Executing Low-Value Auto-Executed Swap ($200 USD)");
  console.log("---------------------------------------------------------");

  const lowAmountIn = ethers.parseEther("0.0005"); // 0.0005 WETH
  const lowCallData = uniswapAdapter.interface.encodeFunctionData("executeSwap", [
    WETH_ADDR,
    USDC_ADDR,
    3000, // 0.3% pool
    lowAmountIn,
    0, // minimum output (market)
    deployer.address, // recipient
    deployer.address  // payer
  ]);

  const lowExecTx = await manager.requestExecution(
    contracts.AegisUniswapAdapter,
    lowCallData,
    ethers.parseUnits("200", 18) // $200 USD equivalent (< threshold)
  );
  console.log(`   Transaction submitted! Hash: ${lowExecTx.hash}`);
  const lowReceipt = await lowExecTx.wait();
  console.log(`   ✅ Low-Value Swap confirmed in block ${lowReceipt.blockNumber}!`);
  console.log(`   🔗 Etherscan: https://sepolia.etherscan.io/tx/${lowExecTx.hash}`);

  // 4. FLOW 2: High-Value World ID Approved Swap ($2,500 USD >= $1,000 Threshold)
  console.log("\n---------------------------------------------------------");
  console.log("4. Executing High-Value World ID Gated Swap ($2,500 USD)");
  console.log("---------------------------------------------------------");

  const highAmountIn = ethers.parseEther("0.001"); // 0.001 WETH
  const highCallData = uniswapAdapter.interface.encodeFunctionData("executeSwap", [
    WETH_ADDR,
    USDC_ADDR,
    3000,
    highAmountIn,
    0,
    deployer.address,
    deployer.address
  ]);

  console.log("   Submitting high-value trade request to manager...");
  const highReqTx = await manager.requestExecution(
    contracts.AegisUniswapAdapter,
    highCallData,
    ethers.parseUnits("2500", 18) // $2,500 USD equivalent (>= threshold)
  );
  const highReqReceipt = await highReqTx.wait();
  console.log(`   Request submitted! Tx: ${highReqTx.hash}`);

  // Extract requestId
  const reqEvent = highReqReceipt.logs
    .map((log) => {
      try {
        return manager.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "ExecutionRequested");

  if (!reqEvent) throw new Error("ExecutionRequested event not found in receipt!");
  const requestId = reqEvent.args.requestId;
  console.log(`   🛡️ Interception triggered! RequestId: ${requestId}`);
  console.log(`   Requires Biometrics: ${reqEvent.args.requiresBiometrics}`);

  // World ID Agent Pass Attestation
  console.log("\n   Generating World ID Agent Pass Attestation from Relayer...");
  const nullifierHash = BigInt(ethers.hexlify(ethers.randomBytes(16))); // Random unique nullifier
  const block = await ethers.provider.getBlock("latest");
  const deadline = block.timestamp + 15 * 60; // 15 minute expiry window

  const digest = ethers.solidityPackedKeccak256(
    ["bytes32", "uint256", "uint256", "address", "uint256"],
    [requestId, nullifierHash, deadline, contracts.AegisExecutionManager, network.chainId]
  );
  const sig = await relayerWallet.signMessage(ethers.getBytes(digest));
  console.log(`   ✅ Attestation signed by relayer (${relayerWallet.address})`);

  console.log("   Broadcasting approveWithRelayer to execute trade onchain...");
  const approveTx = await manager.approveWithRelayer(requestId, nullifierHash, deadline, sig);
  console.log(`   Approval submitted! Tx: ${approveTx.hash}`);
  const approveReceipt = await approveTx.wait();
  console.log(`   ✅ High-Value Swap executed in block ${approveReceipt.blockNumber}!`);
  console.log(`   🔗 Etherscan: https://sepolia.etherscan.io/tx/${approveTx.hash}`);

  const finalUsdcBal = await usdc.balanceOf(deployer.address);
  console.log(`\n🎉 Final Recipient USDC Balance: ${Number(finalUsdcBal) / 1e6} USDC`);
  console.log("\n=========================================================");
  console.log("🏆 LIVE ONCHAIN PROOFS (SEPOLIA):");
  console.log(`1. Low-Value Auto-Executed Swap:`);
  console.log(`   https://sepolia.etherscan.io/tx/${lowExecTx.hash}`);
  console.log(`2. High-Value World ID Approved Swap:`);
  console.log(`   https://sepolia.etherscan.io/tx/${approveTx.hash}`);
  console.log("=========================================================");

  return {
    lowValueTx: lowExecTx.hash,
    highValueTx: approveTx.hash,
  };
}

main().catch((err) => {
  console.error("❌ Live execution error:", err);
  process.exitCode = 1;
});
