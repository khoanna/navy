import { NVD_ABI, NVD_ADDRESS, VAULT_ADDRESS } from "@/constants"
import { ethers, JsonRpcSigner, parseEther } from "ethers"

export const useNVD = (signer?: JsonRpcSigner) => {
    const contract = new ethers.Contract(NVD_ADDRESS, NVD_ABI, signer)

    const getBalance = async (address: string) => {
        try {
            const balance = await contract.balanceOf(address);
            return balance;
        } catch (error) {
            throw error
        }
    }

    const approve = async (amount: string) => {
        try {
            const tx = await contract.approve(VAULT_ADDRESS, parseEther(amount))
            await tx.wait();
        } catch (error) {
            throw error
        }
    }

    return { getBalance, approve };

}
