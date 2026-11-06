const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=========================================================");
  console.log("🚀 AegisNet Sepolia Testnet Deployment Script");
  console.log("=========================================================");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Deployer Account: ${deployer.address}`);
  console.log(`Account Balance : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("❌ ERROR: Deployer account has 0 Sepolia ETH. Please fund account with Sepolia ETH before deploying.");
    process.exit(1);
  }

  const rootName = process.env.ENS_ROOT_NAME || "aegisnet.eth";
  const externalNullifier = process.env.WORLD_ID_EXTERNAL_NULLIFIER || 1;
  const relayerSigner = process.env.RELAYER_ADDRESS || deployer.address;

  // 1. AegisSubnameRegistry
  console.log("\n1. Deploying AegisSubnameRegistry...");
  const Registry = await ethers.getContractFactory("AegisSubnameRegistry");
  const registry = await Registry.deploy(rootName);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`> AegisSubnameRegistry deployed at: ${registryAddr}`);

  // 2. AegisExecutionManager
  console.log("\n2. Deploying AegisExecutionManager...");
  console.log(`> Relayer Signer Account: ${relayerSigner}`);
  const Manager = await ethers.getContractFactory("AegisExecutionManager");
  const manager = await Manager.deploy(
    registryAddr,
    externalNullifier,
    relayerSigner
  );
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();
  console.log(`> AegisExecutionManager deployed at: ${managerAddr}`);

  // Link manager to registry
  await (await registry.setExecutionManager(managerAddr)).wait();
  console.log(`> AegisSubnameRegistry executionManager set to: ${managerAddr}`);

  // 3. AegisUniswapAdapter (Uniswap V3)
  console.log("\n3. Deploying AegisUniswapAdapter (Uniswap V3 SwapRouter02)...");
  const SEPOLIA_ROUTER = process.env.UNISWAP_ROUTER_ADDRESS || "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
  const UniswapAdapter = await ethers.getContractFactory("AegisUniswapAdapter");
  const uniswapAdapter = await UniswapAdapter.deploy(managerAddr, SEPOLIA_ROUTER);
  await uniswapAdapter.waitForDeployment();
  const uniswapAdapterAddr = await uniswapAdapter.getAddress();
  console.log(`> AegisUniswapAdapter deployed at: ${uniswapAdapterAddr} (Router: ${SEPOLIA_ROUTER})`);

  // 4. AegisSwapVMAdapter (Legacy prototype labeled OUT OF SCOPE)
  console.log("\n4. Deploying AegisSwapVMAdapter (Legacy SwapVM prototype)...");
  const SwapVM = await ethers.getContractFactory("AegisSwapVMAdapter");
  const swapVM = await SwapVM.deploy(managerAddr);
  await swapVM.waitForDeployment();
  const swapVMAddr = await swapVM.getAddress();
  console.log(`> AegisSwapVMAdapter deployed at: ${swapVMAddr}`);

  const network = await ethers.provider.getNetwork();

  const deploymentData = {
    network: network.name,
    chainId: network.chainId.toString(),
    rootName,
    deployer: deployer.address,
    contracts: {
      AegisSubnameRegistry: registryAddr,
      AegisExecutionManager: managerAddr,
      AegisUniswapAdapter: uniswapAdapterAddr,
      AegisSwapVMAdapter: swapVMAddr,
    },
    timestamp: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "../deployment-config.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));

  // Mirror to backend config
  const backendConfigDir = path.join(__dirname, "../../backend/src/config");
  if (!fs.existsSync(backendConfigDir)) {
    fs.mkdirSync(backendConfigDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(backendConfigDir, "contracts.json"),
    JSON.stringify(deploymentData, null, 2)
  );

  console.log("\n=========================================================");
  console.log("✅ ALL SMART CONTRACTS SUCCESSFULLY DEPLOYED TO SEPOLIA!");
  console.log(`Deployment config saved to: ${outputPath}`);
  console.log("=========================================================");
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});
