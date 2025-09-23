import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TokensModule", (m) => {
  const btc = m.contract("BTC", [1000000n]);

  const eth = m.contract("ETH", [2000000n]);

  return { btc, eth };
});
