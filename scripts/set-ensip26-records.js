const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { ethers } = require('ethers');

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('Missing PRIVATE_KEY in .env');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  console.log(`Using owner signer: ${signer.address}`);

  const registryAddress = '0x6Dbd89B71e8AB7BF93a9200C6fB81951699549FE';
  const RegistryABI = [
    'function agentToNode(address) view returns (bytes32)',
    'function setTextRecord(bytes32 subnameNode, string calldata key, string calldata value) external',
    'function getTextRecord(bytes32 subnameNode, string calldata key) view returns (string)',
  ];

  const registry = new ethers.Contract(registryAddress, RegistryABI, signer);
  const node = await registry.agentToNode(signer.address);
  console.log(`Agent node: ${node}`);

  const records = {
    'agent.capabilities': 'uniswap_v3_swap,0g_compute_strategy,worldid_2fa',
    'agent.biometric_threshold': '1000',
    'agent.operator': signer.address,
    'agent.proof_of_ownership': '0x2dda15445e66943d7a0e52dbd6c8f0ea736b1772320a35e2a6912b3d809f0754',
    'agent.storage_root': '0x58776c490fe4e9c847e7ebc42d0d895aeb4268c1478d1ac48d62c4dc40726ecb',
    'agent.specification': 'ENSv2 EAC & ENSIP-26 Agent Text Records',
  };

  for (const [key, val] of Object.entries(records)) {
    console.log(`Setting ${key} = "${val}"...`);
    const tx = await registry.setTextRecord(node, key, val);
    console.log(`  Tx sent: ${tx.hash}`);
    await tx.wait(1);
    console.log(`  Confirmed!`);
  }

  console.log('\n--- Verifying records on Sepolia ---');
  for (const key of Object.keys(records)) {
    const readVal = await registry.getTextRecord(node, key);
    console.log(`  ${key}: "${readVal}"`);
  }

  console.log('\n✅ All ENSIP-26 text records successfully confirmed on Sepolia!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

