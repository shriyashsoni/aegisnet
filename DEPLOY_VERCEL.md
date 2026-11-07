# 🚀 Deploying AegisNet on Vercel

This guide covers deploying AegisNet to Vercel either as a **Full-Stack Monorepo (Static Frontend + Serverless API)** or as a **Decoupled Frontend (with Backend on Railway/Render/Docker)**.

---

## 🏗️ Architecture Options

```
Option 1: All-in-One on Vercel (Recommended)
┌────────────────────────────────────────────────────────┐
│                      Vercel Edge                       │
│                                                        │
│  Static Pages (/ , /app, /docs, /whitepaper)           │
│  └── frontend/ (HTML + JS + CSS + vendor/ethers)       │
│                                                        │
│  Serverless Functions (/api/*)                         │
│  └── api/index.ts -> Express API Engine                │
│      ├── ENSv2 Metadata & EAC Registry Reader          │
│      ├── 0G Private Compute AI Planner                 │
│      ├── Human Approval Gate Attestation Relayer       │
│      └── 0G Storage Audit Trail Proofs                 │
└────────────────────────────────────────────────────────┘

Option 2: Decoupled (Vercel Frontend + Persistent Node Backend)
┌───────────────────────────┐         ┌───────────────────────────┐
│     Vercel (Frontend)     │         │ Railway / Render (Server) │
│                           │         │                           │
│  • Edge CDN Static Assets │ ──────> │  • 24/7 Sepolia Indexer   │
│  • Web3 Wallet Connect    │  /api   │  • Relayer Attestation    │
│  • Client-side Tx Signing │         │  • 0G Compute & Storage   │
└───────────────────────────┘         └───────────────────────────┘
```

---

## ⚡ Option 1: Full-Stack Deployment via Vercel (Fastest)

The repository is pre-configured with `vercel.json`, root `package.json`, and `api/index.ts` so Vercel can build and serve everything automatically.

### Step 1: Push Code to GitHub
Ensure all recent changes are pushed to your GitHub repository:
```bash
git push origin main
```

### Step 2: Import into Vercel Dashboard
1. Go to [vercel.com](https://vercel.com) and log in.
2. Click **"Add New..."** → **"Project"**.
3. Select your repository: `shriyashsoni/aegisnet`.
4. In the **Configure Project** screen:
   - **Framework Preset**: Select **Other** (or leave as auto-detected).
   - **Root Directory**: `./` (leave default root).
   - **Build and Output Settings**:
     - *Build Command*: `cd backend && npm install && npm run build` (already defined in `vercel.json`).
     - *Output Directory*: `frontend`

### Step 3: Add Environment Variables in Vercel
In the Vercel project configuration, expand **Environment Variables** and add the following keys:

| Variable | Recommended / Default Value | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Production mode |
| `SEPOLIA_RPC_URL` | `https://eth-sepolia.g.alchemy.com/v2/...` | Ethereum Sepolia RPC endpoint |
| `CHAIN_ID` | `11155111` | Sepolia Chain ID |
| `PRIVATE_KEY` | `0x...` | Protocol deployer / owner key |
| `RELAYER_PRIVATE_KEY` | `0x3C29CC205E4fb3e1cA6C89DECDFE5A5d4e46E799` (or your relayer key) | Signs Human Approval attestations |
| `ENS_ROOT_NAME` | `aegisnet.eth` | Registered root ENS domain |
| `CONTRACT_REGISTRY` | `0x6Dbd89B71e8AB7BF93a9200C6fB81951699549FE` | AegisSubnameRegistry on Sepolia |
| `CONTRACT_EXECUTION_MANAGER` | `0x13d7b8Add8265AB1Cfdc3a6E8E60D1b3bcD56fa8` | AegisExecutionManager on Sepolia |
| `CONTRACT_UNISWAP_ADAPTER` | `0xD855719f7Cc2cD867540F8398E3d2Fa4b2dD8221` | AegisUniswapAdapter on Sepolia |
| `CONTRACT_SWAPVM_ADAPTER` | `0xb81b7Ec40eF275AA805Cb82D729498C47Ab64c60` | SwapVM Adapter on Sepolia |
| `PLANNER_PROVIDER` | `0g` | AI strategy provider (`0g` or `claude`) |
| `ZG_COMPUTE_API_KEY` | `your_0g_api_key` | 0G Private Compute Router API Key |
| `ZG_COMPUTE_ENDPOINT` | `https://router-api.0g.ai/v1` | 0G Compute endpoint |
| `ZG_COMPUTE_MODEL` | `0gm-1.0-35b-a3b` | 0G Compute LLM model |
| `ZG_STORAGE_INDEXER` | `https://indexer-storage-testnet-turbo.0g.ai` | 0G Turbo Storage Indexer |
| `ZG_STORAGE_RPC` | `https://evmrpc-testnet.0g.ai` | 0G EVM Storage RPC |
| `ZG_STORAGE_PRIVATE_KEY` | *(Same as PRIVATE_KEY)* | Key for 0G storage gas |
| `BIOMETRIC_THRESHOLD_USD` | `1000` | Human gate approval trigger ($) |
| `DATA_DIR` | `/tmp` | Ephemeral storage dir for lambda |

### Step 4: Click Deploy!
- Vercel will install dependencies, compile the TypeScript backend, host static assets on the global edge network, and expose the Express API under `/api/*`.
- Once deployed, your app will be live at `https://<your-project>.vercel.app`!
  - Landing page: `https://<your-project>.vercel.app/`
  - Agent Console: `https://<your-project>.vercel.app/app`
  - Architecture Docs: `https://<your-project>.vercel.app/docs`
  - Protocol Whitepaper: `https://<your-project>.vercel.app/whitepaper`
  - System Health: `https://<your-project>.vercel.app/api/health`

---

## 🛠️ Deploying via Vercel CLI

If you prefer deploying directly from your command line:

```bash
# 1. Install or invoke Vercel CLI
npx vercel

# 2. Follow prompts to link project
# 3. Deploy to production
npx vercel --prod
```

---

## 🔌 Option 2: Decoupled Deployment (Frontend on Vercel + Backend on Railway / Render)

For production deployments where you want the **Sepolia Event Indexer** to run 24/7 without serverless cold starts:

1. **Deploy Backend to Railway / Render / Docker**:
   - Use the included [Dockerfile](file:///c:/Users/Siddhu/Downloads/aegisnet/Dockerfile) or run `cd backend && npm start`.
   - Your backend will receive a URL like `https://aegisnet-api.up.railway.app`.

2. **Deploy Frontend on Vercel**:
   - In Vercel Project Settings, set **Root Directory** to `frontend`.
   - In `frontend/vercel.json`, add a proxy rewrite if you want requests to `/api/*` routed to your server:
     ```json
     {
       "version": 2,
       "cleanUrls": true,
       "rewrites": [
         { "source": "/api/(.*)", "destination": "https://aegisnet-api.up.railway.app/api/$1" },
         { "source": "/app", "destination": "/app.html" },
         { "source": "/docs", "destination": "/docs.html" },
         { "source": "/whitepaper", "destination": "/whitepaper.html" }
       ]
     }
     ```
   - Alternatively, open your browser console on the Vercel site once and configure the backend URL:
     ```javascript
     localStorage.setItem('aegis.api', 'https://aegisnet-api.up.railway.app');
     location.reload();
     ```

---

## 🛡️ Verification Checklist After Deployment

After Vercel finishes deploying:

- [ ] Visit `https://<your-app>.vercel.app/api/health`
  - Verify `"status": "online"`
  - Verify `"network": "Sepolia"`
  - Verify `"relayer": { "matchesContract": true }`
- [ ] Visit `https://<your-app>.vercel.app/app`
  - Click **Connect Wallet** (MetaMask / Rabby on Ethereum Sepolia).
  - Verify your registered subname appears (e.g. `sidd.aegisnet.eth` or `shriyashdn.aegisnet.eth`).
  - Propose a trade via 0G AI Private Compute.
  - Approve or execute trade to verify end-to-end integration!
