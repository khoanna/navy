# 🌊 Navy

This repository contains the **Frontend** for the **Navy Project** – an **on-chain minting platform** and governance system.  
The frontend connects directly to the deployed smart contracts to allow seamless interaction with the blockchain.

---

## 🚀 Project Goals
- Enable users to **mint tokens** directly on-chain.  
- Provide a governance interface for **Navy Mint Governance**.  
- Display transparent, real-time data from blockchain (Vault, Governance, Tokens).  

---

## 📂 Project Structure

```
src/
 ├── app/                        # Front-end app
 ├── contracts/contracts         # Smart contracts of Navy
```

---

## 📜 Smart Contracts

All core contracts of Navy are stored in `src/contracts/contracts` run on **Sepolia**.  
Below is the list of deployed contracts with their purpose:

| Contract              | Address | Description                                                                 |
|-----------------------|--------------------------|-----------------------------------------------------------------------------|
| **WBTC**              | `0x8788bD875141C37080eb7Ef4bc5914A768058169`                 | Test token simulating Wrapped Bitcoin. Used for testing and integration.    |
| **WETH**              | `0x48253BA0c207cABf5a8D97F05003878B6a7adc02`                 | Test token simulating Wrapped Ether. Used for testing and integration.        |
| **NVDToken**          | `0xf3825D101e6Bade4Dcbd96D7de2Ed951bc425e18`                 | The main **Navy Token Vietnam Dong (NVD)** used within the ecosystem.                    |
| **NVDMintGovernance** | `0xF48A4d9e43195bE392a3D9507Ad013387B22223D`                 | Governance contract controlling minting rules, permissions, and proposals.  |
| **NVDVault**          | `0xE0AF880c72F3df087Ff981a7BCC093880B4f4782`                 | Secure vault managing collateral, reserves, and overall protocol stability. |
| **RWA Token (ERC-1400)** | _TBD_ | Tokenized Real World Asset compliant with [ERC-1400](https://github.com/ndaxio/ERC1400). |

---

## 🛠️ Tech Stack
- **Next.js** – UI framework  
- **Ethers.js** – Blockchain interactions  
- **TailwindCSS** – Styling  
- **TypeScript** – Type safety  

---

## ⚡ Getting Started

```bash
# Install dependencies
npm install
```
```bash
# Run development server
npm run dev
```
```bash
# Build for production
npm run build
```

---

## 📌 Notes
- Make sure to update contract **addresses** once they are deployed.  
- All contract are located in `src/contracts/contracts`.  

---

## 🐋 Navy Vision
Navy aims to provide a **transparent, decentralized, and secure minting mechanism** for tokens, governed by the community and powered by on-chain smart contracts.
