import { MINT_ABI, MINT_ADDRESS, VAULT_ADDRESS } from "@/constants";
import { ethers, JsonRpcSigner, parseEther } from "ethers";

export const useMint = (signer?: JsonRpcSigner) => {
    const contract = new ethers.Contract(MINT_ADDRESS, MINT_ABI, signer)

    const createMintRequest = async (address: string, amount: string) => {
        try {
            const tx = await contract.createMintRequest(address, parseEther(amount))
            await tx.wait();
        } catch (error) {
            throw new Error("Only Bank and Navy can create request!")
        }
    }

    const navyConfirm = async (id: string) => {
        try {
            const tx = await contract.confirmByNavy(id)
            await tx.wait();
        } catch (error) {
            throw new Error("Only Navy address can confirm!")
        }
    }

    const bankConfirm = async (id: string) => {
        try {
            const tx = await contract.confirmByBank(id)
            await tx.wait();
        } catch (error) {
            throw new Error("Only Navy address can confirm!")
        }
    }

    const cancelMintRequest = async (id: string) => {
        try {
            const tx = await contract.cancelRequest(id)
            await tx.wait();
        } catch (error) {
            throw new Error("Only Navy address can confirm!")
        }
    }

    const getNeedNavyConfirm = async () => {
        try {
            const request = await contract.getNeedNavyConfirm();
            return request;
        } catch (e) {
            throw new Error("Only Navy address can get!")
        }
    }

    const getNeedBankConfirm = async () => {
        try {
            const request = await contract.getNeedBankConfirm();
            return request;
        } catch (e) {
            console.log("Only Bank address can get!");
            throw new Error("Only Bank address can get!")
        }
    }

    return { createMintRequest, navyConfirm, bankConfirm, cancelMintRequest, getNeedNavyConfirm, getNeedBankConfirm }
}