'use client'

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { BrowserProvider, Network, JsonRpcSigner, Eip1193Provider } from 'ethers';
import { useAppKitAccount } from '@reown/appkit/react';

type IWeb3Context = {
    address: string | undefined;
    isConnected: boolean;
    signer?: JsonRpcSigner;
    network?: Network;
}

function isEip1193Provider(
    provider: unknown
): provider is Eip1193Provider {
    return (
        typeof provider === "object" && provider !== null && "request" in provider && typeof (provider as Eip1193Provider).request === "function"
    );
}
const Web3Context = createContext<IWeb3Context | undefined>(undefined);

export const Web3ContextProvider = ({ children }: { children: ReactNode }) => {
    const { address, isConnected } = useAppKitAccount();


    const [signer, setSigner] = useState<JsonRpcSigner | undefined>(undefined);
    const [network, setNetwork] = useState<Network | undefined>(undefined);

    useEffect(() => {
        const connectToBlockchain = async () => {
            if (isEip1193Provider(window.ethereum)) {
                const provider = new BrowserProvider(window.ethereum);
                const signer = await provider.getSigner();
                const network = await provider.getNetwork();
                setSigner(signer);
                setNetwork(network);
            }
        };
        connectToBlockchain();
    }, []);

    const value: IWeb3Context = {
        address,
        isConnected,
        signer,
        network
    };

    return (
        <Web3Context.Provider value={value}>
            {children}
        </Web3Context.Provider>
    );
};

export const useWeb3Context = () => {
    const context = useContext(Web3Context);
    if (!context) {
        throw new Error("useWeb3Context must be used within Web3ContextProvider");
    }
    return context;
};
