import { VAULT_ADDRESS, WBTC_ABI, WBTC_ADDRESS } from "@/constants";
import { ethers, JsonRpcSigner, parseEther } from "ethers";

export const useWBTC = (signer?: JsonRpcSigner) => {
    const contract = new ethers.Contract(WBTC_ADDRESS, WBTC_ABI, signer)

    const approveWBTC = async (amount: string) => {
        try {
            const tx = await contract.approve(VAULT_ADDRESS, parseEther(amount))
            await tx.wait();
        } catch (error) {
            throw error
        }
    }
    
    return { approveWBTC }
}