import { VAULT_ADDRESS, WETH_ABI, WETH_ADDRESS } from "@/constants";
import { ethers, JsonRpcSigner, parseEther } from "ethers";

export const useWETH = (signer?: JsonRpcSigner) => {
    const contract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer)

    const approveWETH = async (amount: string) => {
        try {
            const tx = await contract.approve(VAULT_ADDRESS, parseEther(amount))
            await tx.wait();
        } catch (error) {
            throw error
        }
    }
    
    return { approveWETH }
}