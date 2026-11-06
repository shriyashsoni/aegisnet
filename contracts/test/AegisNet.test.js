const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AegisNet Matrix Core Protocol Tests", function () {
  let owner, agent, user, relayer;
  let registry, executionManager, swapVMAdapter, uniswapAdapter, mockSwapRouter, mockToken, mockWETH;

  const ROOT_NAME = "aegisnet.eth";
  const SUBNAME_LABEL = "agent1";
  const BIOMETRIC_THRESHOLD = ethers.parseEther("1000"); // $1000 USD threshold
  const DAILY_LIMIT = ethers.parseEther("50000");

  beforeEach(async function () {
    [owner, agent, user, relayer] = await ethers.getSigners();

    // 1. Deploy AegisSubnameRegistry
    const RegistryFactory = await ethers.getContractFactory("AegisSubnameRegistry");
    registry = await RegistryFactory.deploy(ROOT_NAME);
    await registry.waitForDeployment();

    // 2. Deploy AegisExecutionManager
    const ManagerFactory = await ethers.getContractFactory("AegisExecutionManager");
    executionManager = await ManagerFactory.deploy(
      await registry.getAddress(),
      1, // External Nullifier
      relayer.address // Dedicated Relayer Signer
    );
    await executionManager.waitForDeployment();

    // Link executionManager in registry
    await registry.connect(owner).setExecutionManager(await executionManager.getAddress());

    // 3. Deploy Mock SwapRouter02 & AegisUniswapAdapter (Uniswap V3)
    const MockRouterFactory = await ethers.getContractFactory("MockSwapRouter02");
    mockSwapRouter = await MockRouterFactory.deploy();
    await mockSwapRouter.waitForDeployment();

    const UniswapAdapterFactory = await ethers.getContractFactory("AegisUniswapAdapter");
    uniswapAdapter = await UniswapAdapterFactory.deploy(
      await executionManager.getAddress(),
      await mockSwapRouter.getAddress()
    );
    await uniswapAdapter.waitForDeployment();

    // 4. Deploy 1inch SwapVM Adapter (Labeled OUT OF SCOPE prototype)
    const SwapVMFactory = await ethers.getContractFactory("AegisSwapVMAdapter");
    swapVMAdapter = await SwapVMFactory.deploy(await executionManager.getAddress());
    await swapVMAdapter.waitForDeployment();

    // 5. Deploy Mock ERC20 Tokens (USDC & WETH)
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    mockToken = await TokenFactory.deploy("USD Coin", "USDC");
    await mockToken.waitForDeployment();

    mockWETH = await TokenFactory.deploy("Wrapped Ether", "WETH");
    await mockWETH.waitForDeployment();
  });

  describe("Phase I: Identity & Delegation (ENSv2 EAC)", function () {
    it("Should register agent subname and set EAC target whitelists", async function () {
      const tx = await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );
      await tx.wait();

      const subnameNode = await registry.agentToNode(agent.address);
      expect(subnameNode).to.not.equal(ethers.ZeroHash);

      // Whitelist SwapVM Adapter target contract
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );

      const [isAllowed, requiresBio] = await registry.isAgentAuthorized(
        agent.address,
        await swapVMAdapter.getAddress(),
        ethers.parseEther("500")
      );

      expect(isAllowed).to.be.true;
      expect(requiresBio).to.be.false; // $500 < $1000 threshold
    });

    it("Should flag high-value actions for World ID biometric interception", async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );

      // Check transaction value $2,500 >= $1,000 threshold
      const [isAllowed, requiresBio] = await registry.isAgentAuthorized(
        agent.address,
        await swapVMAdapter.getAddress(),
        ethers.parseEther("2500")
      );

      expect(isAllowed).to.be.true;
      expect(requiresBio).to.be.true;
    });

    it("Should set and resolve ENSIP-26 Agent Text Records (agent.capabilities & agent.biometric_threshold)", async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);

      await registry.connect(owner).setTextRecord(subnameNode, "agent.capabilities", "1inch-swapvm,uniswap-v4-hook");
      await registry.connect(owner).setTextRecord(subnameNode, "agent.biometric_threshold", "1000");

      const capRecord = await registry.getTextRecord(subnameNode, "agent.capabilities");
      const bioRecord = await registry.getTextRecord(subnameNode, "agent.biometric_threshold");

      expect(capRecord).to.equal("1inch-swapvm,uniswap-v4-hook");
      expect(bioRecord).to.equal("1000");
    });

    it("Should allow owner to set executionManager once and prevent resetting", async function () {
      expect(await registry.executionManager()).to.equal(await executionManager.getAddress());

      await expect(
        registry.connect(owner).setExecutionManager(user.address)
      ).to.be.revertedWith("AegisRegistry: execution manager already set");
    });

    it("Should restrict recordSpend to only executionManager and revert on outside caller", async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );
      const subnameNode = await registry.agentToNode(agent.address);

      await expect(
        registry.connect(user).recordSpend(subnameNode, ethers.parseEther("100"))
      ).to.be.revertedWith("AegisRegistry: caller is not execution manager");
    });
  });

  describe("Phase II & III: Strategy Execution & Human Approval Interception", function () {
    beforeEach(async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );
    });

    it("Should auto-execute transactions below $1,000 threshold", async function () {
      const instructions = [
        {
          opcode: 1, // OP_EXCHANGE_SWAP
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("100"),
          minAmountOut: ethers.parseEther("99"),
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      // Request low-value execution ($500)
      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("500")
      );
      const receipt = await tx.wait();

      const reqEvent = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      expect(reqEvent).to.not.be.undefined;
      expect(reqEvent.args.requiresBiometrics).to.be.false;
    });

    it("Should intercept transaction above $1,000 and enforce human approval via relayer", async function () {
      const instructions = [
        {
          opcode: 1,
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("5000"),
          minAmountOut: ethers.parseEther("4900"),
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      // Request high-value execution ($5,000 > $1,000)
      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("5000")
      );
      const receipt = await tx.wait();

      const reqEvent = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;
      expect(reqEvent.args.requiresBiometrics).to.be.true;

      // Verification before approval should fail
      await expect(
        executionManager.connect(agent).executeVerifiedTransaction(requestId)
      ).to.be.revertedWith("AegisManager: pending human approval");

      // Verify via Relayer signature
      const nullifierHash = 123456789;
      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "address", "uint256"],
        [requestId, nullifierHash, managerAddr, network.chainId]
      );
      
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      await executionManager.connect(user).approveWithRelayer(
        requestId,
        nullifierHash,
        sig
      );

      // Now execution should succeed!
      const execTx = await executionManager.connect(agent).executeVerifiedTransaction(requestId);
      const execReceipt = await execTx.wait();
      
      const execEvent = execReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionExecuted");
      expect(execEvent.args.success).to.be.true;
    });

    it("Should verify approval via backward-compatible alias and block nullifier replay", async function () {
      const instructions = [
        {
          opcode: 1,
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("3000"),
          minAmountOut: ethers.parseEther("2950"),
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("3000")
      );
      const receipt = await tx.wait();
      const reqEvent = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;

      const nullifierHash = 987654321;
      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "address", "uint256"],
        [requestId, nullifierHash, managerAddr, network.chainId]
      );
      
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      await executionManager.connect(user).verifyBiometricsWithRelayer(
        requestId,
        nullifierHash,
        sig
      );

      // Replay of same nullifier should revert
      await expect(
        executionManager.connect(user).approveWithRelayer(requestId, nullifierHash, sig)
      ).to.be.revertedWith("AegisManager: nullifier used");

      const execTx = await executionManager.connect(agent).executeVerifiedTransaction(requestId);
      const execReceipt = await execTx.wait();
      const execEvent = execReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionExecuted");
      expect(execEvent.args.success).to.be.true;
    });

    it("Should accurately track request lifecycle via view helpers", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("1500"),
        minAmountOut: ethers.parseEther("1480"),
        extraData: "0x"
      }];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("1500")
      );
      const receipt = await tx.wait();
      const reqEvent = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;

      // Check view helpers when pending
      expect(await executionManager.isRequestPending(requestId)).to.be.true;
      expect(await executionManager.isRequestReadyForExecution(requestId)).to.be.false;

      const nullifier = 999888777;
      expect(await executionManager.isNullifierUsed(nullifier)).to.be.false;

      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "address", "uint256"],
        [requestId, nullifier, managerAddr, network.chainId]
      );
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      await executionManager.connect(user).approveWithRelayer(requestId, nullifier, sig);

      // Now request is ready for execution, and nullifier is consumed
      expect(await executionManager.isRequestPending(requestId)).to.be.false;
      expect(await executionManager.isRequestReadyForExecution(requestId)).to.be.true;
      expect(await executionManager.isNullifierUsed(nullifier)).to.be.true;

      const details = await executionManager.getExecutionRequest(requestId);
      expect(details.isVerified).to.be.true;
      expect(details.isExecuted).to.be.false;

      await executionManager.connect(agent).executeVerifiedTransaction(requestId);
      expect(await executionManager.isRequestReadyForExecution(requestId)).to.be.false;
    });

    it("Should reject approveWithRelayer with invalid or forged signature", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("2000"),
        minAmountOut: ethers.parseEther("1980"),
        extraData: "0x"
      }];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("2000")
      );
      const receipt = await tx.wait();
      const requestId = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested").args.requestId;

      const nullifier = 555444333;
      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();

      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "address", "uint256"],
        [requestId, nullifier, managerAddr, network.chainId]
      );

      // Sign with unauthorized key (user instead of relayer/owner)
      const forgedSig = await user.signMessage(ethers.getBytes(messageHash));

      await expect(
        executionManager.connect(user).approveWithRelayer(requestId, nullifier, forgedSig)
      ).to.be.revertedWith("AegisManager: invalid relayer signature");
    });

    it("Should enforce daily spend limit on requestExecution (under-limit, over-limit, and next-day reset)", async function () {
      const customSubname = "agent-limit";
      await registry.connect(owner).registerSubname(
        customSubname,
        user.address,
        ethers.parseEther("500"),
        ethers.parseEther("1000")
      );
      const subnameNode = await registry.agentToNode(user.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );

      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("100"),
        minAmountOut: ethers.parseEther("99"),
        extraData: "0x"
      }];
      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      // 1. Under-limit request: $400 USD (auto-executes because < $500 threshold)
      const tx1 = await executionManager.connect(user).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("400")
      );
      await tx1.wait();

      const permAfter1 = await registry.getAgentPermissions(subnameNode);
      expect(permAfter1.currentDailySpent).to.equal(ethers.parseEther("400"));

      // 2. Over-limit request: $700 USD ($400 + $700 = $1,100 > $1,000 limit) -> Reverts
      await expect(
        executionManager.connect(user).requestExecution(
          await swapVMAdapter.getAddress(),
          encodedCall,
          ethers.parseEther("700")
        )
      ).to.be.revertedWith("AegisManager: daily limit exceeded");

      // Another under-limit: $500 USD ($400 + $500 = $900 <= $1,000) -> Allowed
      const tx2 = await executionManager.connect(user).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("500")
      );
      await tx2.wait();

      // Over limit check: $400 + $650 = $1,050 > $1,000
      await expect(
        executionManager.connect(user).requestExecution(
          await swapVMAdapter.getAddress(),
          encodedCall,
          ethers.parseEther("650")
        )
      ).to.be.revertedWith("AegisManager: daily limit exceeded");

      // 3. Fast-forward to the next day (25 hours)
      await time.increase(25 * 3600);

      // Next-day reset: now a $800 request succeeds!
      const tx3 = await executionManager.connect(user).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("800")
      );
      await tx3.wait();
    });

    it("Should verify approval signatures against distinct relayer and allow owner to rotate relayer", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("2000"),
        minAmountOut: ethers.parseEther("1980"),
        extraData: "0x"
      }];
      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("2000")
      );
      const receipt = await tx.wait();
      const requestId = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested").args.requestId;

      const nullifier = 888777666;
      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();

      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "address", "uint256"],
        [requestId, nullifier, managerAddr, network.chainId]
      );

      // Signature by owner (who is NOT the relayer) must be rejected
      const ownerSig = await owner.signMessage(ethers.getBytes(messageHash));
      await expect(
        executionManager.connect(user).approveWithRelayer(requestId, nullifier, ownerSig)
      ).to.be.revertedWith("AegisManager: invalid relayer signature");

      // Non-owner cannot update relayer signer
      await expect(
        executionManager.connect(user).setRelayerSigner(user.address)
      ).to.be.revertedWith("AegisManager: caller is not owner");

      // Owner rotates relayer signer to user.address
      await executionManager.connect(owner).setRelayerSigner(user.address);
      expect(await executionManager.relayerSigner()).to.equal(user.address);

      // Now user signature succeeds
      const userSig = await user.signMessage(ethers.getBytes(messageHash));
      await executionManager.connect(user).approveWithRelayer(requestId, nullifier, userSig);
      expect(await executionManager.isRequestReadyForExecution(requestId)).to.be.true;
    });

    it("Should expire pending high-value executions after 15 minutes and allow anyone to cancel them", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("2500"),
        minAmountOut: ethers.parseEther("2450"),
        extraData: "0x"
      }];
      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("2500")
      );
      const receipt = await tx.wait();
      const requestId = receipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested").args.requestId;

      const reqDetails = await executionManager.getExecutionRequest(requestId);
      expect(reqDetails.deadline).to.equal(reqDetails.createdAt + 15n * 60n);
      expect(await executionManager.isRequestPending(requestId)).to.be.true;
      expect(await executionManager.isRequestExpired(requestId)).to.be.false;

      // 1. Fast forward past 15 minutes (16 minutes)
      await time.increase(16 * 60);

      expect(await executionManager.isRequestPending(requestId)).to.be.false;
      expect(await executionManager.isRequestExpired(requestId)).to.be.true;

      // 2. Reject approval after expiry
      const nullifier = 444333222;
      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "address", "uint256"],
        [requestId, nullifier, managerAddr, network.chainId]
      );
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      await expect(
        executionManager.connect(user).approveWithRelayer(requestId, nullifier, sig)
      ).to.be.revertedWith("AegisManager: request expired");

      // 3. Anyone (including an unrelated stranger / user) can cancel an expired request
      const cancelTx = await executionManager.connect(user).cancelExecution(requestId);
      await cancelTx.wait();

      const afterCancel = await executionManager.getExecutionRequest(requestId);
      expect(afterCancel.isCancelled).to.be.true;

      // 4. Expired and cancelled request can never execute
      await expect(
        executionManager.connect(agent).executeVerifiedTransaction(requestId)
      ).to.be.revertedWith("AegisManager: pending human approval");
    });

    it("Should bind each owner to one verified human nullifier and reject reuse across owners", async function () {
      const nullifierA = 111222333444n;
      const nullifierB = 555666777888n;

      // 1. Owner binds nullifierA
      await executionManager.connect(owner).bindOwnerNullifier(owner.address, nullifierA);
      expect(await executionManager.ownerToNullifier(owner.address)).to.equal(nullifierA);
      expect(await executionManager.nullifierToOwner(nullifierA)).to.equal(owner.address);

      // Idempotent binding for same owner and same nullifier
      await executionManager.connect(owner).bindOwnerNullifier(owner.address, nullifierA);

      // 2. Reject binding the same owner to a different nullifier
      await expect(
        executionManager.connect(owner).bindOwnerNullifier(owner.address, nullifierB)
      ).to.be.revertedWith("AegisManager: owner already bound to different nullifier");

      // 3. Reject reusing an already-bound nullifier for a different owner
      await expect(
        executionManager.connect(user).bindOwnerNullifier(user.address, nullifierA)
      ).to.be.revertedWith("AegisManager: nullifier already bound to another owner");

      // 4. Unauthorized caller cannot bind an arbitrary address
      await expect(
        executionManager.connect(user).bindOwnerNullifier(agent.address, nullifierB)
      ).to.be.revertedWith("AegisManager: unauthorized binding caller");

      // 5. User successfully binds nullifierB
      await executionManager.connect(user).bindOwnerNullifier(user.address, nullifierB);
      expect(await executionManager.ownerToNullifier(user.address)).to.equal(nullifierB);
      expect(await executionManager.nullifierToOwner(nullifierB)).to.equal(user.address);
    });

    it("Should verify and immediately execute trade with World ID Agent Pass approveWithRelayer(requestId, nullifier, deadline, sig)", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("2000"),
        minAmountOut: ethers.parseEther("1980"),
        extraData: "0x"
      }];
      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);
      const highValUSD = ethers.parseEther("2000");

      const reqTx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        highValUSD
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;

      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock.timestamp + 15 * 60;
      const nullifier = 999888777111n;

      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "uint256", "address", "uint256"],
        [requestId, nullifier, deadline, managerAddr, network.chainId]
      );
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      // Execute via 4-argument approveWithRelayer
      const approveTx = await executionManager.connect(user)["approveWithRelayer(bytes32,uint256,uint256,bytes)"](
        requestId,
        nullifier,
        deadline,
        sig
      );
      const approveReceipt = await approveTx.wait();

      const approvedEvent = approveReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionApproved");
      expect(approvedEvent).to.not.be.undefined;

      const executedEvent = approveReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionExecuted");
      expect(executedEvent).to.not.be.undefined;
      expect(executedEvent.args.success).to.be.true;

      const req = await executionManager.getExecutionRequest(requestId);
      expect(req.isVerified).to.be.true;
      expect(req.isExecuted).to.be.true;
      expect(await executionManager.isNullifierUsed(nullifier)).to.be.true;
    });

    it("Should prevent execution and leave trade unexecuted on human denial (denied path)", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("3000"),
        minAmountOut: ethers.parseEther("2970"),
        extraData: "0x"
      }];
      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const reqTx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("3000")
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;

      // Human explicitly denies the trade: relayer refuses to issue an attestation
      // Autonomous agent cannot execute without human approval
      await expect(
        executionManager.connect(agent).executeVerifiedTransaction(requestId)
      ).to.be.revertedWith("AegisManager: pending human approval");

      const req = await executionManager.getExecutionRequest(requestId);
      expect(req.isVerified).to.be.false;
      expect(req.isExecuted).to.be.false;
    });

    it("Should reject approveWithRelayer and leave trade unexecuted on expired deadline (expired path)", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("2500"),
        minAmountOut: ethers.parseEther("2475"),
        extraData: "0x"
      }];
      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const reqTx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("2500")
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;

      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock.timestamp + 10 * 60; // 10 minute deadline
      const nullifier = 777666555444n;

      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "uint256", "address", "uint256"],
        [requestId, nullifier, deadline, managerAddr, network.chainId]
      );
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      // Fast forward past deadline (11 minutes)
      await time.increase(11 * 60);

      // Attempting to approve an expired attestation must revert
      await expect(
        executionManager.connect(user)["approveWithRelayer(bytes32,uint256,uint256,bytes)"](
          requestId,
          nullifier,
          deadline,
          sig
        )
      ).to.be.revertedWith("AegisManager: deadline expired");

      const req = await executionManager.getExecutionRequest(requestId);
      expect(req.isExecuted).to.be.false;
    });

    it("Should reject approveWithRelayer and leave trade unexecuted on cancelled request (cancelled path)", async function () {
      const instructions = [{
        opcode: 1,
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockToken.getAddress(),
        amountIn: ethers.parseEther("4000"),
        minAmountOut: ethers.parseEther("3960"),
        extraData: "0x"
      }];
      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const reqTx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("4000")
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;

      // Owner cancels the pending execution request
      await executionManager.connect(owner).cancelExecution(requestId);
      const reqAfterCancel = await executionManager.getExecutionRequest(requestId);
      expect(reqAfterCancel.isCancelled).to.be.true;

      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock.timestamp + 15 * 60;
      const nullifier = 333222111000n;

      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "uint256", "address", "uint256"],
        [requestId, nullifier, deadline, managerAddr, network.chainId]
      );
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      // Attempt to approve cancelled request reverts
      await expect(
        executionManager.connect(user)["approveWithRelayer(bytes32,uint256,uint256,bytes)"](
          requestId,
          nullifier,
          deadline,
          sig
        )
      ).to.be.revertedWith("AegisManager: request cancelled");

      const req = await executionManager.getExecutionRequest(requestId);
      expect(req.isExecuted).to.be.false;
    });
  });

  describe("Phase IV: 1inch Aqua Protocol & SwapVM Custom Opcode Positions ($7k 1inch Track)", function () {
    beforeEach(async function () {
      await registry.connect(owner).registerSubname(
        SUBNAME_LABEL,
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );

      const subnameNode = await registry.agentToNode(agent.address);
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await swapVMAdapter.getAddress(),
        true
      );
    });

    it("Should construct and execute custom 1inch Aqua position deposit (OP_AQUA_DEPOSIT 0x05) via SwapVM", async function () {
      const instructions = [
        {
          opcode: 5, // OP_AQUA_DEPOSIT
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("500"),
          minAmountOut: ethers.parseEther("500"),
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [instructions]
        )
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("500")
      );
      await tx.wait();

      const posCount = await swapVMAdapter.getAgentAquaPositionCount(await executionManager.getAddress());
      expect(posCount).to.equal(1n);
    });

    it("Should execute 1inch Aqua position rebalancing & harvest yield (OP_AQUA_WITHDRAW 0x06)", async function () {
      const depositInstructions = [
        {
          opcode: 5, // OP_AQUA_DEPOSIT
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("800"),
          minAmountOut: ethers.parseEther("800"),
          extraData: "0x"
        },
        {
          opcode: 6, // OP_AQUA_WITHDRAW
          tokenIn: await mockToken.getAddress(),
          tokenOut: await mockToken.getAddress(),
          amountIn: ethers.parseEther("800"),
          minAmountOut: ethers.parseEther("816"), // 2% yield expectation
          extraData: "0x"
        }
      ];

      const encodedCall = swapVMAdapter.interface.encodeFunctionData("executeSwapVMRoute", [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(uint8 opcode, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData)[]"],
          [depositInstructions]
        )
      ]);

      // Execution request
      const tx = await executionManager.connect(agent).requestExecution(
        await swapVMAdapter.getAddress(),
        encodedCall,
        ethers.parseEther("800")
      );
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });
  });

  describe("Phase V: Real Uniswap V3 Token Swaps via AegisUniswapAdapter & SwapRouter02", function () {
    let subnameNode;

    beforeEach(async function () {
      await registry.connect(owner).registerSubname(
        "uniswap-agent",
        agent.address,
        BIOMETRIC_THRESHOLD,
        DAILY_LIMIT
      );
      subnameNode = await registry.agentToNode(agent.address);

      // Whitelist AegisUniswapAdapter
      await registry.connect(owner).setTargetContractWhitelist(
        subnameNode,
        await uniswapAdapter.getAddress(),
        true
      );

      // Mint initial token balances
      // 10,000 USDC to user
      await mockToken.mint(user.address, ethers.parseEther("10000"));
      // 10,000 WETH to mock SwapRouter02 liquidity pool
      await mockWETH.mint(await mockSwapRouter.getAddress(), ethers.parseEther("10000"));
    });

    it("Should execute a real Uniswap V3 swap with real ERC-20 transferFrom and delivery (proving tokens actually move)", async function () {
      const amountIn = ethers.parseEther("500");
      const minAmountOut = ethers.parseEther("490");

      // User approves AegisUniswapAdapter to pull amountIn
      await mockToken.connect(user).approve(await uniswapAdapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockWETH.getAddress(),
        fee: 3000,
        recipient: user.address,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0
      };

      const encodedCall = uniswapAdapter.interface.encodeFunctionData("executeExactInputSingle", [
        swapParams,
        user.address
      ]);

      const userInBefore = await mockToken.balanceOf(user.address);
      const userOutBefore = await mockWETH.balanceOf(user.address);
      const routerInBefore = await mockToken.balanceOf(await mockSwapRouter.getAddress());
      const routerOutBefore = await mockWETH.balanceOf(await mockSwapRouter.getAddress());

      // Low-value trade ($500 < $1,000) auto-executes immediately
      const tx = await executionManager.connect(agent).requestExecution(
        await uniswapAdapter.getAddress(),
        encodedCall,
        amountIn
      );
      const receipt = await tx.wait();

      const userInAfter = await mockToken.balanceOf(user.address);
      const userOutAfter = await mockWETH.balanceOf(user.address);
      const routerInAfter = await mockToken.balanceOf(await mockSwapRouter.getAddress());
      const routerOutAfter = await mockWETH.balanceOf(await mockSwapRouter.getAddress());

      // 1. User's tokenIn decreased by exact amountIn
      expect(userInBefore - userInAfter).to.equal(amountIn);

      // 2. Router's tokenIn increased by exact amountIn
      expect(routerInAfter - routerInBefore).to.equal(amountIn);

      // 3. User's tokenOut increased by exact amountOut from router (500 * 997 / 1000 = 498.5)
      const expectedOut = (amountIn * 997n) / 1000n;
      expect(userOutAfter - userOutBefore).to.equal(expectedOut);

      // 4. Router's tokenOut decreased by exact amountOut
      expect(routerOutBefore - routerOutAfter).to.equal(expectedOut);

      // 5. Adapter holds zero tokens (funds cleanly settled to recipient)
      expect(await mockToken.balanceOf(await uniswapAdapter.getAddress())).to.equal(0n);
      expect(await mockWETH.balanceOf(await uniswapAdapter.getAddress())).to.equal(0n);

      // Check event emitted
      const swapEvent = receipt.logs.find(log => {
        try {
          const parsed = uniswapAdapter.interface.parseLog(log);
          return parsed && parsed.name === "UniswapSwapExecuted";
        } catch { return false; }
      });
      expect(swapEvent).to.not.be.undefined;
    });

    it("Should pause high-value Uniswap trade, require World ID Agent Pass approval, and execute real token swap upon attestation", async function () {
      const amountIn = ethers.parseEther("2500");
      const minAmountOut = ethers.parseEther("2450");

      // User approves adapter for 2500 USDC
      await mockToken.connect(user).approve(await uniswapAdapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockWETH.getAddress(),
        fee: 3000,
        recipient: user.address,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0
      };

      const encodedCall = uniswapAdapter.interface.encodeFunctionData("executeExactInputSingle", [
        swapParams,
        user.address
      ]);

      const userInBefore = await mockToken.balanceOf(user.address);
      const userOutBefore = await mockWETH.balanceOf(user.address);

      // High-value trade ($2,500 >= $1,000) pauses onchain
      const reqTx = await executionManager.connect(agent).requestExecution(
        await uniswapAdapter.getAddress(),
        encodedCall,
        amountIn
      );
      const reqReceipt = await reqTx.wait();
      const reqEvent = reqReceipt.logs.find(log => log.fragment && log.fragment.name === "ExecutionRequested");
      const requestId = reqEvent.args.requestId;

      // Invariant: Before approval, zero tokens have moved
      expect(await mockToken.balanceOf(user.address)).to.equal(userInBefore);
      expect(await mockWETH.balanceOf(user.address)).to.equal(userOutBefore);

      // World ID Agent Pass Attestation
      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock.timestamp + 15 * 60;
      const nullifier = 888777666555n;

      const managerAddr = await executionManager.getAddress();
      const network = await ethers.provider.getNetwork();
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "uint256", "address", "uint256"],
        [requestId, nullifier, deadline, managerAddr, network.chainId]
      );
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));

      // Approve with relayer and atomically execute swap
      const approveTx = await executionManager.connect(user)["approveWithRelayer(bytes32,uint256,uint256,bytes)"](
        requestId,
        nullifier,
        deadline,
        sig
      );
      await approveTx.wait();

      const userInAfter = await mockToken.balanceOf(user.address);
      const userOutAfter = await mockWETH.balanceOf(user.address);

      // Invariant: After approval, tokens have moved on Uniswap
      expect(userInBefore - userInAfter).to.equal(amountIn);
      const expectedOut = (amountIn * 997n) / 1000n;
      expect(userOutAfter - userOutBefore).to.equal(expectedOut);
    });

    it("Should strictly revert and leave tokens untouched if slippage threshold is breached", async function () {
      const amountIn = ethers.parseEther("500");
      // Intentionally unfulfillable min output (550 > 498.5 output)
      const excessiveMinOut = ethers.parseEther("550");

      await mockToken.connect(user).approve(await uniswapAdapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await mockToken.getAddress(),
        tokenOut: await mockWETH.getAddress(),
        fee: 3000,
        recipient: user.address,
        amountIn: amountIn,
        amountOutMinimum: excessiveMinOut,
        sqrtPriceLimitX96: 0
      };

      const encodedCall = uniswapAdapter.interface.encodeFunctionData("executeExactInputSingle", [
        swapParams,
        user.address
      ]);

      const userInBefore = await mockToken.balanceOf(user.address);

      await expect(
        executionManager.connect(agent).requestExecution(
          await uniswapAdapter.getAddress(),
          encodedCall,
          amountIn
        )
      ).to.be.revertedWith("AegisManager: low level target call failed");

      // Invariant: Revert protects user funds, zero tokens taken
      expect(await mockToken.balanceOf(user.address)).to.equal(userInBefore);
    });

    it("Should support direct executeSwap helper method", async function () {
      const amountIn = ethers.parseEther("300");
      await mockToken.connect(user).approve(await uniswapAdapter.getAddress(), amountIn);

      const encodedCall = uniswapAdapter.interface.encodeFunctionData("executeSwap", [
        await mockToken.getAddress(),
        await mockWETH.getAddress(),
        3000,
        amountIn,
        ethers.parseEther("290"),
        user.address,
        user.address
      ]);

      const tx = await executionManager.connect(agent).requestExecution(
        await uniswapAdapter.getAddress(),
        encodedCall,
        amountIn
      );
      await tx.wait();

      expect(await mockWETH.balanceOf(user.address)).to.be.gt(0n);
    });
  });
});

