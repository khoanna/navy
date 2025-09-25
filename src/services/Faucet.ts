import { FAUCET_ABI, FAUCET_ADDRESS } from "@/constants";
import { ethers, JsonRpcSigner, parseEther } from "ethers";

export const useFaucet = (signer?: JsonRpcSigner) => {
    const contract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, signer)

    const claimWBTC = async () => {
        try {
            const tx = await contract.claimWBTC()
            await tx.wait();
        } catch (error) {
            throw new Error("Faucet error")
        }
    }

    const claimWETH = async () => {
        try {
            const tx = await contract.claimWETH()
            await tx.wait();
        } catch (error) {
            throw new Error("Faucet error")
        }
    }


    return { claimWBTC, claimWETH }
}