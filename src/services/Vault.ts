import { VAULT_ABI, VAULT_ADDRESS } from "@/constants"
import { ethers, JsonRpcSigner, parseEther } from "ethers"

export const useVault = (signer?: JsonRpcSigner) => {
    const contract = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer)

    const getCollateralValue = async (address: string) => {
        try {
            const value = await contract.getCollateralValueNVD(address);
            return value;
        } catch (error) {
            throw error
        }
    }

    const getCollateralRatio = async (address: string) => {
        try {
            const cr = await contract.getCR(address);
            return cr;
        } catch (error) {
            throw error
        }
    }

    const handleMint = async (amount: string) => {
        try {
            const tx = await contract.mintNVD(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Your collateral ratio is too low!")
        }
    }

    const handleBurn = async (amount: string) => {
        try {
            const tx = await contract.repays(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Repay exceeds minted amount!")
        }
    }

    const getPosition = async (address: string) => {
        try {
            const cr = await contract.positions(address);
            return cr;
        } catch (error) {
            throw ""
        }
    }

    const depositWETH = async (amount: string) => {
        try {
            const tx = await contract.depositWETH(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Your collateral ratio is too low!")
        }
    }

    const depositWBTC = async (amount: string) => {
        try {
            const tx = await contract.depositWBTC(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Your collateral ratio is too low!")
        }
    }

    const redeemWETH = async (amount: string) => {
        try {
            const tx = await contract.withdrawWETH(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Your collateral ratio is too low!")
        }
    }

    const redeemWBTC = async (amount: string) => {
        try {
            const tx = await contract.withdrawWBTC(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Your collateral ratio is too low!")
        }
    }

    const mintNVD = async (amount: string) => {
        try {
            const tx = await contract.mintNVD(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Your collateral ratio is too low!")
        }
    }

    const repayNVD = async (amount: string) => {
        try {
            const tx = await contract.repay(parseEther(amount));
            await tx.wait();
        } catch (error) {
            throw new Error("Repay exceeds NVD minted!")
        }
    }

    return {
        getCollateralValue,
        getCollateralRatio,
        getPosition,
        handleMint,
        handleBurn,
        depositWETH,
        depositWBTC,
        redeemWETH,
        redeemWBTC,
        mintNVD,
        repayNVD
    };


}
