const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=========================================================");
  console.log("🚀 AegisNet End-to-End Live Sepolia Transaction Demo");
  console.log("=========================================================");

  const [deployer] = await ethers.getSigners();
  console.log(`Executing Account: ${deployer.address}`);

  // Load deployed addresses
  const configPath = path.join(__dirname, "../deployment-config.json");
  if (!fs.existsSync(configPath)) {
    console.error("❌ deployment-config.json not found! Please run deploy script first.");
    process.exit(1);
  }

  const deployConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const contracts = deployConfig.contracts;

  console.log("\nLoaded Deployed Contracts:");
  console.log(`> AegisSubnameRegistry: ${contracts.AegisSubnameRegistry}`);
  console.log(`> AegisExecutionManager: ${contracts.AegisExecutionManager}`);
  console.log(`> AegisSwapVMAdapter   : ${contracts.AegisSwapVMAdapter}`);
  if (contracts.AegisUniswapAdapter) {
    console.log(`> AegisUniswapAdapter  : ${contracts.AegisUniswapAdapter}`);
  }

  const registry = await ethers.getContractAt("AegisSubnameRegistry", contracts.AegisSubnameRegistry);
  const manager = await ethers.getContractAt("AegisExecutionManager", contracts.AegisExecutionManager);
  const swapVM = await ethers.getContractAt("AegisSwapVMAdapter", contracts.AegisSwapVMAdapter);

  const SUBNAME_LABEL = "agent1";
  const agentWallet = deployer.address; // Using deployer as agent for live demo
  const BIOMETRIC_THRESHOLD = ethers.parseEther("1000"); // $1,000 threshold
  const DAILY_LIMIT = ethers.parseEther("50000");

  // -------------------------------------------------------------
  // PHASE I: ENSv2 Subname Registration & EAC Delegation
  // -------------------------------------------------------------
  console.log("\n---------------------------------------------------------");
  console.log("Phase I: Registering Agent Subname & ENSv2 EAC Setup");
  console.log("---------------------------------------------------------");

  // Check if subname already registered
  let subnameNode = await registry.agentToNode(agentWallet);
  if (subnameNode === ethers.ZeroHash) {
    console.log(`Registering subname "${SUBNAME_LABEL}.${deployConfig.rootName}" for agent ${agentWallet}...`);
    const regTx = await registry.registerSubname(
      SUBNAME_LABEL,
      agentWallet,
      BIOMETRIC_THRESHOLD,
      DAILY_LIMIT
    );
    await regTx.wait();
    console.log(`✅ Subname registered! Tx: ${regTx.hash}`);
    subnameNode = await registry.agentToNode(agentWallet);
  } else {
    console.log(`ℹ️ Subname already registered. Node: ${subnameNode}`);
  }

  console.log("Whitelisting target contracts (1inch SwapVM & Uniswap V3 Adapter)...");
  const wlTx1 = await registry.setTargetContractWhitelist(subnameNode, contracts.AegisSwapVMAdapter, true);
  await wlTx1.wait();
  if (contracts.AegisUniswapAdapter) {
    const wlTx2 = await registry.setTargetContractWhitelist(subnameNode, contracts.AegisUniswapAdapter, true);
    await wlTx2.wait();
  }
  console.log("✅ EAC Whitelisting Complete!");

  console.log("Setting ENSIP-26 Agent Text Records...");
  const txtTx1 = await registry.setTextRecord(subnameNode, "agent.capabilities", "uniswap-v3,1inch-swapvm,yield-arbitrage");
  await txtTx1.wait();
  const txtTx2 = await registry.setTextRecord(subnameNode, "agent.biometric_threshold", "1000");
  await txtTx2.wait();
  console.log("✅ ENSIP-26 Text Records Configured!");

  // -------------------------------------------------------------
  // PHASE II: Low-Value Execution ($500 < $1,000 Auto-Approval)
  // -------------------------------------------------------------
  console.log("\n---------------------------------------------------------");
  console.log("Phase II: Low-Value Execution ($500 USD - Auto Approval)");
  console.log("---------------------------------------------------------");

  const mockTokenAddr = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // Sepolia USDC mock or dummy
  const lowValueInstructions = [
    {
      opcode: 1, // OP_EXCHANGE_SWAP (1inch Aggregator direct swap)
      tokenIn: mockTokenAddr,
      tokenOut: mockTokenAddr,
      amountIn: ethers.parseEther("500"),
      minAmountOut: ethers.parseEther("497"),
      extraData: "0x"
    }
  ];

  const encodedLowCall = swapVM.interface.encodeFunctionData("executeSwapVMRoute", [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
      [lowValueInstructions]
    )
  ]);

  console.log("Requesting $500 swap execution...");
  const lowExecTx = await manager.requestExecution(
    contracts.AegisSwapVMAdapter,
    encodedLowCall,
    ethers.parseEther("500")
  );
  const lowReceipt = await lowExecTx.wait();
  console.log(`✅ Low-value transaction auto-executed! Tx: ${lowExecTx.hash}`);

  // -------------------------------------------------------------
  // PHASE III: High-Value Execution ($5,000 > $1,000 Interception)
  // -------------------------------------------------------------
  console.log("\n---------------------------------------------------------");
  console.log("Phase III: High-Value Interception & World ID Verification");
  console.log("---------------------------------------------------------");

  const highValueInstructions = [
    {
      opcode: 5, // OP_AQUA_DEPOSIT (1inch Aqua position creation)
      tokenIn: mockTokenAddr,
      tokenOut: mockTokenAddr,
      amountIn: ethers.parseEther("5000"),
      minAmountOut: ethers.parseEther("5000"),
      extraData: "0x"
    },
    {
      opcode: 6, // OP_AQUA_WITHDRAW (1inch Aqua yield harvest)
      tokenIn: mockTokenAddr,
      tokenOut: mockTokenAddr,
      amountIn: ethers.parseEther("5000"),
      minAmountOut: ethers.parseEther("5100"),
      extraData: "0x"
    }
  ];

  const encodedHighCall = swapVM.interface.encodeFunctionData("executeSwapVMRoute", [
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
      [highValueInstructions]
    )
  ]);

  console.log("Requesting $5,000 high-value transaction...");
  const highReqTx = await manager.requestExecution(
    contracts.AegisSwapVMAdapter,
    encodedHighCall,
    ethers.parseEther("5000")
  );
  const highReceipt = await highReqTx.wait();

  const reqEvent = highReceipt.logs.find(log => {
    try {
      const parsed = manager.interface.parseLog(log);
      return parsed && parsed.name === "ExecutionRequested";
    } catch { return false; }
  });

  const parsedReqEvent = manager.interface.parseLog(reqEvent);
  const requestId = parsedReqEvent.args.requestId;
  console.log(`🛡️ Biometric Interception Triggered! Request ID: ${requestId}`);
  console.log(`Requires Biometrics: ${parsedReqEvent.args.requiresBiometrics}`);

  console.log("\nSimulating World ID Agent Pass Verification via Relayer...");
  const nullifierHash = 987654321;
  const managerAddr = contracts.AegisExecutionManager;
  const network = await ethers.provider.getNetwork();
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = latestBlock.timestamp + 15 * 60;

  const messageHash = ethers.solidityPackedKeccak256(
    ["bytes32", "uint256", "uint256", "address", "uint256"],
    [requestId, nullifierHash, deadline, managerAddr, network.chainId]
  );
  const sig = await deployer.signMessage(ethers.getBytes(messageHash));

  console.log("Submitting World ID Agent Pass attestation & atomically executing on Sepolia...");
  const approveTx = await manager["approveWithRelayer(bytes32,uint256,uint256,bytes)"](
    requestId,
    nullifierHash,
    deadline,
    sig
  );
  await approveTx.wait();
  console.log(`🎉 High-value 1inch Aqua transaction approved & executed on Sepolia! Tx: ${approveTx.hash}`);

  // -------------------------------------------------------------
  // PHASE IV: Uniswap V3 Execution Adapter Verification
  // -------------------------------------------------------------
  console.log("\n---------------------------------------------------------");
  console.log("Phase IV: Uniswap V3 Execution Adapter Verification");
  console.log("---------------------------------------------------------");

  if (contracts.AegisUniswapAdapter) {
    const uniswapAdapter = await ethers.getContractAt("AegisUniswapAdapter", contracts.AegisUniswapAdapter);
    const configuredRouter = await uniswapAdapter.swapRouter();
    console.log(`✅ AegisUniswapAdapter configured with SwapRouter02 at: ${configuredRouter}`);
  } else {
    console.log("ℹ️ AegisUniswapAdapter not deployed in current config, skipping V3 router check.");
  }

  console.log("\n=========================================================");
  console.log("🏆 ALL PHASES SUCCESSFULLY EXECUTED LIVE ON SEPOLIA!");
  console.log("=========================================================");
}

main().catch((error) => {
  console.error("❌ Live execution failed:", error);
  process.exitCode = 1;
});
