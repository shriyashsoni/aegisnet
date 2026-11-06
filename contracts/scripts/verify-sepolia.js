const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=========================================================");
  console.log("🔍 AegisNet Etherscan Contract Verification Script");
  console.log("=========================================================");

  const configPath = path.join(__dirname, "../deployment-config.json");
  if (!fs.existsSync(configPath)) {
    console.error("❌ deployment-config.json not found. Run deploy-sepolia.js first.");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { rootName, deployer, contracts } = deployment;

  console.log(`Network : Sepolia`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Root ENS: ${rootName}\n`);

  const items = [
    {
      name: "AegisSubnameRegistry",
      address: contracts.AegisSubnameRegistry,
      args: [rootName],
    },
    {
      name: "AegisExecutionManager",
      address: contracts.AegisExecutionManager,
      args: [contracts.AegisSubnameRegistry, 1, deployer],
    },
    {
      name: "AegisUniswapAdapter",
      address: contracts.AegisUniswapAdapter,
      args: [contracts.AegisExecutionManager, "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E"],
    },
    {
      name: "AegisSwapVMAdapter",
      address: contracts.AegisSwapVMAdapter,
      args: [contracts.AegisExecutionManager],
    },
  ];

  for (const item of items) {
    console.log(`Verifying ${item.name} at ${item.address}...`);
    try {
      await hre.run("verify:verify", {
        address: item.address,
        constructorArguments: item.args,
      });
      console.log(`✅ ${item.name} verified successfully!\n`);
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes("already verified")) {
        console.log(`ℹ️  ${item.name} is already verified on Etherscan.\n`);
      } else {
        console.warn(`⚠️  ${item.name} verification warning: ${err.message}\n`);
      }
    }
  }

  console.log("=========================================================");
  console.log("🎉 Verification routine complete!");
  console.log("=========================================================");
}

main().catch((err) => {
  console.error("Verification process failed:", err);
  process.exitCode = 1;
});

