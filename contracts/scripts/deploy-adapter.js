const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=========================================================");
  console.log("Deploying upgraded AegisUniswapAdapter to Sepolia");
  console.log("=========================================================");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address, "Balance:", ethers.formatEther(balance), "ETH");

  const managerAddr = "0x13d7b8Add8265AB1Cfdc3a6E8E60D1b3bcD56fa8";
  const registryAddr = "0x6Dbd89B71e8AB7BF93a9200C6fB81951699549FE";
  const swapRouter = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";

  console.log("Deploying AegisUniswapAdapter with manager:", managerAddr, "router:", swapRouter);
  const UniswapAdapter = await ethers.getContractFactory("AegisUniswapAdapter");
  const adapter = await UniswapAdapter.deploy(managerAddr, swapRouter);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("AegisUniswapAdapter deployed at:", adapterAddr);

  // Whitelist on registry for the user's nodes
  const registry = await ethers.getContractAt("AegisSubnameRegistry", registryAddr);
  const nodes = [
    "0xbb178d2acebebd29a3ad8f7b3c0135cd4ef9184636124b0152805111b0032306", // shriyashdn
    "0x972a51f142b81a35074802b9e17ddecec0ebef257f88bba58e0de5678427b50e"  // sidd
  ];

  for (const node of nodes) {
    try {
      console.log(`Whitelisting ${adapterAddr} on node ${node.slice(0, 10)}...`);
      const tx = await registry.setTargetContractWhitelist(node, adapterAddr, true);
      await tx.wait();
      console.log(`Whitelisted on node ${node.slice(0, 10)}! Tx: ${tx.hash}`);
    } catch (err) {
      console.warn(`Could not whitelist on node ${node}:`, err.message);
    }
  }

  // Update deployment-config.json
  const configPath = path.join(__dirname, "../deployment-config.json");
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    cfg.contracts.AegisUniswapAdapter = adapterAddr;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    console.log("Updated contracts/deployment-config.json");
  }

  const backendConfig = path.join(__dirname, "../../backend/src/config/contracts.json");
  if (fs.existsSync(backendConfig)) {
    const cfg = JSON.parse(fs.readFileSync(backendConfig, "utf-8"));
    cfg.contracts.AegisUniswapAdapter = adapterAddr;
    fs.writeFileSync(backendConfig, JSON.stringify(cfg, null, 2));
    console.log("Updated backend/src/config/contracts.json");
  }

  const frontendConfig = path.join(__dirname, "../../frontend/deployment-config.json");
  if (fs.existsSync(frontendConfig)) {
    const cfg = JSON.parse(fs.readFileSync(frontendConfig, "utf-8"));
    cfg.contracts.AegisUniswapAdapter = adapterAddr;
    fs.writeFileSync(frontendConfig, JSON.stringify(cfg, null, 2));
    console.log("Updated frontend/deployment-config.json");
  }

  console.log("\nTesting staticCall requestExecution on Sepolia with the new adapter...");
  const manager = await ethers.getContractAt("AegisExecutionManager", managerAddr);
  const swapInterface = new ethers.Interface([
    "function executeSwapVMRoute(bytes encodedInstructions) external returns (uint256)"
  ]);
  const instructions = [
    {
      opcode: 1,
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      tokenOut: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      amountIn: ethers.parseEther("250"),
      minAmountOut: ethers.parseEther("248"),
      extraData: "0x"
    }
  ];
  const encodedInstructions = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
    [instructions]
  );
  const callData = swapInterface.encodeFunctionData("executeSwapVMRoute", [encodedInstructions]);

  try {
    const res = await manager.requestExecution.staticCall(
      adapterAddr,
      callData,
      ethers.parseEther("250"),
      { from: deployer.address }
    );
    console.log("STATIC CALL RESULT: SUCCESS!");
    console.log("Request ID:", res[0]);
    console.log("Requires Biometrics / Approval:", res[1]);
  } catch (err) {
    console.error("Static call failed:", err.message);
  }
}

main().catch(console.error);

